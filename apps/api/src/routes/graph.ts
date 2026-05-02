import {
	compiledLocalConceptEdgeEvidence,
	compiledLocalConceptEdges,
	compiledLocalConceptEvidence,
	compiledLocalConcepts,
	papers,
	workspaceConceptClusterCandidates,
	workspaceConceptClusterMembers,
	workspaceConceptClusters,
} from "@sapientia/db"
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import { db } from "../db"
import { type AuthContext, requireAuth } from "../middleware/auth"
import { requireMembership } from "../middleware/workspace"

const GRAPH_CONCEPT_KINDS = new Set(["concept", "method", "task", "metric"])
const ReviewSemanticCandidateBodySchema = z.object({
	decisionStatus: z.enum(["user_accepted", "user_rejected"]),
})

export const graphRoutes = new Hono<AuthContext>()

graphRoutes.get(
	"/workspaces/:workspaceId/graph",
	requireAuth,
	requireMembership("reader"),
	async (c) => {
		const workspaceId = c.req.param("workspaceId")
		const user = c.get("user")

		const clusters = await db
			.select({
				id: workspaceConceptClusters.id,
				kind: workspaceConceptClusters.kind,
				canonicalName: workspaceConceptClusters.canonicalName,
				displayName: workspaceConceptClusters.displayName,
				memberCount: workspaceConceptClusters.memberCount,
				paperCount: workspaceConceptClusters.paperCount,
				salienceScore: workspaceConceptClusters.salienceScore,
				confidence: workspaceConceptClusters.confidence,
				status: workspaceConceptClusters.status,
				updatedAt: workspaceConceptClusters.updatedAt,
				})
				.from(workspaceConceptClusters)
				.where(
					and(
						eq(workspaceConceptClusters.workspaceId, workspaceId),
						eq(workspaceConceptClusters.ownerUserId, user.id),
						isNull(workspaceConceptClusters.deletedAt),
					),
				)
				.orderBy(
					desc(workspaceConceptClusters.paperCount),
					desc(workspaceConceptClusters.salienceScore),
					asc(workspaceConceptClusters.kind),
					asc(workspaceConceptClusters.displayName),
				)

		const graphClusters = clusters.filter((cluster) => GRAPH_CONCEPT_KINDS.has(cluster.kind))
		const clusterIds = graphClusters.map((cluster) => cluster.id)
		const clusterIdSet = new Set(clusterIds)

		const members =
			clusterIds.length === 0
				? []
				: await db
						.select({
							clusterId: workspaceConceptClusterMembers.clusterId,
							localConceptId: workspaceConceptClusterMembers.localConceptId,
							paperId: workspaceConceptClusterMembers.paperId,
							paperTitle: papers.title,
							displayName: compiledLocalConcepts.displayName,
							canonicalName: compiledLocalConcepts.canonicalName,
							salienceScore: compiledLocalConcepts.salienceScore,
							sourceLevelDescription: compiledLocalConcepts.sourceLevelDescription,
							sourceLevelDescriptionStatus: compiledLocalConcepts.sourceLevelDescriptionStatus,
							readerSignalSummary: compiledLocalConcepts.readerSignalSummary,
						})
						.from(workspaceConceptClusterMembers)
						.innerJoin(papers, eq(papers.id, workspaceConceptClusterMembers.paperId))
						.innerJoin(
							compiledLocalConcepts,
							eq(compiledLocalConcepts.id, workspaceConceptClusterMembers.localConceptId),
						)
						.where(
							and(
								inArray(workspaceConceptClusterMembers.clusterId, clusterIds),
								isNull(compiledLocalConcepts.deletedAt),
								isNull(papers.deletedAt),
							),
						)

		const localConceptIds = members.map((member) => member.localConceptId)
		const localConceptToClusterId = new Map(
			members.map((member) => [member.localConceptId, member.clusterId] as const),
		)

		const conceptEvidence =
			localConceptIds.length === 0
				? []
				: await db
						.select({
							conceptId: compiledLocalConceptEvidence.conceptId,
							blockId: compiledLocalConceptEvidence.blockId,
						})
						.from(compiledLocalConceptEvidence)
						.where(inArray(compiledLocalConceptEvidence.conceptId, localConceptIds))

		const evidenceByConceptId = new Map<string, string[]>()
		for (const item of conceptEvidence) {
			const bucket = evidenceByConceptId.get(item.conceptId) ?? []
			bucket.push(item.blockId)
			evidenceByConceptId.set(item.conceptId, bucket)
		}

		const edges =
			localConceptIds.length < 2
				? []
				: await db
						.select()
						.from(compiledLocalConceptEdges)
						.where(
							and(
								eq(compiledLocalConceptEdges.workspaceId, workspaceId),
								eq(compiledLocalConceptEdges.ownerUserId, user.id),
								isNull(compiledLocalConceptEdges.deletedAt),
							),
						)
						.orderBy(
							desc(compiledLocalConceptEdges.confidence),
							asc(compiledLocalConceptEdges.relationType),
						)

		const visibleLocalEdges = edges.filter((edge) => {
			const sourceClusterId = localConceptToClusterId.get(edge.sourceConceptId)
			const targetClusterId = localConceptToClusterId.get(edge.targetConceptId)
			return Boolean(
				sourceClusterId &&
					targetClusterId &&
					sourceClusterId !== targetClusterId &&
					clusterIdSet.has(sourceClusterId) &&
					clusterIdSet.has(targetClusterId),
			)
		})
		const edgeIds = visibleLocalEdges.map((edge) => edge.id)
		const edgeEvidence =
			edgeIds.length === 0
				? []
				: await db
						.select({
							edgeId: compiledLocalConceptEdgeEvidence.edgeId,
							blockId: compiledLocalConceptEdgeEvidence.blockId,
						})
						.from(compiledLocalConceptEdgeEvidence)
						.where(inArray(compiledLocalConceptEdgeEvidence.edgeId, edgeIds))

		const evidenceByEdgeId = new Map<string, string[]>()
		for (const item of edgeEvidence) {
			const bucket = evidenceByEdgeId.get(item.edgeId) ?? []
			bucket.push(item.blockId)
			evidenceByEdgeId.set(item.edgeId, bucket)
		}

		const membersByClusterId = new Map<string, typeof members>()
		for (const member of members) {
			const bucket = membersByClusterId.get(member.clusterId) ?? []
			bucket.push(member)
			membersByClusterId.set(member.clusterId, bucket)
		}

		const projectedEdges = new Map<
			string,
			{
				id: string
				source: string
				target: string
				relationType: string
				confidence: number | null
				evidenceBlockIds: string[]
				localEdgeCount: number
			}
		>()
		for (const edge of visibleLocalEdges) {
			const source = localConceptToClusterId.get(edge.sourceConceptId)
			const target = localConceptToClusterId.get(edge.targetConceptId)
			if (!source || !target) continue
			const key = `${source}::${target}::${edge.relationType}`
			const existing = projectedEdges.get(key)
			const evidenceBlockIds = evidenceByEdgeId.get(edge.id) ?? []
			if (existing) {
				existing.localEdgeCount += 1
				existing.evidenceBlockIds = uniqueBlockIds([
					...existing.evidenceBlockIds,
					...evidenceBlockIds,
				])
				if (
					edge.confidence != null &&
					(existing.confidence == null || edge.confidence > existing.confidence)
				) {
					existing.confidence = edge.confidence
				}
				continue
			}
			projectedEdges.set(key, {
				id: `cluster-edge:${source}:${target}:${edge.relationType}`,
				source,
				target,
				relationType: edge.relationType,
				confidence: edge.confidence,
				evidenceBlockIds: uniqueBlockIds(evidenceBlockIds),
				localEdgeCount: 1,
			})
		}
		const graphEdges = [...projectedEdges.values()]

			const semanticCandidates =
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
								decisionStatus: workspaceConceptClusterCandidates.decisionStatus,
								rationale: workspaceConceptClusterCandidates.rationale,
						})
						.from(workspaceConceptClusterCandidates)
						.where(
							and(
								eq(workspaceConceptClusterCandidates.workspaceId, workspaceId),
								eq(workspaceConceptClusterCandidates.ownerUserId, user.id),
								isNull(workspaceConceptClusterCandidates.deletedAt),
									or(
										eq(workspaceConceptClusterCandidates.decisionStatus, "candidate"),
										eq(workspaceConceptClusterCandidates.decisionStatus, "needs_review"),
										eq(workspaceConceptClusterCandidates.decisionStatus, "auto_accepted"),
										eq(workspaceConceptClusterCandidates.decisionStatus, "user_accepted"),
									),
								or(
									inArray(workspaceConceptClusterCandidates.sourceClusterId, clusterIds),
									inArray(workspaceConceptClusterCandidates.targetClusterId, clusterIds),
								),
							),
						)
							.orderBy(
								desc(workspaceConceptClusterCandidates.similarityScore),
								asc(workspaceConceptClusterCandidates.decisionStatus),
							)
			const semanticCandidateStatusCounts =
				clusterIds.length === 0
					? []
					: await db
							.select({
								decisionStatus: workspaceConceptClusterCandidates.decisionStatus,
								count: sql<number>`count(*)::int`,
							})
							.from(workspaceConceptClusterCandidates)
							.where(
								and(
									eq(workspaceConceptClusterCandidates.workspaceId, workspaceId),
									eq(workspaceConceptClusterCandidates.ownerUserId, user.id),
									isNull(workspaceConceptClusterCandidates.deletedAt),
								),
							)
							.groupBy(workspaceConceptClusterCandidates.decisionStatus)
			const semanticCandidateCounts = buildSemanticCandidateCounts(
				semanticCandidateStatusCounts,
			)

		const degreeByConceptId = new Map<string, number>()
		for (const edge of graphEdges) {
			degreeByConceptId.set(edge.source, (degreeByConceptId.get(edge.source) ?? 0) + 1)
			degreeByConceptId.set(edge.target, (degreeByConceptId.get(edge.target) ?? 0) + 1)
		}

		const relationCounts = graphEdges.reduce<Record<string, number>>((counts, edge) => {
			counts[edge.relationType] = (counts[edge.relationType] ?? 0) + 1
			return counts
		}, {})

		return c.json({
			workspaceId,
			visibility: {
				defaultNodeKinds: [...GRAPH_CONCEPT_KINDS],
				supportingNodeKinds: ["dataset", "person", "organization"],
			},
			graph: {
				nodeCount: graphClusters.length,
					edgeCount: graphEdges.length,
					relationCounts,
					semanticCandidateCounts,
					nodes: graphClusters.map((cluster) => {
					const clusterMembers = membersByClusterId.get(cluster.id) ?? []
					const evidenceBlockIds = uniqueBlockIds(
						clusterMembers.flatMap(
							(member) => evidenceByConceptId.get(member.localConceptId) ?? [],
						),
					)
					return {
						id: cluster.id,
						clusterId: cluster.id,
						conceptId: cluster.id,
						label: cluster.displayName,
						kind: cluster.kind,
						canonicalName: cluster.canonicalName,
						status: cluster.status,
						memberCount: cluster.memberCount,
						paperCount: cluster.paperCount,
						salienceScore: cluster.salienceScore,
						confidence: cluster.confidence,
						updatedAt: cluster.updatedAt,
						degree: degreeByConceptId.get(cluster.id) ?? 0,
						evidenceBlockIds,
						members: clusterMembers.map((member) => ({
							localConceptId: member.localConceptId,
							paperId: member.paperId,
							paperTitle: member.paperTitle,
							displayName: member.displayName,
							canonicalName: member.canonicalName,
							salienceScore: member.salienceScore,
							sourceLevelDescription: member.sourceLevelDescription,
							sourceLevelDescriptionStatus: member.sourceLevelDescriptionStatus,
							readerSignalSummary: member.readerSignalSummary,
							evidenceBlockIds: evidenceByConceptId.get(member.localConceptId) ?? [],
						})),
					}
				}),
				edges: graphEdges.map((edge) => ({
					id: edge.id,
					source: edge.source,
					target: edge.target,
					sourceConceptId: edge.source,
					targetConceptId: edge.target,
					relationType: edge.relationType,
					confidence: edge.confidence,
					evidenceBlockIds: edge.evidenceBlockIds,
					localEdgeCount: edge.localEdgeCount,
				})),
				semanticCandidates: semanticCandidates.flatMap((candidate) => {
					if (!candidate.sourceClusterId || !candidate.targetClusterId) return []
					if (
						!clusterIdSet.has(candidate.sourceClusterId) ||
						!clusterIdSet.has(candidate.targetClusterId)
					) {
						return []
					}
					return [
						{
							id: candidate.id,
							source: candidate.sourceClusterId,
							target: candidate.targetClusterId,
							sourceConceptId: candidate.sourceClusterId,
							targetConceptId: candidate.targetClusterId,
							sourceLocalConceptId: candidate.sourceLocalConceptId,
							targetLocalConceptId: candidate.targetLocalConceptId,
							kind: candidate.kind,
							matchMethod: candidate.matchMethod,
							similarityScore: candidate.similarityScore,
							llmDecision: candidate.llmDecision,
							decisionStatus: candidate.decisionStatus,
							rationale: candidate.rationale,
						},
					]
				}),
			},
		})
	},
)

graphRoutes.patch(
	"/workspaces/:workspaceId/graph/semantic-candidates/:candidateId",
	requireAuth,
	requireMembership("editor"),
	async (c) => {
		const workspaceId = c.req.param("workspaceId")
		const candidateId = c.req.param("candidateId")
		const user = c.get("user")
		const parsed = ReviewSemanticCandidateBodySchema.safeParse(await c.req.json())
		if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

		const [updated] = await db
			.update(workspaceConceptClusterCandidates)
			.set({
				decisionStatus: parsed.data.decisionStatus,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(workspaceConceptClusterCandidates.id, candidateId),
					eq(workspaceConceptClusterCandidates.workspaceId, workspaceId),
					eq(workspaceConceptClusterCandidates.ownerUserId, user.id),
					isNull(workspaceConceptClusterCandidates.deletedAt),
				),
			)
			.returning({
				id: workspaceConceptClusterCandidates.id,
				decisionStatus: workspaceConceptClusterCandidates.decisionStatus,
			})

		if (!updated) return c.json({ error: "not found" }, 404)
		return c.json(updated)
	},
)

function uniqueBlockIds(blockIds: string[]) {
	return [...new Set(blockIds.filter(Boolean))]
}

function buildSemanticCandidateCounts(
	rows: Array<{ decisionStatus: string; count: number }>,
) {
	const counts = {
		total: 0,
		needsReview: 0,
		userAccepted: 0,
		userRejected: 0,
	}
	for (const row of rows) {
		counts.total += row.count
		if (row.decisionStatus === "needs_review") counts.needsReview += row.count
		if (row.decisionStatus === "user_accepted") counts.userAccepted += row.count
		if (row.decisionStatus === "user_rejected") counts.userRejected += row.count
	}
	return counts
}
