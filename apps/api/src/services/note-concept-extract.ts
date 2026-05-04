import {
	blocks as blocksTable,
	conceptObservations,
	compiledLocalConceptEvidence,
	compiledLocalConcepts,
	noteAnnotationRefs,
	noteBlockRefs,
	notes,
	type Paper,
	papers,
	readerAnnotations,
} from "@sapientia/db"
import { fillPrompt, loadPrompt } from "@sapientia/shared"
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "../db"
import { enqueuePaperConceptDescription } from "../queues/paper-concept-description"
import { enqueuePaperConceptRefine } from "../queues/paper-concept-refine"
import { enqueuePaperInnerGraphCompile } from "../queues/paper-inner-graph-compile"
import { enqueueWorkspaceSemanticRefresh } from "../queues/workspace-semantic-refresh"
import { getLlmCredential } from "./credentials"
import { completeObject, LlmCredentialMissingError } from "./llm-client"
import { appendAgentQuestionsToNote } from "./note"
import { compileWorkspaceConceptClusters } from "./workspace-concept-clusters"
import { refreshWorkspacePaperGraph } from "./workspace-paper-graph"

export const NOTE_CONCEPT_EXTRACT_PROMPT_VERSION = "note-concept-extract-v1"
const NOTE_OBSERVATION_WEIGHT = 1
const MAX_EXISTING_CONCEPTS = 80
const MAX_NOTE_MARKDOWN_CHARS = 4_000

const conceptKindSchema = z.enum(["concept", "method", "task", "metric", "dataset"])

const noteConceptItemSchema = z.object({
	kind: conceptKindSchema,
	canonicalName: z.string().min(1),
	displayName: z.string().min(1),
	evidenceBlockIds: z.array(z.string().min(1)).default([]),
	rationale: z.string().min(1),
})

const noteDiscoveredConceptSchema = noteConceptItemSchema.extend({
	noteExcerpt: z.string().min(1).optional(),
	relationToPaper: z.string().min(1).optional(),
	confidence: z.coerce.number().min(0).max(1).optional(),
})

const noteConceptExtractSchema = z.preprocess(
	normalizeNoteConceptExtractResult,
	z.object({
		existingConceptSignals: z.array(noteConceptItemSchema).default([]),
		discoveredConcepts: z.array(noteDiscoveredConceptSchema).default([]),
		questions: z.array(
			z.object({
				conceptName: z.string().min(1),
				question: z.string().min(1),
			}),
		).default([]),
	}),
)

type ConceptKind = z.infer<typeof conceptKindSchema>
type ExistingConcept = Awaited<ReturnType<typeof loadExistingConcepts>>[number]
type EvidenceBlock = { blockId: string; text: string | null }

function normalizeNoteConceptExtractResult(value: unknown) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value
	const record = value as Record<string, unknown>
	return {
		...record,
		existingConceptSignals:
			record.existingConceptSignals ??
			record.existing_concept_signals ??
			record.existingConcepts ??
			[],
		discoveredConcepts:
			record.discoveredConcepts ??
			record.discovered_concepts ??
			record.groundedConcepts ??
			record.grounded_concepts ??
			[],
		questions: record.questions ?? [],
	}
}

export async function extractNoteBornConcepts(args: { noteId: string; force?: boolean }) {
	const [note] = await db
		.select()
		.from(notes)
		.where(and(eq(notes.id, args.noteId), isNull(notes.deletedAt)))
		.limit(1)
	if (!note || !note.paperId) return skipped(args.noteId, "not-paper-linked")

	const [paper] = await db.select().from(papers).where(eq(papers.id, note.paperId)).limit(1)
	if (!paper || paper.deletedAt || paper.parseStatus !== "done" || paper.summaryStatus !== "done") {
		return skipped(args.noteId, "paper-not-ready")
	}
	const noteWithPaper = { ...note, paperId: note.paperId }

	const existingObservation = await db
		.select({ observedAt: conceptObservations.observedAt })
		.from(conceptObservations)
		.where(
			and(
				eq(conceptObservations.workspaceId, note.workspaceId),
				eq(conceptObservations.ownerUserId, note.ownerUserId),
				eq(conceptObservations.paperId, note.paperId),
				eq(conceptObservations.sourceType, "note"),
				eq(conceptObservations.sourceId, noteSourceId(note.id)),
				isNull(conceptObservations.deletedAt),
			),
		)
		.limit(1)
	if (!args.force && existingObservation[0]?.observedAt && existingObservation[0].observedAt >= note.updatedAt) {
		return skipped(args.noteId, "already-processed")
	}

	const evidenceBlocks = await resolveNoteEvidenceBlocks(note)
	const evidenceBlockIds = evidenceBlocks.map((block) => block.blockId)
	const credential = await getLlmCredential(note.ownerUserId)
	if (!credential) throw new LlmCredentialMissingError()

	const existingConcepts = await loadExistingConcepts({
		workspaceId: note.workspaceId,
		paperId: note.paperId,
		userId: note.ownerUserId,
	})
	const prompt = fillPrompt(loadPrompt(NOTE_CONCEPT_EXTRACT_PROMPT_VERSION), {
		title: paper.title || "(untitled paper)",
		authors: formatPaperAuthors(paper),
		existingConcepts: JSON.stringify(
			existingConcepts.slice(0, MAX_EXISTING_CONCEPTS).map((concept) => ({
				kind: concept.kind,
				canonicalName: concept.canonicalName,
				displayName: concept.displayName,
			})),
		),
		evidenceBlocks: JSON.stringify(
			evidenceBlocks.map((block) => ({
				blockId: block.blockId,
				text: truncateText(block.text ?? "", 1_200),
			})),
		),
		noteMarkdown: note.agentMarkdownCache.slice(0, MAX_NOTE_MARKDOWN_CHARS),
	})
	const result = await completeObject({
		userId: note.ownerUserId,
		workspaceId: note.workspaceId,
		promptId: NOTE_CONCEPT_EXTRACT_PROMPT_VERSION,
		model: credential.model,
		schema: noteConceptExtractSchema,
		messages: [{ role: "user", content: prompt }],
		maxTokens: 4_000,
		temperature: 0.15,
	})

	await cleanupStaleNoteBornObservations({
		noteId: note.id,
		workspaceId: note.workspaceId,
		paperId: note.paperId,
		userId: note.ownerUserId,
	})

	const validEvidence = new Set(evidenceBlockIds)
	let groundedCount = 0
	const conceptIds = new Set<string>()
	const touchedConceptNames = new Set<string>()
	const existingConceptByKey = buildExistingConceptKeyMap(existingConcepts)
	for (const rawConcept of result.object.existingConceptSignals) {
		const applied = await applyNoteConceptSignal({
			rawConcept,
			validEvidence,
			existingConceptByKey,
			note: noteWithPaper,
			model: result.model,
			allowCreate: false,
		})
		if (!applied) continue
		conceptIds.add(applied.conceptId)
		touchedConceptNames.add(applied.canonicalName)
		groundedCount += 1
	}
	for (const rawConcept of result.object.discoveredConcepts) {
		const applied = await applyNoteConceptSignal({
			rawConcept,
			validEvidence,
			existingConceptByKey,
			note: noteWithPaper,
			model: result.model,
			allowCreate: true,
		})
		if (!applied) continue
		conceptIds.add(applied.conceptId)
		touchedConceptNames.add(applied.canonicalName)
		groundedCount += 1
	}

	const freshQuestions = result.object.questions
		.map((question) => ({
			conceptName: question.conceptName.trim(),
			question: question.question.trim(),
		}))
		.filter((question) => question.conceptName && question.question)
		.filter((question) => !touchedConceptNames.has(normalizeCanonicalName(question.conceptName)))
	if (freshQuestions.length > 0) {
		await appendAgentQuestionsToNote({
			noteId: note.id,
			expectedVersion: note.currentVersion,
			questions: freshQuestions,
		})
	}

	if (groundedCount > 0) {
		await enqueuePaperConceptRefine({
			paperId: note.paperId,
			userId: note.ownerUserId,
			workspaceId: note.workspaceId,
		})
		await enqueuePaperConceptDescription({
			paperId: note.paperId,
			userId: note.ownerUserId,
			workspaceId: note.workspaceId,
			reason: "reader-note-concept",
		})
		await compileWorkspaceConceptClusters({
			workspaceId: note.workspaceId,
			userId: note.ownerUserId,
		})
		await enqueueWorkspaceSemanticRefresh({
			workspaceId: note.workspaceId,
			userId: note.ownerUserId,
			reason: "reader-note-concept",
		})
		await enqueuePaperInnerGraphCompile({
			paperId: note.paperId,
			userId: note.ownerUserId,
			workspaceId: note.workspaceId,
		})
		await refreshWorkspacePaperGraph({
			workspaceId: note.workspaceId,
			userId: note.ownerUserId,
		})
	}

	return {
		noteId: note.id,
		paperId: note.paperId,
		workspaceId: note.workspaceId,
		status: "done" as const,
		groundedConceptCount: groundedCount,
		questionCount: freshQuestions.length,
		touchedConceptCount: conceptIds.size,
	}
}

export async function enqueueDueNoteConceptExtractions(args: { limit?: number } = {}) {
	const limit = args.limit ?? 200
	const rows = await db
		.select({
			noteId: notes.id,
			workspaceId: notes.workspaceId,
			ownerUserId: notes.ownerUserId,
			paperId: notes.paperId,
		})
		.from(notes)
		.innerJoin(papers, eq(papers.id, notes.paperId))
		.where(
			and(
				isNull(notes.deletedAt),
				isNull(papers.deletedAt),
				eq(papers.parseStatus, "done"),
				eq(papers.summaryStatus, "done"),
				sql`not exists (
					select 1
					from ${conceptObservations} co
					where
						co.workspace_id = ${notes.workspaceId}
						and co.owner_user_id = ${notes.ownerUserId}
						and co.paper_id = ${notes.paperId}
						and co.source_type = 'note'
						and co.source_id = concat('note:', ${notes.id})
						and co.deleted_at is null
						and co.observed_at >= ${notes.updatedAt}
				)`,
			),
		)
		.orderBy(desc(notes.updatedAt))
		.limit(limit)

	return rows.flatMap((row) =>
		row.paperId ? [{ noteId: row.noteId, workspaceId: row.workspaceId, userId: row.ownerUserId }] : [],
	)
}

export async function cleanupNoteBornConceptsForNote(args: { noteId: string }) {
	const [note] = await db.select().from(notes).where(eq(notes.id, args.noteId)).limit(1)
	if (!note || !note.paperId) return { cleanedConceptCount: 0 }
	return cleanupStaleNoteBornObservations({
		noteId: note.id,
		workspaceId: note.workspaceId,
		paperId: note.paperId,
		userId: note.ownerUserId,
	})
}

async function cleanupStaleNoteBornObservations(args: {
	noteId: string
	workspaceId: string
	paperId: string
	userId: string
}) {
	const now = new Date()
	const rows = await db
		.select({ conceptId: conceptObservations.localConceptId })
		.from(conceptObservations)
		.where(
			and(
				eq(conceptObservations.workspaceId, args.workspaceId),
				eq(conceptObservations.ownerUserId, args.userId),
				eq(conceptObservations.paperId, args.paperId),
				eq(conceptObservations.sourceType, "note"),
				eq(conceptObservations.sourceId, noteSourceId(args.noteId)),
				isNull(conceptObservations.deletedAt),
			),
		)
	await db
		.update(conceptObservations)
		.set({ deletedAt: now, updatedAt: now })
		.where(
			and(
				eq(conceptObservations.workspaceId, args.workspaceId),
				eq(conceptObservations.ownerUserId, args.userId),
				eq(conceptObservations.paperId, args.paperId),
				eq(conceptObservations.sourceType, "note"),
				eq(conceptObservations.sourceId, noteSourceId(args.noteId)),
				isNull(conceptObservations.deletedAt),
			),
		)

	let cleanedConceptCount = 0
	for (const conceptId of uniqueStrings(rows.map((row) => row.conceptId))) {
		const [remaining] = await db
			.select({ id: conceptObservations.id })
			.from(conceptObservations)
			.where(and(eq(conceptObservations.localConceptId, conceptId), isNull(conceptObservations.deletedAt)))
			.limit(1)
		if (remaining) continue
		await db
			.update(compiledLocalConcepts)
			.set({ deletedAt: now, updatedAt: now })
			.where(
				and(
					eq(compiledLocalConcepts.id, conceptId),
					eq(compiledLocalConcepts.promptVersion, NOTE_CONCEPT_EXTRACT_PROMPT_VERSION),
					isNull(compiledLocalConcepts.deletedAt),
				),
			)
		cleanedConceptCount += 1
	}
	return { cleanedConceptCount }
}

async function resolveNoteEvidenceBlocks(note: typeof notes.$inferSelect): Promise<EvidenceBlock[]> {
	const blockRows = await db
		.select({ blockId: noteBlockRefs.blockId })
		.from(noteBlockRefs)
		.where(eq(noteBlockRefs.noteId, note.id))
	const blockIds = blockRows.map((row) => row.blockId)

	const annotationRows = await db
		.select({
			page: readerAnnotations.page,
			body: readerAnnotations.body,
		})
		.from(noteAnnotationRefs)
		.innerJoin(
			readerAnnotations,
			and(
				eq(readerAnnotations.id, noteAnnotationRefs.annotationId),
				eq(readerAnnotations.paperId, noteAnnotationRefs.paperId),
				isNull(readerAnnotations.deletedAt),
			),
		)
		.where(eq(noteAnnotationRefs.noteId, note.id))
	if (annotationRows.length > 0 && note.paperId) {
		const paperBlocks = await db
			.select({
				blockId: blocksTable.blockId,
				page: blocksTable.page,
				bbox: blocksTable.bbox,
			})
			.from(blocksTable)
			.where(eq(blocksTable.paperId, note.paperId))
		for (const row of annotationRows) {
			const blockId = findOverlappingBlockId(paperBlocks, row.page, annotationBodyBoundingBox(row.body))
			if (blockId) blockIds.push(blockId)
		}
	}
	const uniqueBlockIds = uniqueStrings(blockIds)
	if (!note.paperId || uniqueBlockIds.length === 0) return []
	const rows = await db
		.select({
			blockId: blocksTable.blockId,
			text: blocksTable.text,
		})
		.from(blocksTable)
		.where(and(eq(blocksTable.paperId, note.paperId), inArray(blocksTable.blockId, uniqueBlockIds)))
	const blockById = new Map(rows.map((row) => [row.blockId, row] as const))
	return uniqueBlockIds.flatMap((blockId) => {
		const block = blockById.get(blockId)
		return block ? [{ blockId, text: block.text }] : []
	})
}

async function loadExistingConcepts(args: { workspaceId: string; paperId: string; userId: string }) {
	return db
		.select({
			id: compiledLocalConcepts.id,
			kind: compiledLocalConcepts.kind,
			canonicalName: compiledLocalConcepts.canonicalName,
			displayName: compiledLocalConcepts.displayName,
		})
		.from(compiledLocalConcepts)
		.where(
			and(
				eq(compiledLocalConcepts.workspaceId, args.workspaceId),
				eq(compiledLocalConcepts.paperId, args.paperId),
				eq(compiledLocalConcepts.ownerUserId, args.userId),
				isNull(compiledLocalConcepts.deletedAt),
			),
		)
}

async function applyNoteConceptSignal(args: {
	rawConcept: z.infer<typeof noteConceptItemSchema>
	validEvidence: Set<string>
	existingConceptByKey: Map<string, ExistingConcept>
	note: typeof notes.$inferSelect & { paperId: string }
	model: string
	allowCreate: boolean
}) {
	const blockIds = uniqueStrings(args.rawConcept.evidenceBlockIds).filter((blockId) =>
		args.validEvidence.has(blockId),
	)
	if (blockIds.length === 0) return null
	const canonicalName = normalizeCanonicalName(
		args.rawConcept.canonicalName || args.rawConcept.displayName,
	)
	if (!canonicalName) return null

	const existingConcept = args.existingConceptByKey.get(conceptKey(args.rawConcept.kind, canonicalName))
	const concept = existingConcept
		? { id: existingConcept.id }
		: args.allowCreate
			? await upsertNoteBornConcept({
					workspaceId: args.note.workspaceId,
					paperId: args.note.paperId,
					userId: args.note.ownerUserId,
					kind: args.rawConcept.kind,
					canonicalName,
					displayName: args.rawConcept.displayName.trim(),
					model: args.model,
				})
			: null
	if (!concept) return null

	await upsertEvidenceRows({
		conceptId: concept.id,
		paperId: args.note.paperId,
		blockIds,
		snippet: args.rawConcept.rationale,
	})
	await upsertNoteObservation({
		conceptId: concept.id,
		workspaceId: args.note.workspaceId,
		paperId: args.note.paperId,
		userId: args.note.ownerUserId,
		noteId: args.note.id,
		blockIds,
		observationText: args.note.agentMarkdownCache.slice(0, 1_200),
		observedAt: args.note.updatedAt,
	})
	return { conceptId: concept.id, canonicalName }
}

function buildExistingConceptKeyMap(concepts: ExistingConcept[]) {
	const map = new Map<string, ExistingConcept>()
	for (const concept of concepts) {
		map.set(conceptKey(concept.kind as ConceptKind, concept.canonicalName), concept)
		map.set(conceptKey(concept.kind as ConceptKind, concept.displayName), concept)
	}
	return map
}

function conceptKey(kind: ConceptKind, name: string) {
	return `${kind}::${normalizeCanonicalName(name)}`
}

async function upsertNoteBornConcept(args: {
	workspaceId: string
	paperId: string
	userId: string
	kind: ConceptKind
	canonicalName: string
	displayName: string
	model: string
}) {
	const now = new Date()
	const [concept] = await db
		.insert(compiledLocalConcepts)
		.values({
			workspaceId: args.workspaceId,
			ownerUserId: args.userId,
			paperId: args.paperId,
			kind: args.kind,
			canonicalName: args.canonicalName,
			displayName: args.displayName,
			generatedAt: now,
			modelName: args.model,
			promptVersion: NOTE_CONCEPT_EXTRACT_PROMPT_VERSION,
			status: "done",
			sourceLevelDescriptionStatus: "pending",
			sourceLevelDescriptionDirtyAt: now,
			readerSignalDirtyAt: now,
			semanticDirtyAt: now,
			confidenceScore: 0.65,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: [
				compiledLocalConcepts.ownerUserId,
				compiledLocalConcepts.workspaceId,
				compiledLocalConcepts.paperId,
				compiledLocalConcepts.kind,
				compiledLocalConcepts.canonicalName,
			],
			set: {
				displayName: sql`excluded.display_name`,
				status: "done",
				deletedAt: null,
				readerSignalDirtyAt: now,
				sourceLevelDescriptionDirtyAt: now,
				semanticDirtyAt: now,
				updatedAt: now,
			},
		})
		.returning({ id: compiledLocalConcepts.id })
	return concept
}

async function upsertEvidenceRows(args: {
	conceptId: string
	paperId: string
	blockIds: string[]
	snippet: string
}) {
	const rows = uniqueStrings(args.blockIds).map((blockId) => ({
		conceptId: args.conceptId,
		paperId: args.paperId,
		blockId,
		snippet: args.snippet.slice(0, 220),
		confidence: 0.65,
	}))
	if (rows.length === 0) return
	await db.insert(compiledLocalConceptEvidence).values(rows).onConflictDoNothing()
}

async function upsertNoteObservation(args: {
	conceptId: string
	workspaceId: string
	paperId: string
	userId: string
	noteId: string
	blockIds: string[]
	observationText: string
	observedAt: Date
}) {
	const now = new Date()
	await db
		.insert(conceptObservations)
		.values({
			workspaceId: args.workspaceId,
			ownerUserId: args.userId,
			paperId: args.paperId,
			localConceptId: args.conceptId,
			sourceType: "note",
			sourceId: noteSourceId(args.noteId),
			blockIds: uniqueStrings(args.blockIds),
			observationText: args.observationText,
			signalWeight: NOTE_OBSERVATION_WEIGHT,
			observedAt: args.observedAt,
			consolidatedAt: now,
			deletedAt: null,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: [
				conceptObservations.workspaceId,
				conceptObservations.ownerUserId,
				conceptObservations.localConceptId,
				conceptObservations.sourceType,
				conceptObservations.sourceId,
			],
			set: {
				blockIds: sql`excluded.block_ids`,
				observationText: sql`excluded.observation_text`,
				signalWeight: sql`excluded.signal_weight`,
				observedAt: sql`excluded.observed_at`,
				consolidatedAt: sql`excluded.consolidated_at`,
				deletedAt: null,
				updatedAt: now,
			},
		})
}

function noteSourceId(noteId: string) {
	return `note:${noteId}`
}

function skipped(noteId: string, reason: string) {
	return {
		noteId,
		paperId: null,
		workspaceId: null,
		status: "skipped" as const,
		reason,
		groundedConceptCount: 0,
		questionCount: 0,
		touchedConceptCount: 0,
	}
}

function formatPaperAuthors(paper: Paper) {
	return Array.isArray(paper.authors) && paper.authors.length > 0
		? paper.authors.join(", ")
		: "(unknown)"
}

function normalizeCanonicalName(value: string) {
	return value
		.trim()
		.toLowerCase()
		.replace(/\s+/g, " ")
		.replace(/^[^\p{L}\p{N}(]+|[^\p{L}\p{N})]+$/gu, "")
}

function uniqueStrings(values: string[]) {
	const seen = new Set<string>()
	const result: string[] = []
	for (const value of values) {
		const trimmed = value.trim()
		if (!trimmed || seen.has(trimmed)) continue
		seen.add(trimmed)
		result.push(trimmed)
	}
	return result
}

function truncateText(value: string, maxLength: number) {
	const normalized = value.replace(/\s+/g, " ").trim()
	if (normalized.length <= maxLength) return normalized
	return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

type BlockWithBbox = { blockId: string; page: number | null; bbox: unknown }
type Rect = { x: number; y: number; width: number; height: number }

function annotationBodyBoundingBox(body: unknown): Rect | null {
	if (!body || typeof body !== "object") return null
	const rects = (body as { rects?: unknown }).rects
	if (!Array.isArray(rects) || rects.length === 0) return null
	const validRects = rects.map(normalizeRect).filter((rect): rect is Rect => Boolean(rect))
	if (validRects.length === 0) return null
	const minX = Math.min(...validRects.map((rect) => rect.x))
	const minY = Math.min(...validRects.map((rect) => rect.y))
	const maxX = Math.max(...validRects.map((rect) => rect.x + rect.width))
	const maxY = Math.max(...validRects.map((rect) => rect.y + rect.height))
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function normalizeRect(value: unknown): Rect | null {
	if (!value || typeof value !== "object") return null
	const record = value as Record<string, unknown>
	const x = toFiniteNumber(record.x)
	const y = toFiniteNumber(record.y)
	const width = toFiniteNumber(record.width)
	const height = toFiniteNumber(record.height)
	if (x == null || y == null || width == null || height == null || width <= 0 || height <= 0) {
		return null
	}
	return { x, y, width, height }
}

function findOverlappingBlockId(blocks: BlockWithBbox[], page: number, rect: Rect | null) {
	if (!rect) return null
	let best: { blockId: string; overlap: number } | null = null
	for (const block of blocks) {
		if (block.page !== page) continue
		const bbox = normalizeRect(block.bbox)
		if (!bbox) continue
		const overlap = rectOverlapArea(rect, bbox)
		if (overlap <= 0) continue
		if (!best || overlap > best.overlap) best = { blockId: block.blockId, overlap }
	}
	return best?.blockId ?? null
}

function rectOverlapArea(a: Rect, b: Rect) {
	const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
	const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
	return x * y
}

function toFiniteNumber(value: unknown) {
	const num = typeof value === "number" ? value : Number(value)
	return Number.isFinite(num) ? num : null
}
