import {
	compiledLocalConcepts,
	papers,
	workspaceConceptClusterMembers,
	workspaceConceptClusters,
} from "@sapientia/db"
import { and, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm"
import { db } from "../db"

type ConceptKind = "concept" | "method" | "task" | "metric" | "dataset" | "person" | "organization"

type LocalConceptForClustering = {
	id: string
	paperId: string
	kind: ConceptKind
	canonicalName: string
	displayName: string
	salienceScore: number
	updatedAt: Date
}

export type WorkspaceConceptClusterDraft = {
	key: string
	kind: ConceptKind
	canonicalName: string
	displayName: string
	memberCount: number
	paperCount: number
	salienceScore: number
	confidence: number
	members: Array<{
		localConceptId: string
		paperId: string
		similarityScore: number
	}>
}

export async function compileWorkspaceConceptClusters(args: {
	workspaceId: string
	userId: string
}) {
	const { workspaceId, userId } = args

	const localConcepts = await db
		.select({
			id: compiledLocalConcepts.id,
			paperId: compiledLocalConcepts.paperId,
			kind: compiledLocalConcepts.kind,
			canonicalName: compiledLocalConcepts.canonicalName,
			displayName: compiledLocalConcepts.displayName,
			salienceScore: compiledLocalConcepts.salienceScore,
			updatedAt: compiledLocalConcepts.updatedAt,
		})
		.from(compiledLocalConcepts)
		.innerJoin(papers, eq(papers.id, compiledLocalConcepts.paperId))
		.where(
			and(
				eq(compiledLocalConcepts.workspaceId, workspaceId),
				eq(compiledLocalConcepts.ownerUserId, userId),
				isNull(compiledLocalConcepts.deletedAt),
				isNull(papers.deletedAt),
			),
		)
		.orderBy(desc(compiledLocalConcepts.salienceScore), desc(compiledLocalConcepts.updatedAt))

	const clusterDrafts = buildWorkspaceConceptClusterDrafts(localConcepts)
	const now = new Date()

	await db.transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtext(${`workspace-concept-clusters:${workspaceId}:${userId}`}))`,
		)

		if (clusterDrafts.length === 0) {
			const staleClusters = await tx
				.update(workspaceConceptClusters)
				.set({ deletedAt: now, updatedAt: now })
				.where(
					and(
						eq(workspaceConceptClusters.workspaceId, workspaceId),
						eq(workspaceConceptClusters.ownerUserId, userId),
						isNull(workspaceConceptClusters.deletedAt),
					),
				)
				.returning({ id: workspaceConceptClusters.id })
			if (staleClusters.length > 0) {
				await tx
					.delete(workspaceConceptClusterMembers)
					.where(
						inArray(
							workspaceConceptClusterMembers.clusterId,
							staleClusters.map((cluster) => cluster.id),
						),
					)
			}
			return
		}

		const insertedClusters = await tx
			.insert(workspaceConceptClusters)
			.values(
				clusterDrafts.map((cluster) => ({
					workspaceId,
					ownerUserId: userId,
					kind: cluster.kind,
					canonicalName: cluster.canonicalName,
					displayName: cluster.displayName,
					memberCount: cluster.memberCount,
					paperCount: cluster.paperCount,
					salienceScore: cluster.salienceScore,
					confidence: cluster.confidence,
					status: "done" as const,
					error: null,
					updatedAt: now,
					deletedAt: null,
				})),
			)
			.onConflictDoUpdate({
				target: [
					workspaceConceptClusters.ownerUserId,
					workspaceConceptClusters.workspaceId,
					workspaceConceptClusters.kind,
					workspaceConceptClusters.canonicalName,
				],
				set: {
					displayName: sql`excluded.display_name`,
					memberCount: sql`excluded.member_count`,
					paperCount: sql`excluded.paper_count`,
					salienceScore: sql`excluded.salience_score`,
					confidence: sql`excluded.confidence`,
					status: "done",
					error: null,
					deletedAt: null,
					updatedAt: now,
				},
			})
			.returning({
				id: workspaceConceptClusters.id,
				kind: workspaceConceptClusters.kind,
				canonicalName: workspaceConceptClusters.canonicalName,
			})

		const clusterIdByKey = new Map(
			insertedClusters.map((cluster) => [
				clusterKey(cluster.kind as ConceptKind, cluster.canonicalName),
				cluster.id,
			]),
		)
		const activeClusterIds = insertedClusters.map((cluster) => cluster.id)
		const staleClusters = await tx
			.update(workspaceConceptClusters)
			.set({ deletedAt: now, updatedAt: now })
			.where(
				and(
					eq(workspaceConceptClusters.workspaceId, workspaceId),
					eq(workspaceConceptClusters.ownerUserId, userId),
					activeClusterIds.length > 0
						? notInArray(workspaceConceptClusters.id, activeClusterIds)
						: sql`true`,
					isNull(workspaceConceptClusters.deletedAt),
				),
			)
			.returning({ id: workspaceConceptClusters.id })
		const clusterIdsToClear = [...activeClusterIds, ...staleClusters.map((cluster) => cluster.id)]
		if (clusterIdsToClear.length > 0) {
			await tx
				.delete(workspaceConceptClusterMembers)
				.where(inArray(workspaceConceptClusterMembers.clusterId, clusterIdsToClear))
		}
		const memberRows = clusterDrafts.flatMap((cluster) => {
			const clusterId = clusterIdByKey.get(cluster.key)
			if (!clusterId) return []
			return cluster.members.map((member) => ({
				clusterId,
				localConceptId: member.localConceptId,
				paperId: member.paperId,
				matchMethod: "canonical_name" as const,
				similarityScore: member.similarityScore,
			}))
		})

		if (memberRows.length > 0) {
			await tx.insert(workspaceConceptClusterMembers).values(memberRows)
		}
	})

	return {
		workspaceId,
		clusterCount: clusterDrafts.length,
		memberCount: clusterDrafts.reduce((count, cluster) => count + cluster.memberCount, 0),
	}
}

export function buildWorkspaceConceptClusterDrafts(
	localConcepts: LocalConceptForClustering[],
): WorkspaceConceptClusterDraft[] {
	const grouped = new Map<string, LocalConceptForClustering[]>()
	for (const concept of localConcepts) {
		const canonicalName = normalizeClusterCanonicalName(
			concept.canonicalName || concept.displayName,
		)
		if (!canonicalName) continue
		const key = clusterKey(concept.kind, canonicalName)
		const bucket = grouped.get(key) ?? []
		bucket.push({ ...concept, canonicalName })
		grouped.set(key, bucket)
	}

	return [...grouped.entries()]
		.map(([key, members]) => {
			const sortedMembers = [...members].sort((a, b) => {
				if (b.salienceScore !== a.salienceScore) return b.salienceScore - a.salienceScore
				return b.updatedAt.getTime() - a.updatedAt.getTime()
			})
			const representative = sortedMembers[0]
			const paperCount = new Set(members.map((member) => member.paperId)).size
			const salienceScore = members.reduce((sum, member) => sum + member.salienceScore, 0)

			return {
				key,
				kind: representative.kind,
				canonicalName: representative.canonicalName,
				displayName: representative.displayName,
				memberCount: members.length,
				paperCount,
				salienceScore,
				confidence: 1,
				members: members.map((member) => ({
					localConceptId: member.id,
					paperId: member.paperId,
					similarityScore: 1,
				})),
			}
		})
		.sort((a, b) => {
			if (b.paperCount !== a.paperCount) return b.paperCount - a.paperCount
			if (b.salienceScore !== a.salienceScore) return b.salienceScore - a.salienceScore
			if (a.kind !== b.kind) return a.kind.localeCompare(b.kind)
			return a.displayName.localeCompare(b.displayName)
		})
}

function normalizeClusterCanonicalName(value: string) {
	return value
		.trim()
		.toLowerCase()
		.replace(/&/g, " and ")
		.replace(/[()[\]{}"'`]/g, "")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.replace(/\s+/g, " ")
		.trim()
}

function clusterKey(kind: ConceptKind, canonicalName: string) {
	return `${kind}::${canonicalName}`
}
