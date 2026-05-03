import { createHash } from "node:crypto"
import {
	blockHighlights,
	blocks,
	conceptObservations,
	compiledLocalConceptEvidence,
	compiledLocalConcepts,
	noteBlockRefs,
	notes,
	type Paper,
	papers,
} from "@sapientia/db"
import { fillPrompt, loadPrompt } from "@sapientia/shared"
import { and, asc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "../db"
import { getLlmCredential } from "./credentials"
import { completeObject } from "./llm-client"

export const CONCEPT_SOURCE_DESCRIPTION_PROMPT_VERSION = "concept-source-description-v1"
const READER_SIGNAL_PROMPT_VERSION = "reader-signal-deterministic-v1"
const MAX_CONCEPTS_PER_BATCH = 10
const MAX_EVIDENCE_SNIPPETS_PER_CONCEPT = 5
const MAX_EVIDENCE_TEXT_CHARS = 900
const SEMANTIC_GRAPH_CONCEPT_KINDS = new Set(["concept", "method", "task", "metric"])

const conceptDescriptionOutputSchema = z.object({
	concepts: z.array(
		z.object({
			localConceptId: z.string().min(1),
			description: z.string().min(1),
			confidence: z.coerce.number().min(0).max(1),
			usedEvidenceBlockIds: z.array(z.string().min(1)).default([]),
		}),
	),
})

type ConceptKind = "concept" | "method" | "task" | "metric" | "dataset" | "person" | "organization"

interface ConceptForDescription {
	id: string
	kind: ConceptKind
	canonicalName: string
	displayName: string
	sourceLevelDescriptionStatus: "pending" | "running" | "done" | "failed"
	sourceLevelDescriptionInputHash: string | null
	readerSignalSummaryInputHash: string | null
}

interface EvidenceForConcept {
	blockId: string
	snippet: string | null
	page: number | null
	text: string
}

interface ConceptDescriptionInput {
	localConceptId: string
	kind: ConceptKind
	canonicalName: string
	displayName: string
	evidenceBlocks: EvidenceForConcept[]
	inputHash: string
}

export async function compilePaperConceptDescriptions(args: {
	paperId: string
	workspaceId: string
	userId: string
	force?: boolean
}): Promise<{
	paperId: string
	workspaceId: string
	describedConceptCount: number
	skippedConceptCount: number
	failedConceptCount: number
	readerSignalConceptCount: number
}> {
	const { paperId, workspaceId, userId, force = false } = args

	const [paper] = await db.select().from(papers).where(eq(papers.id, paperId)).limit(1)
	if (!paper) throw new Error(`paper ${paperId} not found`)

	const concepts = await db
		.select({
			id: compiledLocalConcepts.id,
			kind: compiledLocalConcepts.kind,
			canonicalName: compiledLocalConcepts.canonicalName,
			displayName: compiledLocalConcepts.displayName,
			sourceLevelDescriptionStatus: compiledLocalConcepts.sourceLevelDescriptionStatus,
			sourceLevelDescriptionInputHash: compiledLocalConcepts.sourceLevelDescriptionInputHash,
			readerSignalSummaryInputHash: compiledLocalConcepts.readerSignalSummaryInputHash,
		})
		.from(compiledLocalConcepts)
		.where(
			and(
				eq(compiledLocalConcepts.paperId, paperId),
				eq(compiledLocalConcepts.workspaceId, workspaceId),
				eq(compiledLocalConcepts.ownerUserId, userId),
				isNull(compiledLocalConcepts.deletedAt),
			),
		)
		.orderBy(asc(compiledLocalConcepts.kind), asc(compiledLocalConcepts.displayName))

	if (concepts.length === 0) {
		return {
			paperId,
			workspaceId,
			describedConceptCount: 0,
			skippedConceptCount: 0,
			failedConceptCount: 0,
			readerSignalConceptCount: 0,
		}
	}

	const readerSignalConceptCount = await refreshConceptReaderSignalSummaries({
		paperId,
		workspaceId,
		userId,
		concepts,
	})

	const descriptionInputs = await buildConceptDescriptionInputs({
		paper,
		concepts,
		paperId,
	})
	const eligibleInputs = descriptionInputs.filter((input) => {
		const concept = concepts.find((item) => item.id === input.localConceptId)
		if (!concept) return false
		if (!input.evidenceBlocks.length) return false
		return (
			force ||
			concept.sourceLevelDescriptionStatus !== "done" ||
			concept.sourceLevelDescriptionInputHash !== input.inputHash
		)
	})
	const skippedConceptCount = descriptionInputs.length - eligibleInputs.length

	if (eligibleInputs.length === 0) {
		return {
			paperId,
			workspaceId,
			describedConceptCount: 0,
			skippedConceptCount,
			failedConceptCount: 0,
			readerSignalConceptCount,
		}
	}

	const credential = await getLlmCredential(userId)
	if (!credential) {
		return {
			paperId,
			workspaceId,
			describedConceptCount: 0,
			skippedConceptCount,
			failedConceptCount: 0,
			readerSignalConceptCount,
		}
	}

	let describedConceptCount = 0
	let failedConceptCount = 0
	const now = new Date()
	await db
		.update(compiledLocalConcepts)
		.set({
			sourceLevelDescriptionStatus: "running",
			sourceLevelDescriptionError: null,
			sourceLevelDescriptionDirtyAt: null,
			updatedAt: now,
		})
		.where(inArray(compiledLocalConcepts.id, eligibleInputs.map((input) => input.localConceptId)))

	for (const batch of chunk(eligibleInputs, MAX_CONCEPTS_PER_BATCH)) {
		try {
			const prompt = fillPrompt(loadPrompt(CONCEPT_SOURCE_DESCRIPTION_PROMPT_VERSION), {
				title: paper.title,
				authors: (paper.authors ?? []).join(", "),
				conceptEvidence: formatConceptEvidenceForPrompt(batch),
			})
			const result = await completeObject({
				userId,
				workspaceId,
				promptId: CONCEPT_SOURCE_DESCRIPTION_PROMPT_VERSION,
				model: credential.model,
				messages: [{ role: "user", content: prompt }],
				schema: conceptDescriptionOutputSchema,
				maxTokens: 12_000,
				temperature: 0.2,
			})
			const batchResult = await applyConceptDescriptionOutput({
				batch,
				output: result.object,
				model: result.model,
			})
			describedConceptCount += batchResult.describedConceptCount
			failedConceptCount += batchResult.failedConceptCount
		} catch (error) {
			failedConceptCount += batch.length
			await markConceptDescriptionsFailed(
				batch.map((input) => input.localConceptId),
				error instanceof Error ? error.message : "concept description generation failed",
			)
		}
	}

	return {
		paperId,
		workspaceId,
		describedConceptCount,
		skippedConceptCount,
		failedConceptCount,
		readerSignalConceptCount,
	}
}

export async function refreshPaperConceptReaderSignals(args: {
	paperId: string
	workspaceId: string
	userId: string
}): Promise<{
	paperId: string
	workspaceId: string
	readerSignalConceptCount: number
}> {
	const { paperId, workspaceId, userId } = args

	const concepts = await db
		.select({
			id: compiledLocalConcepts.id,
			kind: compiledLocalConcepts.kind,
			canonicalName: compiledLocalConcepts.canonicalName,
			displayName: compiledLocalConcepts.displayName,
			sourceLevelDescriptionStatus: compiledLocalConcepts.sourceLevelDescriptionStatus,
			sourceLevelDescriptionInputHash: compiledLocalConcepts.sourceLevelDescriptionInputHash,
			readerSignalSummaryInputHash: compiledLocalConcepts.readerSignalSummaryInputHash,
		})
		.from(compiledLocalConcepts)
		.where(
			and(
				eq(compiledLocalConcepts.paperId, paperId),
				eq(compiledLocalConcepts.workspaceId, workspaceId),
				eq(compiledLocalConcepts.ownerUserId, userId),
				isNull(compiledLocalConcepts.deletedAt),
			),
		)
		.orderBy(asc(compiledLocalConcepts.kind), asc(compiledLocalConcepts.displayName))

	if (concepts.length === 0) {
		return { paperId, workspaceId, readerSignalConceptCount: 0 }
	}

	const readerSignalConceptCount = await refreshConceptReaderSignalSummaries({
		paperId,
		workspaceId,
		userId,
		concepts,
	})

	return { paperId, workspaceId, readerSignalConceptCount }
}

async function refreshConceptReaderSignalSummaries(args: {
	paperId: string
	workspaceId: string
	userId: string
	concepts: ConceptForDescription[]
}) {
	const { paperId, workspaceId, userId, concepts } = args
	const conceptIds = concepts.map((concept) => concept.id)
	const evidenceRows = await db
		.select({
			conceptId: compiledLocalConceptEvidence.conceptId,
			blockId: compiledLocalConceptEvidence.blockId,
		})
		.from(compiledLocalConceptEvidence)
		.where(inArray(compiledLocalConceptEvidence.conceptId, conceptIds))

	const evidenceByConceptId = groupBlockIdsByConcept(evidenceRows)
	const evidenceBlockIds = [...new Set(evidenceRows.map((row) => row.blockId))]
	if (evidenceBlockIds.length === 0) return 0

	const highlightRows = await db
		.select({
			id: blockHighlights.id,
			blockId: blockHighlights.blockId,
			color: blockHighlights.color,
			updatedAt: blockHighlights.updatedAt,
		})
		.from(blockHighlights)
		.where(
			and(
				eq(blockHighlights.paperId, paperId),
				eq(blockHighlights.workspaceId, workspaceId),
				eq(blockHighlights.userId, userId),
				inArray(blockHighlights.blockId, evidenceBlockIds),
			),
		)

	const noteRows = await db
		.select({
			noteId: notes.id,
			blockId: noteBlockRefs.blockId,
			citationCount: noteBlockRefs.citationCount,
			noteTitle: notes.title,
			noteMarkdown: notes.agentMarkdownCache,
			noteUpdatedAt: notes.updatedAt,
		})
		.from(noteBlockRefs)
		.innerJoin(notes, eq(notes.id, noteBlockRefs.noteId))
		.where(
			and(
				eq(noteBlockRefs.paperId, paperId),
				eq(notes.paperId, paperId),
				eq(notes.workspaceId, workspaceId),
				eq(notes.ownerUserId, userId),
				isNull(notes.deletedAt),
				inArray(noteBlockRefs.blockId, evidenceBlockIds),
			),
		)

	let changedCount = 0
	for (const concept of concepts) {
		const blockIds = new Set(evidenceByConceptId.get(concept.id) ?? [])
		const conceptHighlights = highlightRows.filter((row) => blockIds.has(row.blockId))
		const conceptNotes = noteRows.filter((row) => blockIds.has(row.blockId))
		await syncConceptObservations({
			workspaceId,
			userId,
			paperId,
			conceptId: concept.id,
			highlights: conceptHighlights,
			notes: conceptNotes,
		})
		const inputHash = stableHash({
			conceptId: concept.id,
			highlights: conceptHighlights.map((row) => ({
				blockId: row.blockId,
				color: row.color,
				updatedAt: row.updatedAt.toISOString(),
			})),
			notes: conceptNotes.map((row) => ({
				blockId: row.blockId,
				citationCount: row.citationCount,
				noteUpdatedAt: row.noteUpdatedAt.toISOString(),
				noteMarkdownHash: stableHash(row.noteMarkdown),
			})),
			version: READER_SIGNAL_PROMPT_VERSION,
		})
		const summary = buildReaderSignalSummary(conceptHighlights, conceptNotes)
		if (concept.readerSignalSummaryInputHash === inputHash) continue
		await db
			.update(compiledLocalConcepts)
			.set({
				readerSignalSummary: summary,
				readerSignalSummaryGeneratedAt: new Date(),
				readerSignalSummaryModel: "deterministic",
				readerSignalSummaryPromptVersion: READER_SIGNAL_PROMPT_VERSION,
				readerSignalSummaryStatus: "done",
				readerSignalSummaryError: null,
				readerSignalSummaryInputHash: inputHash,
				readerSignalDirtyAt: null,
				updatedAt: new Date(),
			})
			.where(eq(compiledLocalConcepts.id, concept.id))
		changedCount += 1
	}

	await db
		.update(compiledLocalConcepts)
		.set({
			readerSignalDirtyAt: null,
			updatedAt: new Date(),
		})
		.where(inArray(compiledLocalConcepts.id, conceptIds))

	return changedCount
}

async function syncConceptObservations(args: {
	workspaceId: string
	userId: string
	paperId: string
	conceptId: string
	highlights: Array<{
		id: string
		blockId: string
		color: string
		updatedAt: Date
	}>
	notes: Array<{
		noteId: string
		blockId: string
		citationCount: number
		noteTitle: string | null
		noteMarkdown: string | null
		noteUpdatedAt: Date
	}>
}) {
	const now = new Date()
	const activeSourceIds = [
		...args.highlights.map((row) => `highlight:${row.id}`),
		...args.notes.map((row) => `note:${row.noteId}`),
	]

	if (activeSourceIds.length > 0) {
		await db
			.update(conceptObservations)
			.set({ deletedAt: now, updatedAt: now })
			.where(
				and(
					eq(conceptObservations.workspaceId, args.workspaceId),
					eq(conceptObservations.ownerUserId, args.userId),
					eq(conceptObservations.paperId, args.paperId),
					eq(conceptObservations.localConceptId, args.conceptId),
					notInArray(conceptObservations.sourceId, activeSourceIds),
					isNull(conceptObservations.deletedAt),
				),
			)
	} else {
		await db
			.update(conceptObservations)
			.set({ deletedAt: now, updatedAt: now })
			.where(
				and(
					eq(conceptObservations.workspaceId, args.workspaceId),
					eq(conceptObservations.ownerUserId, args.userId),
					eq(conceptObservations.paperId, args.paperId),
					eq(conceptObservations.localConceptId, args.conceptId),
					isNull(conceptObservations.deletedAt),
				),
			)
		return
	}

	const noteRowsById = new Map<
		string,
		{
			noteId: string
			blockIds: string[]
			citationCount: number
			noteTitle: string | null
			noteMarkdown: string | null
			noteUpdatedAt: Date
		}
	>()
	for (const row of args.notes) {
		const existing = noteRowsById.get(row.noteId)
		if (!existing) {
			noteRowsById.set(row.noteId, {
				noteId: row.noteId,
				blockIds: [row.blockId],
				citationCount: row.citationCount,
				noteTitle: row.noteTitle,
				noteMarkdown: row.noteMarkdown,
				noteUpdatedAt: row.noteUpdatedAt,
			})
			continue
		}
		existing.blockIds = uniqueStrings([...existing.blockIds, row.blockId])
		existing.citationCount += row.citationCount
		if (row.noteUpdatedAt > existing.noteUpdatedAt) existing.noteUpdatedAt = row.noteUpdatedAt
	}

	const observationRows = [
		...args.highlights.map((row) => ({
			workspaceId: args.workspaceId,
			ownerUserId: args.userId,
			paperId: args.paperId,
			localConceptId: args.conceptId,
			sourceType: "highlight" as const,
			sourceId: `highlight:${row.id}`,
			blockIds: [row.blockId],
			observationText: `Highlight color: ${row.color}`,
			signalWeight: highlightObservationWeight(row.color),
			observedAt: row.updatedAt,
			consolidatedAt: now,
			deletedAt: null,
			updatedAt: now,
		})),
		...[...noteRowsById.values()].map((row) => ({
			workspaceId: args.workspaceId,
			ownerUserId: args.userId,
			paperId: args.paperId,
			localConceptId: args.conceptId,
			sourceType: "note" as const,
			sourceId: `note:${row.noteId}`,
			blockIds: row.blockIds,
			observationText: truncateText(
				[row.noteTitle, row.noteMarkdown].filter(Boolean).join("\n\n"),
				1_200,
			),
			signalWeight: row.citationCount,
			observedAt: row.noteUpdatedAt,
			consolidatedAt: now,
			deletedAt: null,
			updatedAt: now,
		})),
	]

	if (observationRows.length === 0) return
	await db
		.insert(conceptObservations)
		.values(observationRows)
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

async function buildConceptDescriptionInputs(args: {
	paper: Paper
	concepts: ConceptForDescription[]
	paperId: string
}) {
	const { paper, concepts, paperId } = args
	const conceptIds = concepts.map((concept) => concept.id)
	const evidenceRows = await db
		.select({
			conceptId: compiledLocalConceptEvidence.conceptId,
			blockId: compiledLocalConceptEvidence.blockId,
			snippet: compiledLocalConceptEvidence.snippet,
		})
		.from(compiledLocalConceptEvidence)
		.where(inArray(compiledLocalConceptEvidence.conceptId, conceptIds))

	const blockIds = [...new Set(evidenceRows.map((row) => row.blockId))]
	const blockRows =
		blockIds.length === 0
			? []
			: await db
					.select({
						blockId: blocks.blockId,
						page: blocks.page,
						text: blocks.text,
					})
					.from(blocks)
					.where(and(eq(blocks.paperId, paperId), inArray(blocks.blockId, blockIds)))

	const blockById = new Map(blockRows.map((block) => [block.blockId, block]))
	const evidenceByConceptId = new Map<
		string,
		Array<{ blockId: string; snippet: string | null; text: string; page: number | null }>
	>()
	for (const row of evidenceRows) {
		const block = blockById.get(row.blockId)
		const bucket = evidenceByConceptId.get(row.conceptId) ?? []
		bucket.push({
			blockId: row.blockId,
			snippet: row.snippet,
			text: block?.text ?? row.snippet ?? "",
			page: block?.page ?? null,
		})
		evidenceByConceptId.set(row.conceptId, bucket)
	}

	return concepts.map<ConceptDescriptionInput>((concept) => {
		const evidenceBlocks = (evidenceByConceptId.get(concept.id) ?? [])
			.slice(0, MAX_EVIDENCE_SNIPPETS_PER_CONCEPT)
			.map((item) => ({
				blockId: item.blockId,
				snippet: item.snippet,
				page: item.page,
				text: truncateText(item.text || item.snippet || "", MAX_EVIDENCE_TEXT_CHARS),
			}))
		const inputHash = stableHash({
			version: CONCEPT_SOURCE_DESCRIPTION_PROMPT_VERSION,
			paperTitle: paper.title,
			kind: concept.kind,
			canonicalName: concept.canonicalName,
			displayName: concept.displayName,
			evidenceBlocks,
		})
		return {
			localConceptId: concept.id,
			kind: concept.kind,
			canonicalName: concept.canonicalName,
			displayName: concept.displayName,
			evidenceBlocks,
			inputHash,
		}
	})
}

async function applyConceptDescriptionOutput(args: {
	batch: ConceptDescriptionInput[]
	output: z.infer<typeof conceptDescriptionOutputSchema>
	model: string
}) {
	const { batch, output, model } = args
	const inputById = new Map(batch.map((input) => [input.localConceptId, input]))
	const outputById = new Map(output.concepts.map((item) => [item.localConceptId, item]))
	let describedConceptCount = 0
	let failedConceptCount = 0
	const now = new Date()

	for (const input of batch) {
		const item = outputById.get(input.localConceptId)
		if (!item) {
			failedConceptCount += 1
			await markConceptDescriptionsFailed([input.localConceptId], "missing concept in LLM output")
			continue
		}
		const validEvidence = new Set(input.evidenceBlocks.map((block) => block.blockId))
		const usedEvidenceBlockIds = item.usedEvidenceBlockIds.filter((blockId) => validEvidence.has(blockId))
		await db
			.update(compiledLocalConcepts)
			.set({
				sourceLevelDescription: item.description.trim(),
				sourceLevelDescriptionConfidence: clamp01(item.confidence),
				sourceLevelDescriptionGeneratedAt: now,
				sourceLevelDescriptionModel: model,
				sourceLevelDescriptionPromptVersion: CONCEPT_SOURCE_DESCRIPTION_PROMPT_VERSION,
				sourceLevelDescriptionStatus: "done",
				sourceLevelDescriptionError: null,
				sourceLevelDescriptionInputHash: input.inputHash,
				sourceLevelDescriptionDirtyAt: null,
				semanticFingerprint: stableHash({
					version: "semantic-fingerprint-v1",
					kind: input.kind,
					canonicalName: input.canonicalName,
					sourceLevelDescription: item.description.trim(),
					evidenceBlockIds: input.evidenceBlocks.map((block) => block.blockId),
				}),
				semanticDirtyAt: SEMANTIC_GRAPH_CONCEPT_KINDS.has(input.kind) ? now : null,
				confidenceScore: clamp01(item.confidence),
				updatedAt: now,
			})
			.where(eq(compiledLocalConcepts.id, input.localConceptId))
		if (usedEvidenceBlockIds.length === 0 && input.evidenceBlocks.length > 0) {
			// The description can still be useful, but this makes weak grounding
			// visible in logs later if we decide to audit the job outputs.
		}
		describedConceptCount += inputById.has(input.localConceptId) ? 1 : 0
	}

	return { describedConceptCount, failedConceptCount }
}

async function markConceptDescriptionsFailed(conceptIds: string[], error: string) {
	if (conceptIds.length === 0) return
	await db
		.update(compiledLocalConcepts)
		.set({
			sourceLevelDescriptionStatus: "failed",
			sourceLevelDescriptionError: error.slice(0, 500),
			updatedAt: new Date(),
		})
		.where(inArray(compiledLocalConcepts.id, conceptIds))
}

function buildReaderSignalSummary(
	highlights: Array<{ color: string }>,
	notesForConcept: Array<{ citationCount: number }>,
) {
	const highlightCount = highlights.length
	const noteCitationCount = notesForConcept.reduce((sum, row) => sum + row.citationCount, 0)
	if (highlightCount === 0 && noteCitationCount === 0) return null

	const colorCounts = highlights.reduce<Record<string, number>>((counts, row) => {
		counts[row.color] = (counts[row.color] ?? 0) + 1
		return counts
	}, {})
	const colorSummary = Object.entries(colorCounts)
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([color, count]) => `${count} ${color}`)
		.join(", ")

	const parts = []
	if (highlightCount > 0) parts.push(`highlighted on ${highlightCount} evidence block(s): ${colorSummary}`)
	if (noteCitationCount > 0) parts.push(`cited ${noteCitationCount} time(s) in notes`)
	return `Reader signal: ${parts.join("; ")}.`
}

function highlightObservationWeight(color: string) {
	if (color === "important") return 1.2
	if (color === "original") return 1.1
	if (color === "questioning") return 0.9
	if (color === "pending") return 0.7
	if (color === "background") return 0.35
	return 0.6
}

function uniqueStrings(values: string[]) {
	return [...new Set(values.filter(Boolean))]
}

function formatConceptEvidenceForPrompt(batch: ConceptDescriptionInput[]) {
	return batch
		.map((concept) => {
			const blocksText = concept.evidenceBlocks
				.map((block) => {
					const page = block.page == null ? "" : ` p.${block.page}`
					return `- ${block.blockId}${page}: ${block.text}`
				})
				.join("\n")
			return [
				`localConceptId: ${concept.localConceptId}`,
				`kind: ${concept.kind}`,
				`displayName: ${concept.displayName}`,
				`canonicalName: ${concept.canonicalName}`,
				"evidenceBlocks:",
				blocksText || "- none",
			].join("\n")
		})
		.join("\n\n---\n\n")
}

function groupBlockIdsByConcept(rows: Array<{ conceptId: string; blockId: string }>) {
	const map = new Map<string, string[]>()
	for (const row of rows) {
		const bucket = map.get(row.conceptId) ?? []
		bucket.push(row.blockId)
		map.set(row.conceptId, bucket)
	}
	return map
}

function stableHash(value: unknown) {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function truncateText(text: string, maxChars: number) {
	return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`
}

function clamp01(value: number) {
	if (Number.isNaN(value)) return 0
	return Math.max(0, Math.min(1, value))
}

function chunk<T>(items: T[], size: number) {
	const chunks: T[][] = []
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size))
	}
	return chunks
}
