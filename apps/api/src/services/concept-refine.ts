import {
	blockHighlights,
	compiledLocalConceptEvidence,
	compiledLocalConcepts,
	noteBlockRefs,
	notes,
	wikiPageReferences,
	wikiPages,
} from "@sapientia/db"
import { and, asc, eq, inArray, isNull } from "drizzle-orm"
import { db } from "../db"

const HIGHLIGHT_WEIGHT_BY_COLOR: Record<string, number> = {
	important: 1.2,
	original: 1.1,
	questioning: 0.9,
	pending: 0.7,
	background: 0.35,
}

function highlightWeight(color: string) {
	return HIGHLIGHT_WEIGHT_BY_COLOR[color] ?? 0.6
}

export async function refinePaperConceptSalience(args: {
	paperId: string
	userId: string
	workspaceId: string
}) {
	const { paperId, userId, workspaceId } = args

	const concepts = await db
		.select({
			id: compiledLocalConcepts.id,
			kind: compiledLocalConcepts.kind,
			displayName: compiledLocalConcepts.displayName,
		})
		.from(compiledLocalConcepts)
		.where(
			and(
				eq(compiledLocalConcepts.paperId, paperId),
				eq(compiledLocalConcepts.ownerUserId, userId),
				eq(compiledLocalConcepts.workspaceId, workspaceId),
				isNull(compiledLocalConcepts.deletedAt),
			),
		)

	if (concepts.length === 0) {
		return { paperId, workspaceId, refinedConceptCount: 0 }
	}

	const conceptIds = concepts.map((concept) => concept.id)
	const evidenceRows = await db
		.select({
			conceptId: compiledLocalConceptEvidence.conceptId,
			blockId: compiledLocalConceptEvidence.blockId,
		})
		.from(compiledLocalConceptEvidence)
		.where(inArray(compiledLocalConceptEvidence.conceptId, conceptIds))

	const highlightRows = await db
		.select({
			blockId: blockHighlights.blockId,
			color: blockHighlights.color,
			updatedAt: blockHighlights.updatedAt,
		})
		.from(blockHighlights)
		.where(
			and(
				eq(blockHighlights.paperId, paperId),
				eq(blockHighlights.userId, userId),
				eq(blockHighlights.workspaceId, workspaceId),
			),
		)

	const noteRefRows = await db
		.select({
			blockId: noteBlockRefs.blockId,
			citationCount: noteBlockRefs.citationCount,
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
			),
		)

	const highlightByBlockId = new Map(
		highlightRows.map((row) => [row.blockId, row] as const),
	)

	const noteRefsByBlockId = new Map<
		string,
		{ citationCount: number; noteUpdatedAt: Date | null }
	>()
	for (const row of noteRefRows) {
		const existing = noteRefsByBlockId.get(row.blockId)
		if (!existing) {
			noteRefsByBlockId.set(row.blockId, {
				citationCount: row.citationCount,
				noteUpdatedAt: row.noteUpdatedAt,
			})
			continue
		}
		noteRefsByBlockId.set(row.blockId, {
			citationCount: existing.citationCount + row.citationCount,
			noteUpdatedAt:
				!existing.noteUpdatedAt || (row.noteUpdatedAt && row.noteUpdatedAt > existing.noteUpdatedAt)
					? row.noteUpdatedAt
					: existing.noteUpdatedAt,
		})
	}

	const evidenceByConceptId = new Map<string, string[]>()
	for (const row of evidenceRows) {
		const list = evidenceByConceptId.get(row.conceptId) ?? []
		list.push(row.blockId)
		evidenceByConceptId.set(row.conceptId, list)
	}

	const now = new Date()
	const refinedConcepts: Array<{
		id: string
		kind: "concept" | "method" | "task" | "metric" | "dataset" | "person" | "organization"
		displayName: string
		salienceScore: number
		blockIds: string[]
	}> = []
	for (const concept of concepts) {
		const blockIds = [...new Set(evidenceByConceptId.get(concept.id) ?? [])]
		let highlightCount = 0
		let weightedHighlightScore = 0
		let noteCitationCount = 0
		let lastMarginaliaAt: Date | null = null

		for (const blockId of blockIds) {
			const highlight = highlightByBlockId.get(blockId)
			if (highlight) {
				highlightCount += 1
				weightedHighlightScore += highlightWeight(highlight.color)
				if (!lastMarginaliaAt || highlight.updatedAt > lastMarginaliaAt) {
					lastMarginaliaAt = highlight.updatedAt
				}
			}

			const noteRef = noteRefsByBlockId.get(blockId)
			if (noteRef) {
				noteCitationCount += noteRef.citationCount
				if (
					noteRef.noteUpdatedAt &&
					(!lastMarginaliaAt || noteRef.noteUpdatedAt > lastMarginaliaAt)
				) {
					lastMarginaliaAt = noteRef.noteUpdatedAt
				}
			}
		}

		const salienceScore = weightedHighlightScore + noteCitationCount * 1.5

		await db
			.update(compiledLocalConcepts)
			.set({
				highlightCount,
				weightedHighlightScore,
				noteCitationCount,
				salienceScore,
				lastMarginaliaAt,
				updatedAt: now,
			})
			.where(eq(compiledLocalConcepts.id, concept.id))

		refinedConcepts.push({
			id: concept.id,
			kind: concept.kind,
			displayName: concept.displayName,
			salienceScore,
			blockIds,
		})
	}

	await refreshSourcePageReferences({
		paperId,
		userId,
		workspaceId,
		refinedConcepts,
	})

	return { paperId, workspaceId, refinedConceptCount: concepts.length }
}

async function refreshSourcePageReferences(args: {
	paperId: string
	userId: string
	workspaceId: string
	refinedConcepts: Array<{
		id: string
		kind: "concept" | "method" | "task" | "metric" | "dataset" | "person" | "organization"
		displayName: string
		salienceScore: number
		blockIds: string[]
	}>
}) {
	const { paperId, userId, workspaceId, refinedConcepts } = args

	const [sourcePage] = await db
		.select({ id: wikiPages.id })
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

	if (!sourcePage) return

	const existingReferences = await db
		.select({ blockId: wikiPageReferences.blockId })
		.from(wikiPageReferences)
		.where(eq(wikiPageReferences.pageId, sourcePage.id))
		.orderBy(asc(wikiPageReferences.createdAt))

	const prioritizedBlockIds = uniqueBlockIds(
		refinedConcepts
			.filter((concept) => concept.salienceScore > 0)
			.sort((a, b) => {
				if (b.salienceScore !== a.salienceScore) return b.salienceScore - a.salienceScore
				if (a.kind !== b.kind) return a.kind.localeCompare(b.kind)
				return a.displayName.localeCompare(b.displayName)
			})
			.flatMap((concept) => concept.blockIds),
	)

	if (prioritizedBlockIds.length === 0) return

	const nextReferenceBlockIds = uniqueBlockIds([
		...prioritizedBlockIds,
		...existingReferences.map((reference) => reference.blockId),
	]).slice(0, 12)

	const currentReferenceBlockIds = existingReferences.map((reference) => reference.blockId)
	if (
		nextReferenceBlockIds.length === currentReferenceBlockIds.length &&
		nextReferenceBlockIds.every((blockId, index) => blockId === currentReferenceBlockIds[index])
	) {
		return
	}

	await db.delete(wikiPageReferences).where(eq(wikiPageReferences.pageId, sourcePage.id))
	if (nextReferenceBlockIds.length === 0) return

	await db.insert(wikiPageReferences).values(
		nextReferenceBlockIds.map((blockId) => ({
			pageId: sourcePage.id,
			paperId,
			blockId,
		})),
	)
}

function uniqueBlockIds(blockIds: string[]) {
	const seen = new Set<string>()
	const result: string[] = []
	for (const blockId of blockIds) {
		if (!blockId || seen.has(blockId)) continue
		seen.add(blockId)
		result.push(blockId)
	}
	return result
}
