import {
	type Block,
	blocks as blocksTable,
	compiledLocalConceptEvidence as compiledLocalConceptEvidenceTable,
	compiledLocalConcepts as compiledLocalConceptsTable,
	type Paper,
	papers,
	wikiPageReferences as wikiPageReferencesTable,
	wikiPages as wikiPagesTable,
	workspacePapers,
} from "@sapientia/db"
import { fillPrompt, formatBlocksForAgent, loadPrompt } from "@sapientia/shared"
import { and, asc, eq, isNull, ne, or } from "drizzle-orm"
import { z } from "zod"
import { db } from "../db"
import { getLlmCredential } from "./credentials"
import { completeObject, LlmCredentialMissingError } from "./llm-client"
import { buildPaperCompileWindows, type PaperCompileWindow } from "./paper-compile-windows"

export const PAPER_COMPILE_PROMPT_VERSION = "paper-compile-hierarchical-v1"
const SINGLE_PASS_PROMPT_ID = "paper-compile-v1"
const WINDOW_PROMPT_ID = "paper-compile-window-v1"
const REDUCE_PROMPT_ID = "paper-compile-reduce-v1"
const NOTE_CONCEPT_EXTRACT_PROMPT_VERSION = "note-concept-extract-v1"
const MAX_BLOCK_CONTENT_CHARS = 120_000
const HIERARCHICAL_WINDOW_CONCURRENCY = 4
const MAX_CONCEPT_EVIDENCE_BLOCK_IDS = 200
const MAX_PAGE_REFERENCE_BLOCK_IDS = 500
const MAX_WINDOW_REFERENCE_BLOCK_IDS = 24

const conceptKindSchema = z.enum(["concept", "method", "task", "metric", "dataset"])

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
	corpora: "dataset",
	corpus: "dataset",
	data: "dataset",
	"data source": "dataset",
	"data sources": "dataset",
	evaluation: "metric",
	evaluations: "metric",
	concepts: "concept",
	entity: "concept",
	entities: "concept",
	feature: "concept",
	features: "concept",
	finding: "concept",
	findings: "concept",
	framework: "method",
	frameworks: "method",
	intervention: "method",
	interventions: "method",
	measure: "metric",
	measures: "metric",
	measurement: "metric",
	measurements: "metric",
	model: "method",
	models: "method",
	methods: "method",
	objective: "task",
	objectives: "task",
	problem: "task",
	problems: "task",
	procedure: "method",
	procedures: "method",
	score: "metric",
	scores: "metric",
	system: "method",
	systems: "method",
	technique: "method",
	techniques: "method",
	tasks: "task",
	metrics: "metric",
	datasets: "dataset",
}
const allowedConceptKinds = new Set<ConceptKind>(conceptKindSchema.options)
const disallowedConceptKindAliases = new Set([
	"affiliation",
	"affiliations",
	"author",
	"authors",
	"company",
	"companies",
	"institution",
	"institutions",
	"lab",
	"labs",
	"organisation",
	"organisations",
	"organization",
	"organizations",
	"people",
	"person",
	"persons",
])
const genericConceptNames = new Set([
	"accuracy",
	"analysis",
	"approach",
	"approaches",
	"author",
	"authors",
	"benchmark",
	"benchmarks",
	"dataset",
	"datasets",
	"evaluation",
	"evaluations",
	"experiment",
	"experiments",
	"framework",
	"frameworks",
	"method",
	"methods",
	"metric",
	"metrics",
	"model",
	"models",
	"paper",
	"papers",
	"performance",
	"result",
	"results",
	"study",
	"system",
	"systems",
	"task",
	"tasks",
])

const extractedConceptSchema = z.object({
	kind: z.preprocess(normalizeConceptKind, conceptKindSchema),
	canonicalName: z.string().min(1),
	displayName: z.string().min(1),
	evidenceBlockIds: z.preprocess(coerceBlockIdArray, z.array(z.string().min(1)).default([])),
})

export const paperCompileResultSchema = z.preprocess(
	normalizePaperCompileResult,
	z.object({
		summary: z.string().min(1),
		referenceBlockIds: z.preprocess(coerceBlockIdArray, z.array(z.string().min(1)).default([])),
		concepts: z.preprocess(normalizeConceptArray, z.array(extractedConceptSchema).default([])),
	}),
)

const paperCompileWindowResultSchema = z.preprocess(
	normalizePaperCompileWindowResult,
	z.object({
		windowSummary: z.string().min(1),
		referenceBlockIds: z.preprocess(coerceBlockIdArray, z.array(z.string().min(1)).default([])),
		concepts: z.preprocess(normalizeConceptArray, z.array(extractedConceptSchema).default([])),
	}),
)

type ExtractedConcept = z.infer<typeof extractedConceptSchema>
type PaperCompileResultObject = z.infer<typeof paperCompileResultSchema>
type PaperCompileWindowResultObject = z.infer<typeof paperCompileWindowResultSchema>
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

function normalizePaperCompileWindowResult(value: unknown) {
	if (!isRecord(value)) return value

	return {
		...value,
		windowSummary:
			firstStringField(value, ["windowSummary", "window_summary", "summary", "body"]) ??
			value.windowSummary,
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
	if (disallowedConceptKindAliases.has(normalized) || disallowedConceptKindAliases.has(singular)) {
		return "concept"
	}
	const aliased = conceptKindAliasMap[normalized] ?? conceptKindAliasMap[singular] ?? normalized
	return allowedConceptKinds.has(aliased as ConceptKind) ? aliased : "concept"
}

function coerceBlockIdArray(value: unknown) {
	if (value == null) return []
	const values = Array.isArray(value) ? value : [value]
	return values.flatMap((item) => {
		if (typeof item === "string") {
			const blockId = normalizeBlockIdReference(item)
			return blockId ? [blockId] : []
		}
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
		const normalizedBlockId = blockId ? normalizeBlockIdReference(blockId) : null
		return normalizedBlockId ? [normalizedBlockId] : []
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
	compileStrategy: PaperCompileStrategy
	windowCount: number
}

type PaperCompileStrategy = "single-pass" | "hierarchical"

export async function markPaperCompilePending(args: { paperId: string; userId: string }) {
	await upsertSourcePageStatus({
		paperId: args.paperId,
		userId: args.userId,
		status: "pending",
		error: null,
		promptVersion: PAPER_COMPILE_PROMPT_VERSION,
	})
}

export async function markPaperCompileRunning(args: { paperId: string; userId: string }) {
	await upsertSourcePageStatus({
		paperId: args.paperId,
		userId: args.userId,
		status: "running",
		error: null,
		promptVersion: PAPER_COMPILE_PROMPT_VERSION,
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
		promptVersion: PAPER_COMPILE_PROMPT_VERSION,
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

	const compileResult = await runPaperCompile({
		userId,
		model: credential.model,
		paper,
		paperBlocks,
	})

	const compiled = compileResult.object
	const summaryText = compiled.summary.trim()
	const sanitizedConcepts = sanitizeExtractedConcepts(
		compiled.concepts,
		blockIds,
		blockTextById,
		paper,
	)
	const summaryReferenceBlockIds = extractBlockIdsFromSummary(summaryText)
	const pageReferenceBlockIds = uniqueValidBlockIds(
		[...compiled.referenceBlockIds, ...summaryReferenceBlockIds],
		blockIds,
		MAX_PAGE_REFERENCE_BLOCK_IDS,
	)
	if (
		paperBlocks.length > 0 &&
		(sanitizedConcepts.length === 0 || pageReferenceBlockIds.length === 0)
	) {
		throw new Error(
			[
				`${PAPER_COMPILE_PROMPT_VERSION} returned no usable concepts or source-page references`,
				`rawConceptCount=${compiled.concepts.length}`,
				`usableConceptCount=${sanitizedConcepts.length}`,
				`rawReferenceBlockCount=${compiled.referenceBlockIds.length}`,
				`usableReferenceBlockCount=${pageReferenceBlockIds.length}`,
			].join("; "),
		)
	}

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
				summaryPromptVersion: PAPER_COMPILE_PROMPT_VERSION,
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
						or(
							isNull(compiledLocalConceptsTable.promptVersion),
							ne(compiledLocalConceptsTable.promptVersion, NOTE_CONCEPT_EXTRACT_PROMPT_VERSION),
						),
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
									promptVersion: PAPER_COMPILE_PROMPT_VERSION,
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
					promptVersion: PAPER_COMPILE_PROMPT_VERSION,
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
		compileStrategy: compileResult.compileStrategy,
		windowCount: compileResult.windowCount,
	}
}

type PaperCompileCallResult = {
	object: PaperCompileResultObject
	model: string
	compileStrategy: PaperCompileStrategy
	windowCount: number
}

async function runPaperCompile(args: {
	userId: string
	model: string
	paper: Paper
	paperBlocks: Block[]
}): Promise<PaperCompileCallResult> {
	const fullBlockText = formatBlocksForCompile(args.paperBlocks)
	const pageCount = new Set(args.paperBlocks.map((block) => block.page)).size
	const shouldUseHierarchical = pageCount > 1 || fullBlockText.length > MAX_BLOCK_CONTENT_CHARS

	if (!shouldUseHierarchical) {
		return runSinglePassCompile({ ...args, blockText: fullBlockText })
	}

	return runHierarchicalCompile(args)
}

async function runSinglePassCompile(args: {
	userId: string
	model: string
	paper: Paper
	paperBlocks: Block[]
	blockText: string
}): Promise<PaperCompileCallResult> {
	const compilePrompt = fillPrompt(loadPrompt(SINGLE_PASS_PROMPT_ID), {
		title: args.paper.title || "(untitled paper)",
		authors: formatPaperAuthors(args.paper),
		abstractBlock: "",
		blocks: args.blockText,
	})

	const result = await completeObject({
		userId: args.userId,
		promptId: SINGLE_PASS_PROMPT_ID,
		model: args.model,
		schema: paperCompileResultSchema,
		messages: [{ role: "user", content: compilePrompt }],
		maxTokens: 32_000,
		temperature: 0.25,
	})

	return {
		object: result.object,
		model: result.model,
		compileStrategy: "single-pass",
		windowCount: 1,
	}
}

async function runHierarchicalCompile(args: {
	userId: string
	model: string
	paper: Paper
	paperBlocks: Block[]
}): Promise<PaperCompileCallResult> {
	const windows = buildPaperCompileWindows(args.paperBlocks)
	const windowResults = await mapWithConcurrency(
		windows,
		HIERARCHICAL_WINDOW_CONCURRENCY,
		(window) => runWindowCompileWithFallback({ ...args, window }),
	)

	const windowArtifacts = windowResults.map(({ window, object }) => ({
		windowId: window.windowId,
		pageRange: window.pageRange,
		headingPath: window.headingPath,
		primaryBlockIds: window.primaryBlockIds,
		contextBlockIds: window.contextBlockIds,
		windowSummary: object.windowSummary,
		referenceBlockIds: object.referenceBlockIds,
		concepts: object.concepts,
	}))

	const reducePrompt = fillPrompt(loadPrompt(REDUCE_PROMPT_ID), {
		title: args.paper.title || "(untitled paper)",
		authors: formatPaperAuthors(args.paper),
		windowArtifacts: JSON.stringify(windowArtifacts),
	})

	const reduceResult = await completeObject({
		userId: args.userId,
		promptId: REDUCE_PROMPT_ID,
		model: args.model,
		schema: paperCompileResultSchema,
		messages: [{ role: "user", content: reducePrompt }],
		maxTokens: 32_000,
		temperature: 0.2,
	})

	return {
		object: reduceResult.object,
		model: reduceResult.model,
		compileStrategy: "hierarchical",
		windowCount: windows.length,
	}
}

async function runWindowCompile(args: {
	userId: string
	model: string
	paper: Paper
	window: PaperCompileWindow
}): Promise<{ window: PaperCompileWindow; object: PaperCompileWindowResultObject; model: string }> {
	const windowPrompt = fillPrompt(loadPrompt(WINDOW_PROMPT_ID), {
		title: args.paper.title || "(untitled paper)",
		authors: formatPaperAuthors(args.paper),
		windowId: args.window.windowId,
		pageRange: `${args.window.pageRange[0]}-${args.window.pageRange[1]}`,
		headingPath:
			args.window.headingPath.length > 0 ? args.window.headingPath.join(" > ") : "(none)",
		primaryBlockIds: JSON.stringify(args.window.primaryBlockIds),
		contextBlockIds: JSON.stringify(args.window.contextBlockIds),
		blocks: formatBlocksForCompile(args.window.blocks),
	})

	const result = await completeObject({
		userId: args.userId,
		promptId: WINDOW_PROMPT_ID,
		model: args.model,
		schema: paperCompileWindowResultSchema,
		messages: [{ role: "user", content: windowPrompt }],
		maxTokens: 12_000,
		temperature: 0.2,
	})

	return {
		window: args.window,
		object: result.object,
		model: result.model,
	}
}

async function runWindowCompileWithFallback(args: {
	userId: string
	model: string
	paper: Paper
	window: PaperCompileWindow
}): Promise<{ window: PaperCompileWindow; object: PaperCompileWindowResultObject; model: string }> {
	try {
		return await runWindowCompile(args)
	} catch (error) {
		if (!isStructuredOutputFailure(error)) {
			throw error
		}

		const fallbackWindows = buildFallbackWindows(args.window)
		if (fallbackWindows.length <= 1) {
			return {
				window: args.window,
				object: buildDeterministicWindowCompileObject(args.window),
				model: args.model,
			}
		}

		const fallbackResults = await mapWithConcurrency(fallbackWindows, 1, (window) =>
			runWindowCompileWithFallback({ ...args, window }),
		)

		return {
			window: args.window,
			object: mergeWindowCompileObjects(fallbackResults.map((result) => result.object)),
			model: fallbackResults.at(-1)?.model ?? args.model,
		}
	}
}

function buildDeterministicWindowCompileObject(
	window: PaperCompileWindow,
): PaperCompileWindowResultObject {
	const referenceBlockIds = uniqueStrings(
		(window.primaryBlockIds.length > 0 ? window.primaryBlockIds : window.blockIds).slice(
			0,
			MAX_WINDOW_REFERENCE_BLOCK_IDS,
		),
	)
	const referenceIdSet = new Set(referenceBlockIds)
	const snippets = window.blocks
		.filter((block) => referenceIdSet.has(block.blockId))
		.map((block) => buildSnippet(block.text) ?? "")
		.filter(Boolean)
		.slice(0, 3)
	const heading = window.headingPath.length > 0 ? window.headingPath.join(" > ") : null
	const citationText = referenceBlockIds
		.slice(0, 4)
		.map((blockId) => `[blk ${blockId}]`)
		.join(" ")

	return {
		windowSummary: [
			heading ? `Heading: ${heading}.` : null,
			snippets.length > 0
				? `Fallback window summary from parsed blocks: ${snippets.join(" ")}`
				: "Fallback window summary from parsed blocks.",
			"Concept extraction for this window was skipped because structured LLM output was invalid.",
			citationText || null,
		]
			.filter(Boolean)
			.join(" ")
			.slice(0, 900),
		referenceBlockIds,
		concepts: [],
	}
}

function buildFallbackWindows(window: PaperCompileWindow) {
	const primaryIdSet = new Set(window.primaryBlockIds)
	const primaryBlocks = window.blocks.filter((block) => primaryIdSet.has(block.blockId))
	return buildPaperCompileWindows(primaryBlocks, {
		pagesPerWindow: 1,
		contextBlocksPerSide: 1,
	})
}

function mergeWindowCompileObjects(
	objects: PaperCompileWindowResultObject[],
): PaperCompileWindowResultObject {
	const conceptByKey = new Map<string, ExtractedConcept>()
	for (const object of objects) {
		for (const concept of object.concepts) {
			const key = `${concept.kind}::${concept.canonicalName.toLowerCase()}`
			const existing = conceptByKey.get(key)
			if (!existing) {
				conceptByKey.set(key, {
					...concept,
					evidenceBlockIds: uniqueStrings(concept.evidenceBlockIds),
				})
				continue
			}
			existing.evidenceBlockIds = uniqueStrings([
				...existing.evidenceBlockIds,
				...concept.evidenceBlockIds,
			])
		}
	}

	return {
		windowSummary: objects.map((object) => object.windowSummary.trim()).filter(Boolean).join("\n\n"),
		referenceBlockIds: uniqueStrings(objects.flatMap((object) => object.referenceBlockIds)).slice(
			0,
			MAX_WINDOW_REFERENCE_BLOCK_IDS,
		),
		concepts: [...conceptByKey.values()],
	}
}

function isStructuredOutputFailure(error: unknown) {
	return (
		error instanceof Error &&
		/did not return valid JSON|returned JSON that did not satisfy schema|parseable object/i.test(
			error.message,
		)
	)
}

function formatPaperAuthors(paper: Paper) {
	return Array.isArray(paper.authors) && paper.authors.length > 0
		? paper.authors.join(", ")
		: "(unknown)"
}

function formatBlocksForCompile(
	blocks: Pick<Block, "blockId" | "type" | "text" | "headingLevel">[],
) {
	return formatBlocksForAgent({
		blocks: blocks.map((block) => ({
			blockId: block.blockId,
			type: block.type,
			text: block.text,
			headingLevel: block.headingLevel,
		})),
		highlights: [],
	})
}

async function mapWithConcurrency<T, R>(
	items: T[],
	concurrency: number,
	mapper: (item: T, index: number) => Promise<R>,
) {
	const results: R[] = new Array(items.length)
	let nextIndex = 0
	const workerCount = Math.min(Math.max(1, concurrency), items.length)

	await Promise.all(
		Array.from({ length: workerCount }, async () => {
			while (nextIndex < items.length) {
				const currentIndex = nextIndex
				nextIndex += 1
				results[currentIndex] = await mapper(items[currentIndex], currentIndex)
			}
		}),
	)

	return results
}

function sanitizeExtractedConcepts(
	concepts: ExtractedConcept[],
	validBlockIds: Set<string>,
	blockTextById: Map<string, string | null>,
	paper: Paper,
) {
	const deduped = new Map<string, SanitizedConcept>()
	const paperAuthorNames = new Set(
		(paper.authors ?? []).map((author) => normalizeCanonicalName(author)),
	)

	for (const concept of concepts) {
		const displayName = concept.displayName.trim()
		const canonicalName = chooseCanonicalName(concept.canonicalName, displayName)
		if (!canonicalName || !displayName) continue
		if (shouldDropConceptName(canonicalName, displayName, paperAuthorNames)) continue

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

function shouldDropConceptName(
	canonicalName: string,
	displayName: string,
	paperAuthorNames: Set<string>,
) {
	const normalizedCanonical = normalizeCanonicalName(canonicalName)
	const normalizedDisplay = normalizeCanonicalName(displayName)
	if (genericConceptNames.has(normalizedCanonical) || genericConceptNames.has(normalizedDisplay)) {
		return true
	}
	if (paperAuthorNames.has(normalizedCanonical) || paperAuthorNames.has(normalizedDisplay)) {
		return true
	}
	if (looksLikeOrganization(displayName) || looksLikeOrganization(canonicalName)) {
		return true
	}
	return false
}

function looksLikeOrganization(value: string) {
	const normalized = value.trim().replace(/\s+/g, " ")
	if (!normalized) return false
	const lower = normalized.toLowerCase()
	if (
		/\b(university|institute|institution|college|school|department|laboratory|lab|labs|company|corporation|inc\.?|llc|ltd\.?|gmbh|center|centre|association|foundation|agency|ministry)\b/i.test(
			normalized,
		)
	) {
		return true
	}
	if (lower.endsWith(" university") || lower.endsWith(" institute")) return true
	return false
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
	const edgeTrimmed = value
		.trim()
		.toLowerCase()
		.replace(/\s+/g, " ")
		.replace(/^[^\p{L}\p{N}(]+|[^\p{L}\p{N})]+$/gu, "")

	if (hasBalancedParentheses(edgeTrimmed)) return edgeTrimmed

	return edgeTrimmed.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
}

function hasBalancedParentheses(value: string) {
	let depth = 0
	for (const char of value) {
		if (char === "(") {
			depth += 1
			continue
		}
		if (char !== ")") continue
		depth -= 1
		if (depth < 0) return false
	}
	return depth === 0
}

function normalizeBlockIdReference(value: string) {
	const trimmed = value.trim()
	if (!trimmed) return null

	const blockHeaderMatch = trimmed.match(/\bBlock\s*#\s*([a-zA-Z0-9_-]+)/i)
	if (blockHeaderMatch?.[1]) return blockHeaderMatch[1]

	const blkCitationMatch = trimmed.match(/\bblk\s+([a-zA-Z0-9_-]+)/i)
	if (blkCitationMatch?.[1]) return blkCitationMatch[1]

	const hashMatch = trimmed.match(/^#\s*([a-zA-Z0-9_-]+)$/)
	if (hashMatch?.[1]) return hashMatch[1]

	const bracketedBareMatch = trimmed.match(/^\[\s*([a-zA-Z0-9_-]+)\s*\]$/)
	if (bracketedBareMatch?.[1]) return bracketedBareMatch[1]

	return trimmed
}

function chooseCanonicalName(canonicalName: string, displayName: string) {
	const normalizedCanonical = normalizeCanonicalName(canonicalName)
	const normalizedDisplay = normalizeCanonicalName(displayName)
	if (!normalizedCanonical) return normalizedDisplay
	if (!normalizedDisplay) return normalizedCanonical

	if (
		isSingleTokenAcronymishDisplay(displayName) &&
		isNearMiss(normalizedCanonical, normalizedDisplay)
	) {
		return normalizedDisplay
	}

	return normalizedCanonical
}

function isSingleTokenAcronymishDisplay(value: string) {
	const trimmed = value.trim()
	if (!trimmed || /\s/.test(trimmed)) return false
	if (!/^[\p{L}\p{N}._-]+$/u.test(trimmed)) return false
	return /[A-Z]/.test(trimmed) && /[a-z]/.test(trimmed)
}

function isNearMiss(a: string, b: string) {
	if (a === b) return false
	const distance = levenshteinDistance(a, b)
	return distance > 0 && distance <= Math.max(1, Math.floor(Math.min(a.length, b.length) * 0.2))
}

function levenshteinDistance(a: string, b: string) {
	const previous = Array.from({ length: b.length + 1 }, (_, index) => index)
	const current = Array.from({ length: b.length + 1 }, () => 0)

	for (let i = 1; i <= a.length; i += 1) {
		current[0] = i
		for (let j = 1; j <= b.length; j += 1) {
			const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1
			current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + substitutionCost)
		}
		previous.splice(0, previous.length, ...current)
	}

	return previous[b.length]
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
