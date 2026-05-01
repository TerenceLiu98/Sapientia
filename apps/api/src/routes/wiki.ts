import {
	compiledLocalConceptEdgeEvidence,
	compiledLocalConceptEdges,
	compiledLocalConceptEvidence,
	compiledLocalConcepts,
	wikiPageReferences,
	wikiPages,
} from "@sapientia/db"
import { and, asc, desc, eq, isNull } from "drizzle-orm"
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

		const [page] = await db
			.select()
			.from(wikiPages)
			.where(
				and(
					eq(wikiPages.workspaceId, workspaceId),
					eq(wikiPages.ownerUserId, user.id),
					eq(wikiPages.type, "source"),
					eq(wikiPages.sourcePaperId, paperId),
					isNull(wikiPages.deletedAt),
				),
			)
			.limit(1)

		if (!page) {
			return c.json({ error: "wiki page not found" }, 404)
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
					eq(compiledLocalConcepts.ownerUserId, user.id),
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
								eq(compiledLocalConceptEdges.ownerUserId, user.id),
								eq(compiledLocalConceptEdges.paperId, paperId),
								isNull(compiledLocalConceptEdges.deletedAt),
							),
						)
						.orderBy(
							desc(compiledLocalConceptEdges.confidence),
							asc(compiledLocalConceptEdges.relationType),
						)

		const publicEdges = edges.filter(
			(edge) =>
				conceptIdSet.has(edge.sourceConceptId) && conceptIdSet.has(edge.targetConceptId),
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

		return c.json({
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
			edges: publicEdges.map((edge) => ({
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
			})),
		})
	},
)
