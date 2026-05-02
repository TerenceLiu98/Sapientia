import {
	compiledLocalConceptEdgeEvidence,
	compiledLocalConceptEdges,
	compiledLocalConceptEvidence,
	compiledLocalConcepts,
	papers,
	workspaceConceptClusterCandidates,
	workspaceConceptClusterMembers,
	workspaceConceptClusters,
	workspacePapers,
} from "@sapientia/db"
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import { db } from "../db"
import { type AuthContext, requireAuth } from "../middleware/auth"
import { requireMembership } from "../middleware/workspace"

const GRAPH_CONCEPT_KINDS = new Set(["concept", "method", "task", "metric"])
const PAPER_GRAPH_DISPLAY_THRESHOLD = 0.7
const LLM_CONFIRMED_LINK_THRESHOLD = 0.8
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
		const view = c.req.query("view") ?? "papers"

		if (view === "papers") {
			return c.json(await loadPaperGraphPayload({ workspaceId, userId: user.id }))
		}
		if (view !== "concepts") {
			return c.json({ error: "invalid graph view" }, 400)
		}

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
							llmConfidence: workspaceConceptClusterCandidates.llmConfidence,
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
									eq(workspaceConceptClusterCandidates.decisionStatus, "ai_confirmed"),
									eq(workspaceConceptClusterCandidates.decisionStatus, "ai_rejected"),
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
		const semanticCandidateCounts = buildSemanticCandidateCounts(semanticCandidateStatusCounts)

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
							llmConfidence: candidate.llmConfidence,
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

async function loadPaperGraphPayload(args: { workspaceId: string; userId: string }) {
	const paperRows = await db
		.select({
			id: papers.id,
			title: papers.title,
			authors: papers.authors,
			year: papers.year,
			venue: papers.venue,
			summaryStatus: papers.summaryStatus,
			createdAt: papers.createdAt,
		})
		.from(papers)
		.innerJoin(workspacePapers, eq(workspacePapers.paperId, papers.id))
		.where(
			and(
				eq(workspacePapers.workspaceId, args.workspaceId),
				eq(papers.ownerUserId, args.userId),
				isNull(papers.deletedAt),
			),
		)
		.orderBy(desc(papers.createdAt))
	const paperById = new Map(paperRows.map((paper) => [paper.id, paper] as const))
	const paperIds = paperRows.map((paper) => paper.id)

	const conceptRows =
		paperIds.length === 0
			? []
			: await db
					.select({
						id: compiledLocalConcepts.id,
						paperId: compiledLocalConcepts.paperId,
						clusterId: workspaceConceptClusterMembers.clusterId,
						kind: compiledLocalConcepts.kind,
						displayName: compiledLocalConcepts.displayName,
						canonicalName: compiledLocalConcepts.canonicalName,
						salienceScore: compiledLocalConcepts.salienceScore,
						sourceLevelDescription: compiledLocalConcepts.sourceLevelDescription,
					})
					.from(compiledLocalConcepts)
					.innerJoin(
						workspaceConceptClusterMembers,
						eq(workspaceConceptClusterMembers.localConceptId, compiledLocalConcepts.id),
					)
					.where(
						and(
							eq(compiledLocalConcepts.workspaceId, args.workspaceId),
							eq(compiledLocalConcepts.ownerUserId, args.userId),
							inArray(compiledLocalConcepts.paperId, paperIds),
							isNull(compiledLocalConcepts.deletedAt),
						),
					)
	const graphConcepts = conceptRows.filter((concept) => GRAPH_CONCEPT_KINDS.has(concept.kind))
	const graphConceptIds = graphConcepts.map((concept) => concept.id)
	const conceptById = new Map(graphConcepts.map((concept) => [concept.id, concept] as const))
	const conceptsByPaperId = groupBy(graphConcepts, (concept) => concept.paperId)
	const conceptsByClusterId = groupBy(graphConcepts, (concept) => concept.clusterId)
	const conceptEvidence =
		graphConceptIds.length === 0
			? []
			: await db
					.select({
						conceptId: compiledLocalConceptEvidence.conceptId,
						blockId: compiledLocalConceptEvidence.blockId,
					})
					.from(compiledLocalConceptEvidence)
					.where(inArray(compiledLocalConceptEvidence.conceptId, graphConceptIds))
	const evidenceBlockIdsByConceptId = new Map<string, string[]>()
	for (const item of conceptEvidence) {
		const bucket = evidenceBlockIdsByConceptId.get(item.conceptId) ?? []
		bucket.push(item.blockId)
		evidenceBlockIdsByConceptId.set(item.conceptId, uniqueBlockIds(bucket))
	}

	const semanticCandidates =
		graphConcepts.length === 0
			? []
			: await db
					.select({
						id: workspaceConceptClusterCandidates.id,
						sourceLocalConceptId: workspaceConceptClusterCandidates.sourceLocalConceptId,
						targetLocalConceptId: workspaceConceptClusterCandidates.targetLocalConceptId,
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
							eq(workspaceConceptClusterCandidates.workspaceId, args.workspaceId),
							eq(workspaceConceptClusterCandidates.ownerUserId, args.userId),
							isNull(workspaceConceptClusterCandidates.deletedAt),
							eq(workspaceConceptClusterCandidates.decisionStatus, "ai_confirmed"),
						),
					)
					.orderBy(
						desc(workspaceConceptClusterCandidates.llmConfidence),
						desc(workspaceConceptClusterCandidates.similarityScore),
					)

	const edgeDrafts = new Map<string, PaperGraphEdgeDraft>()

	for (const concepts of conceptsByClusterId.values()) {
		const conceptsByPaper = groupBy(concepts, (concept) => concept.paperId)
		const connectedPaperIds = [...conceptsByPaper.keys()].filter((paperId) =>
			paperById.has(paperId),
		)
		forEachPaperPair(connectedPaperIds, (sourcePaperId, targetPaperId) => {
			const sourceConcept = conceptsByPaper.get(sourcePaperId)?.[0]
			const targetConcept = conceptsByPaper.get(targetPaperId)?.[0]
			if (!sourceConcept || !targetConcept) return
			addPaperGraphEvidence(edgeDrafts, {
				sourcePaperId,
				targetPaperId,
				kind: sourceConcept.kind,
				score: 1,
				similarityScore: 1,
				sourceConceptId: sourceConcept.id,
				targetConceptId: targetConcept.id,
				sourceConceptName: sourceConcept.displayName,
				targetConceptName: targetConcept.displayName,
				matchMethod: "exact_cluster",
				llmDecision: null,
				llmConfidence: null,
				rationale: `Shared ${sourceConcept.kind}: ${sourceConcept.displayName}`,
				sourceDescription: sourceConcept.sourceLevelDescription,
				targetDescription: targetConcept.sourceLevelDescription,
				sourceEvidenceBlockIds: evidenceBlockIdsByConceptId.get(sourceConcept.id) ?? [],
				targetEvidenceBlockIds: evidenceBlockIdsByConceptId.get(targetConcept.id) ?? [],
			})
		})
	}

	for (const candidate of semanticCandidates) {
		const sourceConcept = conceptById.get(candidate.sourceLocalConceptId)
		const targetConcept = conceptById.get(candidate.targetLocalConceptId)
		if (!sourceConcept || !targetConcept) continue
		if (sourceConcept.paperId === targetConcept.paperId) continue
		const similarityScore = candidate.similarityScore ?? 0
		const llmConfidence = candidate.llmConfidence ?? 0
		if (
			(candidate.llmDecision !== "same" && candidate.llmDecision !== "related") ||
			llmConfidence < LLM_CONFIRMED_LINK_THRESHOLD
		) {
			continue
		}
		addPaperGraphEvidence(edgeDrafts, {
			sourcePaperId: sourceConcept.paperId,
			targetPaperId: targetConcept.paperId,
			kind: candidate.kind,
			score: scorePaperCandidateEvidence({
				kind: candidate.kind,
				llmDecision: candidate.llmDecision,
				llmConfidence,
			}),
			similarityScore,
			sourceConceptId: sourceConcept.id,
			targetConceptId: targetConcept.id,
			sourceConceptName: sourceConcept.displayName,
			targetConceptName: targetConcept.displayName,
			matchMethod: candidate.matchMethod,
			llmDecision: candidate.llmDecision,
			llmConfidence,
			rationale: candidate.rationale,
			sourceDescription: sourceConcept.sourceLevelDescription,
			targetDescription: targetConcept.sourceLevelDescription,
			sourceEvidenceBlockIds: evidenceBlockIdsByConceptId.get(sourceConcept.id) ?? [],
			targetEvidenceBlockIds: evidenceBlockIdsByConceptId.get(targetConcept.id) ?? [],
		})
	}

	const graphEdges = [...edgeDrafts.values()]
		.map((draft) => finalizePaperGraphEdge(draft))
		.filter((edge) => edge.weight >= PAPER_GRAPH_DISPLAY_THRESHOLD)
		.sort((a, b) => b.weight - a.weight)
	const degreeByPaperId = new Map<string, number>()
	for (const edge of graphEdges) {
		degreeByPaperId.set(edge.source, (degreeByPaperId.get(edge.source) ?? 0) + 1)
		degreeByPaperId.set(edge.target, (degreeByPaperId.get(edge.target) ?? 0) + 1)
	}

	return {
		workspaceId: args.workspaceId,
		view: "papers" as const,
		graph: {
			nodeCount: paperRows.length,
			edgeCount: graphEdges.length,
			nodes: paperRows.map((paper) => {
				const concepts = conceptsByPaperId.get(paper.id) ?? []
				return {
					id: paper.id,
					paperId: paper.id,
					label: paper.title,
					title: paper.title,
					authors: paper.authors ?? [],
					year: paper.year,
					venue: paper.venue,
					summaryStatus: paper.summaryStatus,
					conceptCount: concepts.length,
					degree: degreeByPaperId.get(paper.id) ?? 0,
					topConcepts: concepts
						.sort(
							(a, b) =>
								b.salienceScore - a.salienceScore || a.displayName.localeCompare(b.displayName),
						)
						.slice(0, 8)
						.map((concept) => ({
							id: concept.id,
							displayName: concept.displayName,
							kind: concept.kind,
						})),
				}
			}),
			edges: graphEdges,
		},
	}
}

type PaperGraphEvidence = {
	sourcePaperId: string
	targetPaperId: string
	kind: string
	score: number
	similarityScore: number
	sourceConceptId: string
	targetConceptId: string
	sourceConceptName: string
	targetConceptName: string
	matchMethod: string
	llmDecision: string | null
	llmConfidence: number | null
	rationale: string | null
	sourceDescription: string | null
	targetDescription: string | null
	sourceEvidenceBlockIds: string[]
	targetEvidenceBlockIds: string[]
}

type PaperGraphEdgeDraft = {
	source: string
	target: string
	score: number
	evidence: PaperGraphEvidence[]
}

function addPaperGraphEvidence(
	drafts: Map<string, PaperGraphEdgeDraft>,
	evidence: PaperGraphEvidence,
) {
	const [source, target] =
		evidence.sourcePaperId.localeCompare(evidence.targetPaperId) <= 0
			? [evidence.sourcePaperId, evidence.targetPaperId]
			: [evidence.targetPaperId, evidence.sourcePaperId]
	const key = `${source}::${target}`
	const draft = drafts.get(key) ?? { source, target, score: 0, evidence: [] }
	draft.score += evidence.score
	draft.evidence.push(evidence)
	drafts.set(key, draft)
}

function finalizePaperGraphEdge(draft: PaperGraphEdgeDraft) {
	const evidence = [...draft.evidence].sort((a, b) => b.score - a.score)
	const similarities = evidence.map((item) => item.similarityScore).filter(Number.isFinite)
	const maxSimilarity = similarities.length > 0 ? Math.max(...similarities) : null
	const avgSimilarity =
		similarities.length > 0
			? Math.round(
					(similarities.reduce((sum, value) => sum + value, 0) / similarities.length) * 1000,
				) / 1000
			: null
	const kinds = new Set(evidence.map((item) => item.kind))
	const maxEvidenceScore = evidence.length > 0 ? Math.max(...evidence.map((item) => item.score)) : 0
	const evidenceBoost = Math.min(0.15, Math.max(0, evidence.length - 1) * 0.04)
	return {
		id: `paper-edge:${draft.source}:${draft.target}`,
		source: draft.source,
		target: draft.target,
		edgeKind: edgeKindForEvidence(evidence),
		weight: Math.min(1, Math.round((maxEvidenceScore + evidenceBoost) * 1000) / 1000),
		evidenceCount: evidence.length,
		strongEvidenceCount: evidence.filter(
			(item) =>
				item.matchMethod === "exact_cluster" ||
				(item.llmConfidence ?? 0) >= LLM_CONFIRMED_LINK_THRESHOLD,
		).length,
		maxSimilarity,
		avgSimilarity,
		kinds: [...kinds],
		topEvidence: evidence.slice(0, 8).map((item) => ({
			kind: item.kind,
			sourcePaperId: item.sourcePaperId,
			targetPaperId: item.targetPaperId,
			sourceConceptId: item.sourceConceptId,
			targetConceptId: item.targetConceptId,
			sourceConceptName: item.sourceConceptName,
			targetConceptName: item.targetConceptName,
			matchMethod: item.matchMethod,
			similarityScore: item.similarityScore,
			llmDecision: item.llmDecision,
			llmConfidence: item.llmConfidence,
			rationale: item.rationale,
			sourceDescription: item.sourceDescription,
			targetDescription: item.targetDescription,
			sourceEvidenceBlockIds: item.sourceEvidenceBlockIds,
			targetEvidenceBlockIds: item.targetEvidenceBlockIds,
		})),
	}
}

function scorePaperCandidateEvidence(args: {
	kind: string
	llmDecision: string | null
	llmConfidence: number | null
}) {
	if (args.llmDecision !== "same" && args.llmDecision !== "related") return 0
	const confidence = args.llmConfidence ?? 0
	if (confidence < LLM_CONFIRMED_LINK_THRESHOLD) return 0

	let score = confidence
	if (args.llmDecision === "related") score *= 0.9
	if (args.kind === "method" || args.kind === "task") score += 0.05
	if (args.kind === "metric") score += 0.02

	return Math.min(1, Math.round(score * 1000) / 1000)
}

function edgeKindForEvidence(evidence: PaperGraphEvidence[]) {
	const kinds = new Set(evidence.map((item) => item.kind))
	if (kinds.size > 1) return "mixed"
	if (kinds.has("method")) return "similar_methods"
	if (kinds.has("task")) return "same_task"
	if (kinds.has("metric")) return "related_metrics"
	if (evidence.some((item) => item.matchMethod === "exact_cluster")) return "shared_concepts"
	return "semantic_neighbor"
}

function groupBy<T, K>(items: T[], getKey: (item: T) => K) {
	const grouped = new Map<K, T[]>()
	for (const item of items) {
		const key = getKey(item)
		const bucket = grouped.get(key) ?? []
		bucket.push(item)
		grouped.set(key, bucket)
	}
	return grouped
}

function forEachPaperPair(paperIds: string[], callback: (source: string, target: string) => void) {
	const sortedIds = [...new Set(paperIds)].sort()
	for (let i = 0; i < sortedIds.length; i += 1) {
		for (let j = i + 1; j < sortedIds.length; j += 1) {
			callback(sortedIds[i], sortedIds[j])
		}
	}
}

function uniqueBlockIds(blockIds: string[]) {
	return [...new Set(blockIds.filter(Boolean))]
}

function buildSemanticCandidateCounts(rows: Array<{ decisionStatus: string; count: number }>) {
	const counts = {
		total: 0,
		generated: 0,
		needsReview: 0,
		userAccepted: 0,
		userRejected: 0,
	}
	for (const row of rows) {
		counts.total += row.count
		if (
			row.decisionStatus === "candidate" ||
			row.decisionStatus === "needs_review" ||
			row.decisionStatus === "auto_accepted" ||
			row.decisionStatus === "ai_confirmed" ||
			row.decisionStatus === "ai_rejected"
		) {
			counts.generated += row.count
		}
		if (row.decisionStatus === "needs_review") counts.needsReview += row.count
		if (row.decisionStatus === "user_accepted" || row.decisionStatus === "ai_confirmed") {
			counts.userAccepted += row.count
		}
		if (row.decisionStatus === "user_rejected" || row.decisionStatus === "ai_rejected") {
			counts.userRejected += row.count
		}
	}
	return counts
}
