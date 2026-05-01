import {
	blocks as blocksTable,
	compiledLocalConceptEvidence as compiledLocalConceptEvidenceTable,
	compiledLocalConcepts as compiledLocalConceptsTable,
	papers,
	workspacePapers,
	wikiPageReferences as wikiPageReferencesTable,
	wikiPages as wikiPagesTable,
} from "@sapientia/db"
import { fillPrompt, formatBlocksForAgent, loadPrompt } from "@sapientia/shared"
import { and, asc, eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "../db"
import { getLlmCredential } from "./credentials"
import { completeObject, LlmCredentialMissingError } from "./llm-client"

const COMPILE_PROMPT_ID = "paper-compile-v1"
const MAX_BLOCK_CONTENT_CHARS = 120_000
const MAX_CONCEPT_EVIDENCE_BLOCK_IDS = 200
const MAX_PAGE_REFERENCE_BLOCK_IDS = 500

const conceptKindSchema = z.enum([
	"concept",
	"method",
	"task",
	"metric",
	"dataset",
	"person",
	"organization",
])

type ConceptKind = z.infer<typeof conceptKindSchema>

const conceptKindAliasMap: Record<string, ConceptKind> = {
	algorithm: "method",
	algorithms: "method",
	approach: "method",
	approaches: "method",
	architecture: "method",
	architectures: "method",
	baseline: "method",
	baselines: "method",
	benchmark: "dataset",
	benchmarks: "dataset",
	evaluation: "metric",
	evaluations: "metric",
	concepts: "concept",
	entity: "concept",
	entities: "concept",
	feature: "concept",
	features: "concept",
	framework: "method",
	frameworks: "method",
	measure: "metric",
	measures: "metric",
	model: "method",
	models: "method",
	methods: "method",
	objective: "metric",
	objectives: "metric",
	tasks: "task",
	metrics: "metric",
	datasets: "dataset",
	people: "person",
	persons: "person",
	authors: "person",
	institutions: "organization",
	organizations: "organization",
	organisations: "organization",
	affiliations: "organization",
}
const allowedConceptKinds = new Set<ConceptKind>(conceptKindSchema.options)

const extractedConceptSchema = z.object({
	kind: z.preprocess(normalizeConceptKind, conceptKindSchema),
	canonicalName: z.string().min(1),
	displayName: z.string().min(1),
	evidenceBlockIds: z.preprocess(coerceBlockIdArray, z.array(z.string().min(1)).default([])),
})

export const paperCompileResultSchema = z.preprocess(normalizePaperCompileResult, z.object({
	summary: z.string().min(1),
	referenceBlockIds: z.preprocess(coerceBlockIdArray, z.array(z.string().min(1)).default([])),
	concepts: z.preprocess(normalizeConceptArray, z.array(extractedConceptSchema).default([])),
}))

type ExtractedConcept = z.infer<typeof extractedConceptSchema>
type SanitizedConcept = {
	kind: ConceptKind
	canonicalName: string
	displayName: string
	evidence: Array<{
		blockId: string
		snippet: string | null
		confidence: number | null
	}>
}

function normalizePaperCompileResult(value: unknown) {
	if (!isRecord(value)) return value

	return {
		...value,
		summary:
			firstStringField(value, ["summary", "body", "sourcePage", "source_page", "sourcePageBody"]) ??
			value.summary,
		referenceBlockIds:
			firstField(value, [
				"referenceBlockIds",
				"reference_block_ids",
				"referenceBlocks",
				"reference_blocks",
				"references",
				"pageReferences",
				"page_references",
			]) ?? value.referenceBlockIds,
		concepts:
			firstField(value, ["concepts", "localConcepts", "local_concepts", "entities", "nodes"]) ??
			value.concepts,
	}
}

function normalizeConceptArray(value: unknown) {
	if (Array.isArray(value)) return value.map(normalizeConceptObject)
	if (isRecord(value)) return Object.values(value).map(normalizeConceptObject)
	return value
}

function normalizeConceptObject(value: unknown) {
	if (!isRecord(value)) return value

	const displayName =
		firstStringField(value, ["displayName", "display_name", "name", "term", "label", "title"]) ?? ""
	const canonicalName =
		firstStringField(value, [
			"canonicalName",
			"canonical_name",
			"canonical",
			"normalizedName",
			"normalized_name",
			"name",
			"term",
			"label",
		]) ?? displayName

	return {
		...value,
		kind: firstField(value, ["kind", "type", "category", "nodeType", "node_type"]) ?? value.kind,
		canonicalName,
		displayName,
		evidenceBlockIds:
			firstField(value, [
				"evidenceBlockIds",
				"evidence_block_ids",
				"evidenceBlocks",
				"evidence_blocks",
				"blockIds",
				"block_ids",
				"evidence",
				"references",
			]) ?? value.evidenceBlockIds,
	}
}

function normalizeConceptKind(value: unknown) {
	if (typeof value !== "string") return value
	const normalized = value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ")
	const singular = normalized.endsWith("s") ? normalized.slice(0, -1) : normalized
	const aliased = conceptKindAliasMap[normalized] ?? conceptKindAliasMap[singular] ?? normalized
	return allowedConceptKinds.has(aliased as ConceptKind) ? aliased : "concept"
}

function coerceBlockIdArray(value: unknown) {
	if (value == null) return []
	const values = Array.isArray(value) ? value : [value]
	return values.flatMap((item) => {
		if (typeof item === "string") return [item]
		if (!isRecord(item)) return []
		const blockId = firstStringField(item, [
			"blockId",
			"block_id",
			"id",
			"sourceBlockId",
			"source_block_id",
			"referenceBlockId",
			"reference_block_id",
		])
		return blockId ? [blockId] : []
	})
}

function firstField(value: Record<string, unknown>, keys: string[]) {
	for (const key of keys) {
		if (value[key] !== undefined) return value[key]
	}
	return undefined
}

function firstStringField(value: Record<string, unknown>, keys: string[]) {
	const field = firstField(value, keys)
	return typeof field === "string" ? field : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === "object" && !Array.isArray(value)
}

export interface CompilePaperResult {
	paperId: string
	workspaceCount: number
	conceptCount: number
	summaryChars: number
	model: string
}

export async function markPaperCompilePending(args: { paperId: string; userId: string }) {
	await upsertSourcePageStatus({
		paperId: args.paperId,
		userId: args.userId,
		status: "pending",
		error: null,
		promptVersion: COMPILE_PROMPT_ID,
	})
}

export async function markPaperCompileRunning(args: { paperId: string; userId: string }) {
	await upsertSourcePageStatus({
		paperId: args.paperId,
		userId: args.userId,
		status: "running",
		error: null,
		promptVersion: COMPILE_PROMPT_ID,
	})
}

export async function markPaperCompileFailed(args: {
	paperId: string
	userId: string
	error: string
}) {
	await upsertSourcePageStatus({
		paperId: args.paperId,
		userId: args.userId,
		status: "failed",
		error: args.error.slice(0, 500),
		promptVersion: COMPILE_PROMPT_ID,
	})
}

export async function compilePaper(args: {
	paperId: string
	userId: string
}): Promise<CompilePaperResult> {
	const { paperId, userId } = args

	const [paper] = await db.select().from(papers).where(eq(papers.id, paperId)).limit(1)
	if (!paper) throw new Error(`paper ${paperId} not found`)

	const workspaceLinks = await db
		.select({ workspaceId: workspacePapers.workspaceId })
		.from(workspacePapers)
		.where(eq(workspacePapers.paperId, paperId))

	if (workspaceLinks.length === 0) {
		throw new Error(`paper ${paperId} has no workspace links`)
	}

	const credential = await getLlmCredential(userId)
	if (!credential) throw new LlmCredentialMissingError()

	const paperBlocks = await db
		.select()
		.from(blocksTable)
		.where(eq(blocksTable.paperId, paperId))
		.orderBy(asc(blocksTable.blockIndex))

	const blockIds = new Set(paperBlocks.map((block) => block.blockId))
	const blockTextById = new Map(paperBlocks.map((block) => [block.blockId, block.text] as const))

	let blockText = formatBlocksForAgent({
		blocks: paperBlocks.map((b) => ({
			blockId: b.blockId,
			type: b.type,
			text: b.text,
			headingLevel: b.headingLevel,
		})),
		highlights: [],
	})
	if (blockText.length > MAX_BLOCK_CONTENT_CHARS) {
		blockText = `${blockText.slice(0, MAX_BLOCK_CONTENT_CHARS)}\n\n[paper continues — content truncated for context window]`
	}

	const compilePrompt = fillPrompt(loadPrompt(COMPILE_PROMPT_ID), {
		title: paper.title || "(untitled paper)",
		authors:
			Array.isArray(paper.authors) && paper.authors.length > 0
				? paper.authors.join(", ")
				: "(unknown)",
		abstractBlock: "",
		blocks: blockText,
	})

	const compileResult = await completeObject({
		userId,
		promptId: COMPILE_PROMPT_ID,
		model: credential.model,
		schema: paperCompileResultSchema,
		messages: [{ role: "user", content: compilePrompt }],
		maxTokens: 32_000,
		temperature: 0.25,
	})

	const compiled = compileResult.object
	const summaryText = compiled.summary.trim()
	const sanitizedConcepts = sanitizeExtractedConcepts(compiled.concepts, blockIds, blockTextById)
	const summaryReferenceBlockIds = extractBlockIdsFromSummary(summaryText)
	const conceptEvidenceBlockIds = sanitizedConcepts.flatMap((concept) =>
		concept.evidence.map((evidence) => evidence.blockId),
	)
	const pageReferenceBlockIds = uniqueValidBlockIds(
		[
			...compiled.referenceBlockIds,
			...summaryReferenceBlockIds,
			...conceptEvidenceBlockIds,
		],
		blockIds,
		MAX_PAGE_REFERENCE_BLOCK_IDS,
	)

	const generatedAt = new Date()
	const sourcePageCanonicalName = `paper:${paperId}`
	const sourcePageDisplayName = paper.title || "Untitled paper"

	await db.transaction(async (tx) => {
		await tx
			.update(papers)
			.set({
				summary: summaryText,
				summaryStatus: "done",
				summaryGeneratedAt: generatedAt,
				summaryModel: compileResult.model,
				summaryPromptVersion: COMPILE_PROMPT_ID,
				summaryError: null,
				updatedAt: new Date(),
			})
			.where(eq(papers.id, paperId))

		for (const { workspaceId } of workspaceLinks) {
			await tx
				.delete(wikiPagesTable)
				.where(
					and(
						eq(wikiPagesTable.workspaceId, workspaceId),
						eq(wikiPagesTable.ownerUserId, userId),
						eq(wikiPagesTable.type, "source"),
						eq(wikiPagesTable.sourcePaperId, paperId),
					),
				)

			await tx
				.delete(compiledLocalConceptsTable)
				.where(
					and(
						eq(compiledLocalConceptsTable.workspaceId, workspaceId),
						eq(compiledLocalConceptsTable.ownerUserId, userId),
						eq(compiledLocalConceptsTable.paperId, paperId),
					),
				)

			const insertedConcepts =
				sanitizedConcepts.length > 0
					? await tx
							.insert(compiledLocalConceptsTable)
							.values(
								sanitizedConcepts.map((concept) => ({
									workspaceId,
									ownerUserId: userId,
									paperId,
									kind: concept.kind,
									canonicalName: concept.canonicalName,
									displayName: concept.displayName,
									generatedAt,
									modelName: compileResult.model,
									promptVersion: COMPILE_PROMPT_ID,
									status: "done" as const,
									error: null,
								})),
							)
							.returning({
								id: compiledLocalConceptsTable.id,
								canonicalName: compiledLocalConceptsTable.canonicalName,
								kind: compiledLocalConceptsTable.kind,
							})
					: []

			if (insertedConcepts.length > 0) {
				const conceptIdByKey = new Map(
					insertedConcepts.map((row) => [`${row.kind}::${row.canonicalName}`, row.id] as const),
				)
				const evidenceRows = sanitizedConcepts.flatMap((concept) => {
					const conceptId = conceptIdByKey.get(`${concept.kind}::${concept.canonicalName}`)
					if (!conceptId) return []
					return concept.evidence.map((evidence) => ({
						conceptId,
						paperId,
						blockId: evidence.blockId,
						snippet: evidence.snippet ?? null,
						confidence: evidence.confidence ?? null,
					}))
				})

				if (evidenceRows.length > 0) {
					await tx.insert(compiledLocalConceptEvidenceTable).values(evidenceRows)
				}
			}

			const [sourcePage] = await tx
				.insert(wikiPagesTable)
				.values({
					workspaceId,
					ownerUserId: userId,
					type: "source",
					canonicalName: sourcePageCanonicalName,
					displayName: sourcePageDisplayName,
					sourcePaperId: paperId,
					compiledConceptId: null,
					body: summaryText,
					generatedAt,
					modelName: compileResult.model,
					promptVersion: COMPILE_PROMPT_ID,
					status: "done",
					error: null,
				})
				.returning({ id: wikiPagesTable.id })

			if (pageReferenceBlockIds.length > 0) {
				await tx.insert(wikiPageReferencesTable).values(
					pageReferenceBlockIds.map((blockId) => ({
						pageId: sourcePage.id,
						paperId,
						blockId,
					})),
				)
			}
		}
	})

	return {
		paperId,
		workspaceCount: workspaceLinks.length,
		conceptCount: sanitizedConcepts.length,
		summaryChars: summaryText.length,
		model: compileResult.model,
	}
}

function sanitizeExtractedConcepts(
	concepts: ExtractedConcept[],
	validBlockIds: Set<string>,
	blockTextById: Map<string, string | null>,
) {
	const deduped = new Map<string, SanitizedConcept>()

	for (const concept of concepts) {
		const canonicalName = normalizeCanonicalName(concept.canonicalName)
		const displayName = concept.displayName.trim()
		if (!canonicalName || !displayName) continue

		const evidence = uniqueByBlockId(
			concept.evidenceBlockIds
				.map((blockId) => ({
					blockId: blockId.trim(),
					snippet: buildSnippet(blockTextById.get(blockId.trim()) ?? ""),
					confidence: null,
				}))
				.filter((item) => validBlockIds.has(item.blockId)),
		)

		if (evidence.length === 0) continue

		const key = `${concept.kind}::${canonicalName}`
		if (!deduped.has(key)) {
			deduped.set(key, {
				kind: concept.kind,
				canonicalName,
				displayName,
				evidence: evidence.slice(0, MAX_CONCEPT_EVIDENCE_BLOCK_IDS),
			})
			continue
		}

		const existing = deduped.get(key)!
		deduped.set(key, {
			...existing,
			displayName:
				existing.displayName.length >= displayName.length ? existing.displayName : displayName,
			evidence: uniqueByBlockId([...existing.evidence, ...evidence]).slice(
				0,
				MAX_CONCEPT_EVIDENCE_BLOCK_IDS,
			),
		})
	}

	return [...deduped.values()]
}

function uniqueByBlockId<T extends { blockId: string }>(items: T[]) {
	const seen = new Set<string>()
	const result: T[] = []
	for (const item of items) {
		if (seen.has(item.blockId)) continue
		seen.add(item.blockId)
		result.push(item)
	}
	return result
}

function uniqueValidBlockIds(
	blockIds: string[],
	validBlockIds: Set<string>,
	maxItems = Number.POSITIVE_INFINITY,
) {
	const result: string[] = []
	const seen = new Set<string>()
	for (const blockId of blockIds) {
		if (result.length >= maxItems) break
		const trimmed = blockId.trim()
		if (!trimmed || !validBlockIds.has(trimmed) || seen.has(trimmed)) continue
		seen.add(trimmed)
		result.push(trimmed)
	}
	return result
}

function normalizeCanonicalName(value: string) {
	return value
		.trim()
		.toLowerCase()
		.replace(/\s+/g, " ")
		.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
}

function buildSnippet(text: string) {
	const normalized = text.trim().replace(/\s+/g, " ")
	if (!normalized) return null
	return normalized.length <= 220 ? normalized : `${normalized.slice(0, 217)}...`
}

function extractBlockIdsFromSummary(summary: string) {
	return [...summary.matchAll(/\[blk\s+([a-zA-Z0-9_-]+)\]/g)].map((match) => match[1])
}

async function upsertSourcePageStatus(args: {
	paperId: string
	userId: string
	status: "pending" | "running" | "failed"
	error: string | null
	promptVersion: string
}) {
	const { paperId, userId, status, error, promptVersion } = args
	const workspaceLinks = await db
		.select({ workspaceId: workspacePapers.workspaceId })
		.from(workspacePapers)
		.where(eq(workspacePapers.paperId, paperId))

	if (workspaceLinks.length === 0) return

	const [paper] = await db.select().from(papers).where(eq(papers.id, paperId)).limit(1)
	const sourcePageCanonicalName = `paper:${paperId}`
	const sourcePageDisplayName = paper?.title || "Untitled paper"

	for (const { workspaceId } of workspaceLinks) {
		await db
			.insert(wikiPagesTable)
			.values({
				workspaceId,
				ownerUserId: userId,
				type: "source",
				canonicalName: sourcePageCanonicalName,
				displayName: sourcePageDisplayName,
				sourcePaperId: paperId,
				compiledConceptId: null,
				body: null,
				generatedAt: null,
				modelName: null,
				promptVersion,
				status,
				error,
			})
			.onConflictDoUpdate({
				target: [
					wikiPagesTable.ownerUserId,
					wikiPagesTable.workspaceId,
					wikiPagesTable.type,
					wikiPagesTable.sourcePaperId,
					wikiPagesTable.canonicalName,
				],
				set: {
					displayName: sourcePageDisplayName,
					promptVersion,
					status,
					error,
					updatedAt: new Date(),
				},
			})
	}
}
