import {
	compiledLocalConceptEdgeEvidence,
	compiledLocalConceptEdges,
	compiledLocalConceptEvidence,
	compiledLocalConcepts,
	wikiPageReferences,
	wikiPages,
	workspaceConceptClusterCandidates,
	workspaceConceptClusterMembers,
	workspaceConceptClusters,
} from "@sapientia/db"
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm"
import { Hono } from "hono"
import { db } from "../db"
import { type AuthContext, requireAuth } from "../middleware/auth"
import { requireMembership } from "../middleware/workspace"

export const wikiRoutes = new Hono<AuthContext>()
const PUBLIC_CONCEPT_KINDS = new Set(["concept", "method", "task", "metric"])

wikiRoutes.get(
	"/workspaces/:workspaceId/papers/:paperId/wiki",
	requireAuth,
	requireMembership("reader"),
	async (c) => {
		const workspaceId = c.req.param("workspaceId")
		const paperId = c.req.param("paperId")
		const user = c.get("user")

		const payload = await loadPaperWikiPayload({ workspaceId, paperId, userId: user.id })
		if (!payload) {
			return c.json(pendingPaperWikiPayload(paperId), 202)
		}

		return c.json(payload)
	},
)

wikiRoutes.get(
	"/workspaces/:workspaceId/papers/:paperId/concept-graph",
	requireAuth,
	requireMembership("reader"),
	async (c) => {
		const workspaceId = c.req.param("workspaceId")
		const paperId = c.req.param("paperId")
		const user = c.get("user")

		const payload = await loadPaperWikiPayload({ workspaceId, paperId, userId: user.id })
		if (!payload) {
			return c.json(
				toConceptGraphPayload({
					workspaceId,
					paperId,
					payload: pendingPaperWikiPayload(paperId),
				}),
				202,
			)
		}

		return c.json(toConceptGraphPayload({ workspaceId, paperId, payload }))
	},
)

wikiRoutes.get(
	"/workspaces/:workspaceId/papers/:paperId/blocks/:blockId/concepts",
	requireAuth,
	requireMembership("reader"),
	async (c) => {
		const workspaceId = c.req.param("workspaceId")
		const paperId = c.req.param("paperId")
		const blockId = c.req.param("blockId")
		const user = c.get("user")

		const payload = await loadBlockConceptLensPayload({
			workspaceId,
			paperId,
			blockId,
			userId: user.id,
		})
		return c.json(payload)
	},
)

function pendingPaperWikiPayload(paperId: string) {
	return {
		page: {
			id: `pending:${paperId}`,
			type: "source" as const,
			canonicalName: `paper:${paperId}`,
			displayName: "Paper wiki is compiling",
			body: null,
			status: "pending" as const,
			error: null,
			generatedAt: null,
			modelName: null,
			promptVersion: null,
			sourcePaperId: paperId,
			referenceBlockIds: [],
		},
		concepts: [],
		innerGraph: {
			edgeCount: 0,
			relationCounts: {},
			edges: [],
		},
	}
}

async function loadPaperWikiPayload(args: {
	workspaceId: string
	paperId: string
	userId: string
}) {
	const { workspaceId, paperId, userId } = args

	const [page] = await db
		.select()
		.from(wikiPages)
		.where(
			and(
				eq(wikiPages.workspaceId, workspaceId),
				eq(wikiPages.ownerUserId, userId),
				eq(wikiPages.type, "source"),
				eq(wikiPages.sourcePaperId, paperId),
				isNull(wikiPages.deletedAt),
			),
		)
		.limit(1)

	if (!page) {
		return null
	}

	const references = await db
		.select()
		.from(wikiPageReferences)
		.where(eq(wikiPageReferences.pageId, page.id))
		.orderBy(asc(wikiPageReferences.createdAt))

	const concepts = await db
		.select()
		.from(compiledLocalConcepts)
		.where(
			and(
				eq(compiledLocalConcepts.workspaceId, workspaceId),
				eq(compiledLocalConcepts.ownerUserId, userId),
				eq(compiledLocalConcepts.paperId, paperId),
				isNull(compiledLocalConcepts.deletedAt),
			),
		)
		.orderBy(
			desc(compiledLocalConcepts.salienceScore),
			asc(compiledLocalConcepts.kind),
			asc(compiledLocalConcepts.displayName),
		)

	const publicConcepts = concepts.filter((concept) => PUBLIC_CONCEPT_KINDS.has(concept.kind))
	const conceptIds = publicConcepts.map((concept) => concept.id)
	const conceptIdSet = new Set(conceptIds)
	const evidence =
		conceptIds.length === 0
			? []
			: await db
					.select()
					.from(compiledLocalConceptEvidence)
					.where(eq(compiledLocalConceptEvidence.paperId, paperId))

	const evidenceByConceptId = new Map<string, Array<(typeof evidence)[number]>>()
	for (const item of evidence) {
		if (!conceptIdSet.has(item.conceptId)) continue
		const bucket = evidenceByConceptId.get(item.conceptId) ?? []
		bucket.push(item)
		evidenceByConceptId.set(item.conceptId, bucket)
	}

	const edges =
		conceptIds.length < 2
			? []
			: await db
					.select()
					.from(compiledLocalConceptEdges)
					.where(
						and(
							eq(compiledLocalConceptEdges.workspaceId, workspaceId),
							eq(compiledLocalConceptEdges.ownerUserId, userId),
							eq(compiledLocalConceptEdges.paperId, paperId),
							isNull(compiledLocalConceptEdges.deletedAt),
						),
					)
					.orderBy(
						desc(compiledLocalConceptEdges.confidence),
						asc(compiledLocalConceptEdges.relationType),
					)

	const publicEdges = edges.filter(
		(edge) => conceptIdSet.has(edge.sourceConceptId) && conceptIdSet.has(edge.targetConceptId),
	)

	const edgeIds = publicEdges.map((edge) => edge.id)
	const edgeEvidence =
		edgeIds.length === 0
			? []
			: await db
					.select()
					.from(compiledLocalConceptEdgeEvidence)
					.where(eq(compiledLocalConceptEdgeEvidence.paperId, paperId))

	const edgeEvidenceByEdgeId = new Map<string, Array<(typeof edgeEvidence)[number]>>()
	for (const item of edgeEvidence) {
		if (!edgeIds.includes(item.edgeId)) continue
		const bucket = edgeEvidenceByEdgeId.get(item.edgeId) ?? []
		bucket.push(item)
		edgeEvidenceByEdgeId.set(item.edgeId, bucket)
	}

	const graphEdges = publicEdges.map((edge) => ({
		id: edge.id,
		sourceConceptId: edge.sourceConceptId,
		targetConceptId: edge.targetConceptId,
		relationType: edge.relationType,
		confidence: edge.confidence,
		evidence:
			edgeEvidenceByEdgeId.get(edge.id)?.map((item) => ({
				blockId: item.blockId,
				snippet: item.snippet,
				confidence: item.confidence,
			})) ?? [],
	}))

	const relationCounts = graphEdges.reduce<Record<string, number>>((counts, edge) => {
		counts[edge.relationType] = (counts[edge.relationType] ?? 0) + 1
		return counts
	}, {})

	return {
		page: {
			id: page.id,
			type: page.type,
			canonicalName: page.canonicalName,
			displayName: page.displayName,
			body: page.body,
			status: page.status,
			error: page.error,
			generatedAt: page.generatedAt,
			modelName: page.modelName,
			promptVersion: page.promptVersion,
			sourcePaperId: page.sourcePaperId,
			referenceBlockIds: references.map((reference) => reference.blockId),
		},
		concepts: publicConcepts.map((concept) => ({
			id: concept.id,
			kind: concept.kind,
			canonicalName: concept.canonicalName,
			displayName: concept.displayName,
			status: concept.status,
			error: concept.error,
			salienceScore: concept.salienceScore,
			highlightCount: concept.highlightCount,
			weightedHighlightScore: concept.weightedHighlightScore,
			noteCitationCount: concept.noteCitationCount,
			lastMarginaliaAt: concept.lastMarginaliaAt,
			sourceLevelDescription: concept.sourceLevelDescription,
			sourceLevelDescriptionStatus: concept.sourceLevelDescriptionStatus,
			readerSignalSummary: concept.readerSignalSummary,
			generatedAt: concept.generatedAt,
			modelName: concept.modelName,
			promptVersion: concept.promptVersion,
			evidence:
				evidenceByConceptId.get(concept.id)?.map((item) => ({
					blockId: item.blockId,
					snippet: item.snippet,
					confidence: item.confidence,
				})) ?? [],
		})),
		innerGraph: {
			edgeCount: graphEdges.length,
			relationCounts,
			edges: graphEdges,
		},
	}
}

async function loadBlockConceptLensPayload(args: {
	workspaceId: string
	paperId: string
	blockId: string
	userId: string
}) {
	const { workspaceId, paperId, blockId, userId } = args
	const rows = await db
		.select({
			conceptId: compiledLocalConcepts.id,
			kind: compiledLocalConcepts.kind,
			canonicalName: compiledLocalConcepts.canonicalName,
			displayName: compiledLocalConcepts.displayName,
			status: compiledLocalConcepts.status,
			salienceScore: compiledLocalConcepts.salienceScore,
			highlightCount: compiledLocalConcepts.highlightCount,
			noteCitationCount: compiledLocalConcepts.noteCitationCount,
			sourceLevelDescription: compiledLocalConcepts.sourceLevelDescription,
			sourceLevelDescriptionStatus: compiledLocalConcepts.sourceLevelDescriptionStatus,
			readerSignalSummary: compiledLocalConcepts.readerSignalSummary,
			promptVersion: compiledLocalConcepts.promptVersion,
			evidenceSnippet: compiledLocalConceptEvidence.snippet,
			evidenceConfidence: compiledLocalConceptEvidence.confidence,
			clusterId: workspaceConceptClusters.id,
			clusterDisplayName: workspaceConceptClusters.displayName,
			clusterCanonicalName: workspaceConceptClusters.canonicalName,
			clusterKind: workspaceConceptClusters.kind,
			clusterMemberCount: workspaceConceptClusters.memberCount,
			clusterPaperCount: workspaceConceptClusters.paperCount,
		})
		.from(compiledLocalConceptEvidence)
		.innerJoin(
			compiledLocalConcepts,
			eq(compiledLocalConcepts.id, compiledLocalConceptEvidence.conceptId),
		)
		.leftJoin(
			workspaceConceptClusterMembers,
			eq(workspaceConceptClusterMembers.localConceptId, compiledLocalConcepts.id),
		)
		.leftJoin(
			workspaceConceptClusters,
			eq(workspaceConceptClusters.id, workspaceConceptClusterMembers.clusterId),
		)
		.where(
			and(
				eq(compiledLocalConceptEvidence.paperId, paperId),
				eq(compiledLocalConceptEvidence.blockId, blockId),
				eq(compiledLocalConcepts.workspaceId, workspaceId),
				eq(compiledLocalConcepts.ownerUserId, userId),
				isNull(compiledLocalConcepts.deletedAt),
				or(
					isNull(workspaceConceptClusters.deletedAt),
					eq(workspaceConceptClusters.workspaceId, workspaceId),
				),
			),
		)
		.orderBy(desc(compiledLocalConcepts.salienceScore), asc(compiledLocalConcepts.displayName))

	const publicRows = rows.filter((row) => PUBLIC_CONCEPT_KINDS.has(row.kind))
	const clusterIds = [
		...new Set(publicRows.flatMap((row) => (row.clusterId ? [row.clusterId] : []))),
	]
	const candidates =
		clusterIds.length === 0
			? []
			: await db
					.select({
						id: workspaceConceptClusterCandidates.id,
						sourceLocalConceptId: workspaceConceptClusterCandidates.sourceLocalConceptId,
						targetLocalConceptId: workspaceConceptClusterCandidates.targetLocalConceptId,
						sourceClusterId: workspaceConceptClusterCandidates.sourceClusterId,
						targetClusterId: workspaceConceptClusterCandidates.targetClusterId,
						kind: workspaceConceptClusterCandidates.kind,
						matchMethod: workspaceConceptClusterCandidates.matchMethod,
						similarityScore: workspaceConceptClusterCandidates.similarityScore,
						llmDecision: workspaceConceptClusterCandidates.llmDecision,
						llmConfidence: workspaceConceptClusterCandidates.llmConfidence,
						decisionStatus: workspaceConceptClusterCandidates.decisionStatus,
						rationale: workspaceConceptClusterCandidates.rationale,
					})
					.from(workspaceConceptClusterCandidates)
					.where(
						and(
							eq(workspaceConceptClusterCandidates.workspaceId, workspaceId),
							eq(workspaceConceptClusterCandidates.ownerUserId, userId),
							isNull(workspaceConceptClusterCandidates.deletedAt),
							eq(workspaceConceptClusterCandidates.decisionStatus, "ai_confirmed"),
							or(
								inArray(workspaceConceptClusterCandidates.sourceClusterId, clusterIds),
								inArray(workspaceConceptClusterCandidates.targetClusterId, clusterIds),
							),
						),
					)
					.orderBy(
						desc(workspaceConceptClusterCandidates.llmConfidence),
						desc(workspaceConceptClusterCandidates.similarityScore),
					)
	const candidateClusterIds = [
		...new Set(
			candidates.flatMap((candidate) =>
				[candidate.sourceClusterId, candidate.targetClusterId].filter(isString),
			),
		),
	]
	const candidateClusters =
		candidateClusterIds.length === 0
			? []
			: await db
					.select({
						id: workspaceConceptClusters.id,
						kind: workspaceConceptClusters.kind,
						displayName: workspaceConceptClusters.displayName,
						canonicalName: workspaceConceptClusters.canonicalName,
						memberCount: workspaceConceptClusters.memberCount,
						paperCount: workspaceConceptClusters.paperCount,
					})
					.from(workspaceConceptClusters)
					.where(
						and(
							inArray(workspaceConceptClusters.id, candidateClusterIds),
							eq(workspaceConceptClusters.workspaceId, workspaceId),
							eq(workspaceConceptClusters.ownerUserId, userId),
							isNull(workspaceConceptClusters.deletedAt),
						),
					)
	const clusterById = new Map(candidateClusters.map((cluster) => [cluster.id, cluster] as const))

	return {
		workspaceId,
		paperId,
		blockId,
		concepts: publicRows.map((row) => ({
			id: row.conceptId,
			kind: row.kind,
			canonicalName: row.canonicalName,
			displayName: row.displayName,
			status: row.status,
			salienceScore: row.salienceScore,
			highlightCount: row.highlightCount,
			noteCitationCount: row.noteCitationCount,
			sourceLevelDescription: row.sourceLevelDescription,
			sourceLevelDescriptionStatus: row.sourceLevelDescriptionStatus,
			readerSignalSummary: row.readerSignalSummary,
			promptVersion: row.promptVersion,
			evidence: {
				blockId,
				snippet: row.evidenceSnippet,
				confidence: row.evidenceConfidence,
			},
			cluster: row.clusterId
				? {
						id: row.clusterId,
						displayName: row.clusterDisplayName,
						canonicalName: row.clusterCanonicalName,
						kind: row.clusterKind,
						memberCount: row.clusterMemberCount,
						paperCount: row.clusterPaperCount,
					}
				: null,
		})),
		semanticCandidates: candidates.flatMap((candidate) => {
			if (!candidate.sourceClusterId || !candidate.targetClusterId) return []
			const relatedClusterId = clusterIds.includes(candidate.sourceClusterId)
				? candidate.targetClusterId
				: candidate.sourceClusterId
			const relatedCluster = clusterById.get(relatedClusterId)
			return [
				{
					id: candidate.id,
					sourceClusterId: candidate.sourceClusterId,
					targetClusterId: candidate.targetClusterId,
					sourceLocalConceptId: candidate.sourceLocalConceptId,
					targetLocalConceptId: candidate.targetLocalConceptId,
					kind: candidate.kind,
					matchMethod: candidate.matchMethod,
					similarityScore: candidate.similarityScore,
					llmDecision: candidate.llmDecision,
					llmConfidence: candidate.llmConfidence,
					decisionStatus: candidate.decisionStatus,
					rationale: candidate.rationale,
					relatedCluster: relatedCluster
						? {
								id: relatedCluster.id,
								displayName: relatedCluster.displayName,
								canonicalName: relatedCluster.canonicalName,
								kind: relatedCluster.kind,
								memberCount: relatedCluster.memberCount,
								paperCount: relatedCluster.paperCount,
							}
						: null,
				},
			]
		}),
	}
}

function isString(value: string | null): value is string {
	return typeof value === "string"
}

function toConceptGraphPayload(args: {
	workspaceId: string
	paperId: string
	payload: NonNullable<Awaited<ReturnType<typeof loadPaperWikiPayload>>>
}) {
	const { workspaceId, paperId, payload } = args
	const degreeByConceptId = new Map<string, number>()

	for (const edge of payload.innerGraph.edges) {
		degreeByConceptId.set(
			edge.sourceConceptId,
			(degreeByConceptId.get(edge.sourceConceptId) ?? 0) + 1,
		)
		degreeByConceptId.set(
			edge.targetConceptId,
			(degreeByConceptId.get(edge.targetConceptId) ?? 0) + 1,
		)
	}

	const nodes = payload.concepts.map((concept) => ({
		id: concept.id,
		conceptId: concept.id,
		label: concept.displayName,
		kind: concept.kind,
		canonicalName: concept.canonicalName,
		status: concept.status,
		salienceScore: concept.salienceScore,
		highlightCount: concept.highlightCount,
		noteCitationCount: concept.noteCitationCount,
		sourceLevelDescription: concept.sourceLevelDescription,
		sourceLevelDescriptionStatus: concept.sourceLevelDescriptionStatus,
		readerSignalSummary: concept.readerSignalSummary,
		degree: degreeByConceptId.get(concept.id) ?? 0,
		evidenceBlockIds: concept.evidence.map((item) => item.blockId),
	}))

	const edges = payload.innerGraph.edges.map((edge) => ({
		id: edge.id,
		source: edge.sourceConceptId,
		target: edge.targetConceptId,
		sourceConceptId: edge.sourceConceptId,
		targetConceptId: edge.targetConceptId,
		relationType: edge.relationType,
		confidence: edge.confidence,
		evidenceBlockIds: edge.evidence.map((item) => item.blockId),
		evidence: edge.evidence,
	}))

	return {
		workspaceId,
		paperId,
		sourcePage: {
			id: payload.page.id,
			displayName: payload.page.displayName,
			status: payload.page.status,
			error: payload.page.error,
			generatedAt: payload.page.generatedAt,
			modelName: payload.page.modelName,
			promptVersion: payload.page.promptVersion,
			referenceBlockIds: payload.page.referenceBlockIds,
		},
		visibility: {
			defaultNodeKinds: [...PUBLIC_CONCEPT_KINDS],
			supportingNodeKinds: ["dataset", "person", "organization"],
		},
		graph: {
			nodeCount: nodes.length,
			edgeCount: edges.length,
			relationCounts: payload.innerGraph.relationCounts,
			nodes,
			edges,
		},
	}
}
