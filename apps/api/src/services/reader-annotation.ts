import { noteAnnotationRefs, notes, type ReaderAnnotation, readerAnnotations } from "@sapientia/db"
import { and, eq, isNull, or, sql } from "drizzle-orm"
import { db } from "../db"

export async function listReaderAnnotationsForPaper(args: {
	paperId: string
	userId: string
	workspaceId: string
}): Promise<ReaderAnnotation[]> {
	// Returns both live and soft-deleted annotations. Soft-deleted ones are
	// kept around because notes still cite them; the client renders them as
	// faint ghost rects via the `deletedAt` field.
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

export async function updateReaderAnnotationColor(args: {
	annotationId: string
	userId: string
	color: string
}): Promise<ReaderAnnotation | null> {
	const [row] = await db
		.update(readerAnnotations)
		.set({ color: args.color })
		.where(
			and(eq(readerAnnotations.id, args.annotationId), eq(readerAnnotations.userId, args.userId)),
		)
		.returning()
	return row ?? null
}

// Delete an annotation. If any live note references it (either as a primary
// anchor or via a citation chip in its body), the annotation is soft-deleted
// so the note's chip can still resolve to a page/y-position and the reader
// can render a faint ghost rect. Otherwise it is hard-deleted to keep the
// table tidy.
export async function deleteReaderAnnotation(args: {
	annotationId: string
	userId: string
}): Promise<{ removed: boolean; softDeleted: boolean }> {
	const referenced = await isAnnotationReferencedByNote(args.annotationId)
	if (referenced) {
		const updated = await db
			.update(readerAnnotations)
			.set({ deletedAt: sql`now()` })
			.where(
				and(
					eq(readerAnnotations.id, args.annotationId),
					eq(readerAnnotations.userId, args.userId),
					isNull(readerAnnotations.deletedAt),
				),
			)
			.returning({ id: readerAnnotations.id })
		return { removed: updated.length > 0, softDeleted: true }
	}
	const result = await db
		.delete(readerAnnotations)
		.where(
			and(eq(readerAnnotations.id, args.annotationId), eq(readerAnnotations.userId, args.userId)),
		)
		.returning({ id: readerAnnotations.id })
	return { removed: result.length > 0, softDeleted: false }
}

// Re-activate a soft-deleted annotation. Lets the user undo a destructive
// click after the fact, and is the workhorse behind the "Restore" affordance
// on the ghost popover.
export async function restoreReaderAnnotation(args: {
	annotationId: string
	userId: string
}): Promise<ReaderAnnotation | null> {
	const [row] = await db
		.update(readerAnnotations)
		.set({ deletedAt: null })
		.where(
			and(eq(readerAnnotations.id, args.annotationId), eq(readerAnnotations.userId, args.userId)),
		)
		.returning()
	return row ?? null
}

async function isAnnotationReferencedByNote(annotationId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: notes.id })
		.from(notes)
		.leftJoin(noteAnnotationRefs, eq(noteAnnotationRefs.noteId, notes.id))
		.where(
			and(
				isNull(notes.deletedAt),
				or(
					eq(notes.anchorAnnotationId, annotationId),
					eq(noteAnnotationRefs.annotationId, annotationId),
				),
			),
		)
		.limit(1)
	return Boolean(row)
}
