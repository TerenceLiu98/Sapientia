import { type BlockHighlight, blockHighlights } from "@sapientia/db"
import { and, eq } from "drizzle-orm"
import { db } from "../db"

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

// Idempotent set: there's a unique constraint on
// `(paperId, blockId, userId, workspaceId)`, so we let Postgres do the
// upsert. The same caller can also clear the highlight by passing
// `color: null` — that's a separate path (`clearBlockHighlight`).
export async function setBlockHighlight(args: {
	paperId: string
	blockId: string
	userId: string
	workspaceId: string
	color: string
}): Promise<BlockHighlight> {
	const [row] = await db
		.insert(blockHighlights)
		.values({
			paperId: args.paperId,
			blockId: args.blockId,
			userId: args.userId,
			workspaceId: args.workspaceId,
			color: args.color,
		})
		.onConflictDoUpdate({
			target: [
				blockHighlights.paperId,
				blockHighlights.blockId,
				blockHighlights.userId,
				blockHighlights.workspaceId,
			],
			set: { color: args.color, updatedAt: new Date() },
		})
		.returning()
	return row
}

export async function clearBlockHighlight(args: {
	paperId: string
	blockId: string
	userId: string
	workspaceId: string
}): Promise<boolean> {
	const result = await db
		.delete(blockHighlights)
		.where(
			and(
				eq(blockHighlights.paperId, args.paperId),
				eq(blockHighlights.blockId, args.blockId),
				eq(blockHighlights.userId, args.userId),
				eq(blockHighlights.workspaceId, args.workspaceId),
			),
		)
		.returning({ id: blockHighlights.id })
	return result.length > 0
}

export async function deleteHighlight(args: {
	highlightId: string
	userId: string
}): Promise<boolean> {
	const [existing] = await db
		.select()
		.from(blockHighlights)
		.where(and(eq(blockHighlights.id, args.highlightId), eq(blockHighlights.userId, args.userId)))
		.limit(1)
	if (!existing) return false

	const result = await db
		.delete(blockHighlights)
		.where(and(eq(blockHighlights.id, args.highlightId), eq(blockHighlights.userId, args.userId)))
		.returning({ id: blockHighlights.id })
	return result.length > 0
}

export async function getHighlightById(args: {
	highlightId: string
	userId: string
}): Promise<BlockHighlight | null> {
	const [row] = await db
		.select()
		.from(blockHighlights)
		.where(and(eq(blockHighlights.id, args.highlightId), eq(blockHighlights.userId, args.userId)))
		.limit(1)
	return row ?? null
}
