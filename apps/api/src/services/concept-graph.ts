import {
	blocks as blocksTable,
	compiledLocalConceptEdgeEvidence as compiledLocalConceptEdgeEvidenceTable,
	compiledLocalConceptEdges as compiledLocalConceptEdgesTable,
	compiledLocalConcepts as compiledLocalConceptsTable,
	papers,
} from "@sapientia/db"
import { fillPrompt, formatBlocksForAgent, loadPrompt } from "@sapientia/shared"
import { and, asc, eq, isNull } from "drizzle-orm"
import { z } from "zod"
import { db } from "../db"
import { getLlmCredential } from "./credentials"
import { completeObject, LlmCredentialMissingError } from "./llm-client"

const INNER_GRAPH_PROMPT_ID = "wiki-extract-inner-graph-v1"
const MAX_BLOCK_CONTENT_CHARS = 120_000
const MAX_EDGE_EVIDENCE_BLOCK_IDS = 2
const GRAPH_CONCEPT_KINDS = new Set(["concept", "method", "task", "metric"] as const)

const relationTypeSchema = z.enum([
	"addresses",
	"uses",
	"measured_by",
	"improves_on",
	"related_to",
])
type RelationType = z.infer<typeof relationTypeSchema>

const relationTypeAliasMap: Record<string, RelationType> = {
	addresses: "addresses",
	address: "addresses",
	addressed_by: "addresses",
	"addressed by": "addresses",
	solves: "addresses",
	solve: "addresses",
	solved_by: "addresses",
	"solved by": "addresses",
	targets: "addresses",
	target: "addresses",
	tackles: "addresses",
	uses: "uses",
	use: "uses",
	utilizes: "uses",
	employs: "uses",
	depends_on: "uses",
	"depends on": "uses",
	requires: "uses",
	measured_by: "measured_by",
	"measured by": "measured_by",
	evaluated_by: "measured_by",
	"evaluated by": "measured_by",
	measured_using: "measured_by",
	"measured using": "measured_by",
	evaluated_using: "measured_by",
	"evaluated using": "measured_by",
	improves_on: "improves_on",
	"improves on": "improves_on",
	outperforms: "improves_on",
	extends: "improves_on",
	related_to: "related_to",
	"related to": "related_to",
	relates_to: "related_to",
	"relates to": "related_to",
}
const allowedRelationTypes = new Set<RelationType>(relationTypeSchema.options)

const extractedEdgeSchema = z.object({
	sourceCanonicalName: z.string().min(1),
	targetCanonicalName: z.string().min(1),
	relationType: z.preprocess(normalizeRelationType, relationTypeSchema),
	evidenceBlockIds: z.preprocess(coerceBlockIdArray, z.array(z.string().min(1)).default([])),
	confidence: z.coerce.number().min(0).max(1).nullable().optional(),
})

const innerGraphSchema = z.preprocess(normalizeInnerGraphResult, z.object({
	edges: z.preprocess(normalizeEdgeArray, z.array(extractedEdgeSchema).default([])),
}))

type GraphConcept = {
	id: string
	kind: "concept" | "method" | "task" | "metric"
	canonicalName: string
	displayName: string
}

type SanitizedEdge = {
	sourceConceptId: string
	targetConceptId: string
	relationType: RelationType
	confidence: number | null
	evidence: Array<{
		blockId: string
		snippet: string | null
		confidence: number | null
	}>
}

function normalizeInnerGraphResult(value: unknown) {
	if (!isRecord(value)) return value
	return {
		...value,
		edges:
			firstField(value, ["edges", "relations", "relationships", "links", "graphEdges", "graph_edges"]) ??
			value.edges,
	}
}

function normalizeEdgeArray(value: unknown) {
	if (Array.isArray(value)) return value.map(normalizeEdgeObject)
	if (isRecord(value)) return Object.values(value).map(normalizeEdgeObject)
	return value
}

function normalizeEdgeObject(value: unknown) {
	if (!isRecord(value)) return value
	return {
		...value,
		sourceCanonicalName:
			firstStringField(value, [
				"sourceCanonicalName",
				"source_canonical_name",
				"source",
				"sourceName",
				"source_name",
				"from",
			]) ?? "",
		targetCanonicalName:
			firstStringField(value, [
				"targetCanonicalName",
				"target_canonical_name",
				"target",
				"targetName",
				"target_name",
				"to",
			]) ?? "",
		relationType:
			firstField(value, ["relationType", "relation_type", "type", "relation", "label"]) ??
			value.relationType,
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

function normalizeRelationType(value: unknown) {
	if (typeof value !== "string") return value
	const normalized = value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ")
	const underscored = normalized.replace(/\s+/g, "_")
	const aliased =
		relationTypeAliasMap[normalized] ??
		relationTypeAliasMap[underscored] ??
		(normalized as RelationType)
	return allowedRelationTypes.has(aliased as RelationType) ? aliased : "related_to"
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

export interface CompilePaperInnerGraphResult {
	paperId: string
	workspaceId: string
	edgeCount: number
}

export async function compilePaperInnerGraph(args: {
	paperId: string
	userId: string
	workspaceId: string
}): Promise<CompilePaperInnerGraphResult> {
	const { paperId, userId, workspaceId } = args

	const [paper] = await db.select().from(papers).where(eq(papers.id, paperId)).limit(1)
	if (!paper) throw new Error(`paper ${paperId} not found`)

	const concepts = await db
		.select({
			id: compiledLocalConceptsTable.id,
			kind: compiledLocalConceptsTable.kind,
			canonicalName: compiledLocalConceptsTable.canonicalName,
			displayName: compiledLocalConceptsTable.displayName,
		})
		.from(compiledLocalConceptsTable)
		.where(
			and(
				eq(compiledLocalConceptsTable.paperId, paperId),
				eq(compiledLocalConceptsTable.ownerUserId, userId),
				eq(compiledLocalConceptsTable.workspaceId, workspaceId),
				isNull(compiledLocalConceptsTable.deletedAt),
			),
		)
		.orderBy(
			asc(compiledLocalConceptsTable.kind),
			asc(compiledLocalConceptsTable.displayName),
		)

	const graphConcepts = concepts.filter((concept): concept is GraphConcept =>
		GRAPH_CONCEPT_KINDS.has(concept.kind as GraphConcept["kind"]),
	)

	if (graphConcepts.length < 2) {
		await clearInnerGraph({ paperId, userId, workspaceId })
		return { paperId, workspaceId, edgeCount: 0 }
	}

	const credential = await getLlmCredential(userId)
	if (!credential) throw new LlmCredentialMissingError()

	const paperBlocks = await db
		.select()
		.from(blocksTable)
		.where(eq(blocksTable.paperId, paperId))
		.orderBy(asc(blocksTable.blockIndex))

	if (paperBlocks.length === 0) {
		await clearInnerGraph({ paperId, userId, workspaceId })
		return { paperId, workspaceId, edgeCount: 0 }
	}

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

	const conceptsText = graphConcepts
		.map(
			(concept) =>
				`- ${concept.displayName} | kind=${concept.kind} | canonical=${concept.canonicalName}`,
		)
		.join("\n")

	const prompt = fillPrompt(loadPrompt(INNER_GRAPH_PROMPT_ID), {
		title: paper.title || "(untitled paper)",
		authors:
			Array.isArray(paper.authors) && paper.authors.length > 0
				? paper.authors.join(", ")
				: "(unknown)",
		concepts: conceptsText,
		blocks: blockText,
	})

	const graphResult = await completeObject({
		userId,
		promptId: INNER_GRAPH_PROMPT_ID,
		model: credential.model,
		schema: innerGraphSchema,
		messages: [{ role: "user", content: prompt }],
		maxTokens: 2500,
		temperature: 0.2,
	})

	const sanitizedEdges = sanitizeEdges({
		edges: graphResult.object.edges,
		concepts: graphConcepts,
		blockIds,
		blockTextById,
	})

	await db.transaction(async (tx) => {
		await tx
			.delete(compiledLocalConceptEdgesTable)
			.where(
				and(
					eq(compiledLocalConceptEdgesTable.paperId, paperId),
					eq(compiledLocalConceptEdgesTable.ownerUserId, userId),
					eq(compiledLocalConceptEdgesTable.workspaceId, workspaceId),
				),
			)

		if (sanitizedEdges.length === 0) return

		const generatedAt = new Date()
		const insertedEdges = await tx
			.insert(compiledLocalConceptEdgesTable)
			.values(
				sanitizedEdges.map((edge) => ({
					workspaceId,
					ownerUserId: userId,
					paperId,
					sourceConceptId: edge.sourceConceptId,
					targetConceptId: edge.targetConceptId,
					relationType: edge.relationType,
					confidence: edge.confidence,
					generatedAt,
					modelName: graphResult.model,
					promptVersion: INNER_GRAPH_PROMPT_ID,
					status: "done" as const,
					error: null,
				})),
			)
			.returning({
				id: compiledLocalConceptEdgesTable.id,
				sourceConceptId: compiledLocalConceptEdgesTable.sourceConceptId,
				targetConceptId: compiledLocalConceptEdgesTable.targetConceptId,
				relationType: compiledLocalConceptEdgesTable.relationType,
			})

		const edgeIdByKey = new Map(
			insertedEdges.map((edge) => [
				edgeKey(edge.sourceConceptId, edge.targetConceptId, edge.relationType),
				edge.id,
			]),
		)

		const evidenceRows = sanitizedEdges.flatMap((edge) => {
			const edgeId = edgeIdByKey.get(
				edgeKey(edge.sourceConceptId, edge.targetConceptId, edge.relationType),
			)
			if (!edgeId) return []
			return edge.evidence.map((item) => ({
				edgeId,
				paperId,
				blockId: item.blockId,
				snippet: item.snippet,
				confidence: item.confidence,
			}))
		})

		if (evidenceRows.length > 0) {
			await tx.insert(compiledLocalConceptEdgeEvidenceTable).values(evidenceRows)
		}
	})

	return {
		paperId,
		workspaceId,
		edgeCount: sanitizedEdges.length,
	}
}

async function clearInnerGraph(args: {
	paperId: string
	userId: string
	workspaceId: string
}) {
	const { paperId, userId, workspaceId } = args
	await db
		.delete(compiledLocalConceptEdgesTable)
		.where(
			and(
				eq(compiledLocalConceptEdgesTable.paperId, paperId),
				eq(compiledLocalConceptEdgesTable.ownerUserId, userId),
				eq(compiledLocalConceptEdgesTable.workspaceId, workspaceId),
			),
		)
}

function sanitizeEdges(args: {
	edges: z.infer<typeof extractedEdgeSchema>[]
	concepts: GraphConcept[]
	blockIds: Set<string>
	blockTextById: Map<string, string | null>
}) {
	const { edges, concepts, blockIds, blockTextById } = args
	const conceptByName = new Map<string, GraphConcept>()
	for (const concept of concepts) {
		conceptByName.set(normalizeCanonicalName(concept.canonicalName), concept)
		conceptByName.set(normalizeCanonicalName(concept.displayName), concept)
	}
	const merged = new Map<string, SanitizedEdge>()

	for (const edge of edges) {
		const rawSource = conceptByName.get(normalizeCanonicalName(edge.sourceCanonicalName))
		const rawTarget = conceptByName.get(normalizeCanonicalName(edge.targetCanonicalName))
		if (!rawSource || !rawTarget) continue

		const { source, target, relationType } = normalizeEdgeDirection({
			source: rawSource,
			target: rawTarget,
			relationType: edge.relationType,
		})
		if (!source || !target) continue
		if (source.id === target.id) continue

		const evidenceBlockIds = uniqueValidBlockIds(
			edge.evidenceBlockIds,
			blockIds,
			MAX_EDGE_EVIDENCE_BLOCK_IDS,
		)
		if (evidenceBlockIds.length === 0) continue

		const key = edgeKey(source.id, target.id, relationType)
		const nextEvidence = evidenceBlockIds.map((blockId) => ({
			blockId,
			snippet: blockTextById.get(blockId) ?? null,
			confidence: edge.confidence ?? null,
		}))
		const current = merged.get(key)
		if (!current) {
			merged.set(key, {
				sourceConceptId: source.id,
				targetConceptId: target.id,
				relationType,
				confidence: clampConfidence(edge.confidence ?? null),
				evidence: nextEvidence,
			})
			continue
		}

		current.confidence = maxConfidence(current.confidence, edge.confidence ?? null)
		current.evidence = mergeEvidence(current.evidence, nextEvidence).slice(
			0,
			MAX_EDGE_EVIDENCE_BLOCK_IDS,
		)
	}

	return [...merged.values()]
}

function normalizeEdgeDirection(args: {
	source: GraphConcept
	target: GraphConcept
	relationType: RelationType
}) {
	const { source, target, relationType } = args

	if (relationType === "addresses" && source.kind === "task" && target.kind === "method") {
		return { source: target, target: source, relationType }
	}

	if (relationType === "measured_by" && source.kind === "metric" && target.kind !== "metric") {
		return { source: target, target: source, relationType }
	}

	return { source, target, relationType }
}

function mergeEvidence(
	current: SanitizedEdge["evidence"],
	incoming: SanitizedEdge["evidence"],
) {
	const byBlockId = new Map(current.map((item) => [item.blockId, item] as const))
	for (const item of incoming) {
		if (!byBlockId.has(item.blockId)) {
			byBlockId.set(item.blockId, item)
		}
	}
	return [...byBlockId.values()]
}

function maxConfidence(a: number | null, b: number | null) {
	if (a == null) return clampConfidence(b)
	if (b == null) return clampConfidence(a)
	return Math.max(a, b)
}

function clampConfidence(value: number | null) {
	if (value == null || Number.isNaN(value)) return null
	return Math.max(0, Math.min(1, value))
}

function uniqueValidBlockIds(ids: string[], validBlockIds: Set<string>, limit: number) {
	const result: string[] = []
	const seen = new Set<string>()
	for (const id of ids) {
		const trimmed = id.trim()
		if (!trimmed || seen.has(trimmed) || !validBlockIds.has(trimmed)) continue
		seen.add(trimmed)
		result.push(trimmed)
		if (result.length >= limit) break
	}
	return result
}

function normalizeCanonicalName(value: string) {
	return value.trim().toLowerCase().replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "")
}

function edgeKey(sourceConceptId: string, targetConceptId: string, relationType: string) {
	return `${sourceConceptId}::${targetConceptId}::${relationType}`
}
