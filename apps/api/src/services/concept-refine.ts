import {
	blocks as blocksTable,
	blockHighlights,
	compiledLocalConceptEvidence,
	compiledLocalConcepts,
	noteAnnotationRefs,
	noteBlockRefs,
	notes,
	readerAnnotations,
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
			sourceLevelDescriptionConfidence: compiledLocalConcepts.sourceLevelDescriptionConfidence,
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

	const annotationRefRows = await db
		.select({
			annotationId: noteAnnotationRefs.annotationId,
			citationCount: noteAnnotationRefs.citationCount,
			noteUpdatedAt: notes.updatedAt,
			page: readerAnnotations.page,
			body: readerAnnotations.body,
		})
		.from(noteAnnotationRefs)
		.innerJoin(notes, eq(notes.id, noteAnnotationRefs.noteId))
		.innerJoin(
			readerAnnotations,
			and(
				eq(readerAnnotations.id, noteAnnotationRefs.annotationId),
				eq(readerAnnotations.paperId, noteAnnotationRefs.paperId),
				isNull(readerAnnotations.deletedAt),
			),
		)
		.where(
			and(
				eq(noteAnnotationRefs.paperId, paperId),
				eq(notes.paperId, paperId),
				eq(notes.workspaceId, workspaceId),
				eq(notes.ownerUserId, userId),
				isNull(notes.deletedAt),
			),
		)

	const paperBlocks = await db
		.select({
			blockId: blocksTable.blockId,
			page: blocksTable.page,
			bbox: blocksTable.bbox,
		})
		.from(blocksTable)
		.where(eq(blocksTable.paperId, paperId))

	const highlightByBlockId = new Map(
		highlightRows.map((row) => [row.blockId, row] as const),
	)

	const noteRefsByBlockId = new Map<
		string,
		{ citationCount: number; noteUpdatedAt: Date | null }
	>()
	for (const row of noteRefRows) {
		addNoteRefSignal(noteRefsByBlockId, row.blockId, {
			citationCount: row.citationCount,
			noteUpdatedAt: row.noteUpdatedAt,
		})
	}
	for (const row of annotationRefRows) {
		const blockId = findOverlappingBlockId(paperBlocks, row.page, annotationBodyBoundingBox(row.body))
		if (!blockId) continue
		addNoteRefSignal(noteRefsByBlockId, blockId, {
			citationCount: row.citationCount,
			noteUpdatedAt: row.noteUpdatedAt,
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
				readerSignalDirtyAt: now,
				confidenceScore: calculateConceptConfidence({
					evidenceBlockCount: blockIds.length,
					sourceLevelDescriptionConfidence: concept.sourceLevelDescriptionConfidence,
				}),
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

function addNoteRefSignal(
	noteRefsByBlockId: Map<string, { citationCount: number; noteUpdatedAt: Date | null }>,
	blockId: string,
	row: { citationCount: number; noteUpdatedAt: Date | null },
) {
	const existing = noteRefsByBlockId.get(blockId)
	if (!existing) {
		noteRefsByBlockId.set(blockId, {
			citationCount: row.citationCount,
			noteUpdatedAt: row.noteUpdatedAt,
		})
		return
	}
	noteRefsByBlockId.set(blockId, {
		citationCount: existing.citationCount + row.citationCount,
		noteUpdatedAt:
			!existing.noteUpdatedAt || (row.noteUpdatedAt && row.noteUpdatedAt > existing.noteUpdatedAt)
				? row.noteUpdatedAt
				: existing.noteUpdatedAt,
	})
}

function calculateConceptConfidence(args: {
	evidenceBlockCount: number
	sourceLevelDescriptionConfidence: number | null
}) {
	const evidenceConfidence = Math.min(0.4, args.evidenceBlockCount * 0.08)
	const descriptionConfidence = args.sourceLevelDescriptionConfidence ?? 0.45
	return Math.max(0, Math.min(1, Math.round((descriptionConfidence * 0.6 + evidenceConfidence) * 100) / 100))
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

function annotationBodyBoundingBox(body: unknown) {
	if (!body || typeof body !== "object" || !("rects" in body)) return null
	const rects = (body as { rects?: unknown }).rects
	if (!Array.isArray(rects) || rects.length === 0) return null
	let minX = Number.POSITIVE_INFINITY
	let minY = Number.POSITIVE_INFINITY
	let maxX = 0
	let maxY = 0
	for (const rect of rects) {
		if (!rect || typeof rect !== "object") continue
		const candidate = rect as { x?: unknown; y?: unknown; w?: unknown; h?: unknown }
		if (
			typeof candidate.x !== "number" ||
			typeof candidate.y !== "number" ||
			typeof candidate.w !== "number" ||
			typeof candidate.h !== "number"
		) {
			continue
		}
		minX = Math.min(minX, candidate.x)
		minY = Math.min(minY, candidate.y)
		maxX = Math.max(maxX, candidate.x + candidate.w)
		maxY = Math.max(maxY, candidate.y + candidate.h)
	}
	if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null
	return { x: minX, y: minY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) }
}

function findOverlappingBlockId(
	blocks: Array<{ blockId: string; page: number; bbox: { x: number; y: number; w: number; h: number } | null }>,
	page: number,
	rect: { x: number; y: number; w: number; h: number } | null,
) {
	if (!rect) return null
	let best: { blockId: string; area: number } | null = null
	for (const block of blocks) {
		if (block.page !== page || !block.bbox) continue
		const area = intersectionArea(rect, block.bbox)
		if (area <= 0) continue
		if (!best || area > best.area) best = { blockId: block.blockId, area }
	}
	return best?.blockId ?? null
}

function intersectionArea(
	a: { x: number; y: number; w: number; h: number },
	b: { x: number; y: number; w: number; h: number },
) {
	const x1 = Math.max(a.x, b.x)
	const y1 = Math.max(a.y, b.y)
	const x2 = Math.min(a.x + a.w, b.x + b.w)
	const y2 = Math.min(a.y + a.h, b.y + b.h)
	return Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
}
