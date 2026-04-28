import { type ReaderAnnotation, readerAnnotations } from "@sapientia/db"
import { and, eq } from "drizzle-orm"
import { db } from "../db"

export async function listReaderAnnotationsForPaper(args: {
	paperId: string
	userId: string
	workspaceId: string
}): Promise<ReaderAnnotation[]> {
	return db
		.select()
		.from(readerAnnotations)
		.where(
			and(
				eq(readerAnnotations.paperId, args.paperId),
				eq(readerAnnotations.userId, args.userId),
				eq(readerAnnotations.workspaceId, args.workspaceId),
			),
		)
}

export async function createReaderAnnotation(args: {
	paperId: string
	workspaceId: string
	userId: string
	page: number
	kind: ReaderAnnotation["kind"]
	color: string
	body: ReaderAnnotation["body"]
}): Promise<ReaderAnnotation> {
	const [row] = await db
		.insert(readerAnnotations)
		.values({
			paperId: args.paperId,
			workspaceId: args.workspaceId,
			userId: args.userId,
			page: args.page,
			kind: args.kind,
			color: args.color,
			body: args.body,
		})
		.returning()
	return row
}

export async function deleteReaderAnnotation(args: {
	annotationId: string
	userId: string
}): Promise<boolean> {
	const result = await db
		.delete(readerAnnotations)
		.where(
			and(eq(readerAnnotations.id, args.annotationId), eq(readerAnnotations.userId, args.userId)),
		)
		.returning({ id: readerAnnotations.id })
	return result.length > 0
}
