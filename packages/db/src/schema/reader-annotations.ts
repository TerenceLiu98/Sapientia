import { relations } from "drizzle-orm"
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { user } from "./auth"
import { papers } from "./papers"
import { workspaces } from "./workspaces"

export interface ReaderAnnotationPoint {
	x: number
	y: number
}

export interface ReaderAnnotationRect {
	x: number
	y: number
	w: number
	h: number
}

export type ReaderAnnotationKind = "highlight" | "underline" | "ink"

export type ReaderAnnotationBody =
	| { rect: ReaderAnnotationRect }
	| { from: ReaderAnnotationPoint; to: ReaderAnnotationPoint }
	| { points: ReaderAnnotationPoint[] }

// Human-reading markup drawn over the PDF surface. These annotations are
// page-relative and intentionally decoupled from block ids / bbox-driven
// agent pipelines so the user can mark up the paper without mutating the
// machine-facing layout layer.
export const readerAnnotations = pgTable(
	"reader_annotations",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		paperId: uuid("paper_id")
			.notNull()
			.references(() => papers.id, { onDelete: "cascade" }),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		page: integer("page").notNull(),
		kind: text("kind", { enum: ["highlight", "underline", "ink"] }).notNull(),
		color: text("color").notNull(),
		body: jsonb("body").$type<ReaderAnnotationBody>().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		// Soft-delete timestamp. Set when the annotation is "deleted" but
		// still referenced by a note's citation chip or anchor — we keep the
		// row so the chip can resolve the original page/y/snapshot and the
		// reader can render a faint ghost rect instead of a dead reference.
		// If no note references the annotation at delete time, the row is
		// hard-deleted and this column never matters.
		deletedAt: timestamp("deleted_at", { withTimezone: true }),
	},
	(table) => [
		index("idx_reader_annotations_paper_user_workspace").on(
			table.paperId,
			table.userId,
			table.workspaceId,
		),
		index("idx_reader_annotations_paper_page").on(table.paperId, table.page),
	],
)

export const readerAnnotationsRelations = relations(readerAnnotations, ({ one }) => ({
	paper: one(papers, {
		fields: [readerAnnotations.paperId],
		references: [papers.id],
	}),
	workspace: one(workspaces, {
		fields: [readerAnnotations.workspaceId],
		references: [workspaces.id],
	}),
	user: one(user, {
		fields: [readerAnnotations.userId],
		references: [user.id],
	}),
}))

export type ReaderAnnotation = typeof readerAnnotations.$inferSelect
export type NewReaderAnnotation = typeof readerAnnotations.$inferInsert
