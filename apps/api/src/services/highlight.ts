import { type BlockHighlight, blockHighlights, type HighlightColor } from "@sapientia/db"
import { and, eq, inArray } from "drizzle-orm"
import { db } from "../db"

export interface HighlightInput {
	blockId: string
	charStart: number | null
	charEnd: number | null
	selectedText: string
}

export async function listHighlightsForPaper(args: {
	paperId: string
	userId: string
	workspaceId: string
}): Promise<BlockHighlight[]> {
	return db
		.select()
		.from(blockHighlights)
		.where(
			and(
				eq(blockHighlights.paperId, args.paperId),
				eq(blockHighlights.userId, args.userId),
				eq(blockHighlights.workspaceId, args.workspaceId),
			),
		)
}

// Each highlight in the batch becomes its own row — we never merge or
// dedupe at insert time. Same `(blockId, charStart, charEnd)` highlighted
// twice with the same color will produce two rows; v0.1 considers this
// acceptable, and the UI never produces it (toolbar dismisses on apply).
export async function createHighlightBatch(args: {
	paperId: string
	userId: string
	workspaceId: string
	color: HighlightColor
	highlights: HighlightInput[]
}): Promise<BlockHighlight[]> {
	if (args.highlights.length === 0) return []
	return db
		.insert(blockHighlights)
		.values(
			args.highlights.map((h) => ({
				paperId: args.paperId,
				userId: args.userId,
				workspaceId: args.workspaceId,
				blockId: h.blockId,
				charStart: h.charStart,
				charEnd: h.charEnd,
				selectedText: h.selectedText,
				color: args.color,
			})),
		)
		.returning()
}

export async function updateHighlightColor(args: {
	highlightId: string
	userId: string
	color: HighlightColor
}): Promise<BlockHighlight | null> {
	const [updated] = await db
		.update(blockHighlights)
		.set({ color: args.color, updatedAt: new Date() })
		.where(and(eq(blockHighlights.id, args.highlightId), eq(blockHighlights.userId, args.userId)))
		.returning()
	return updated ?? null
}

export async function deleteHighlight(args: {
	highlightId: string
	userId: string
}): Promise<boolean> {
	const result = await db
		.delete(blockHighlights)
		.where(and(eq(blockHighlights.id, args.highlightId), eq(blockHighlights.userId, args.userId)))
		.returning({ id: blockHighlights.id })
	return result.length > 0
}

// Bulk-delete highlights overlapping any of the given ranges. Used by the
// "clear" action: the user re-selects a region they previously highlighted
// and the toolbar offers a remove. We pull candidates by blockId and filter
// in-app — fine for v0.1 scale (tens of highlights per paper).
export async function deleteHighlightsInRanges(args: {
	paperId: string
	userId: string
	workspaceId: string
	ranges: Array<{ blockId: string; charStart: number | null; charEnd: number | null }>
}): Promise<number> {
	if (args.ranges.length === 0) return 0
	const blockIds = [...new Set(args.ranges.map((r) => r.blockId))]
	if (blockIds.length === 0) return 0

	const candidates = await db
		.select()
		.from(blockHighlights)
		.where(
			and(
				eq(blockHighlights.paperId, args.paperId),
				eq(blockHighlights.userId, args.userId),
				eq(blockHighlights.workspaceId, args.workspaceId),
				inArray(blockHighlights.blockId, blockIds),
			),
		)

	const toDelete: string[] = []
	for (const c of candidates) {
		for (const r of args.ranges) {
			if (r.blockId !== c.blockId) continue
			if (rangesOverlap(c.charStart, c.charEnd, r.charStart, r.charEnd)) {
				toDelete.push(c.id)
				break
			}
		}
	}

	if (toDelete.length === 0) return 0
	await db.delete(blockHighlights).where(inArray(blockHighlights.id, toDelete))
	return toDelete.length
}

// Whole-block highlight (`null`/`null`) is treated as covering everything,
// so any other range on the same block overlaps with it.
function rangesOverlap(
	aStart: number | null,
	aEnd: number | null,
	bStart: number | null,
	bEnd: number | null,
): boolean {
	if (aStart == null || aEnd == null) return true
	if (bStart == null || bEnd == null) return true
	return aStart < bEnd && bStart < aEnd
}
