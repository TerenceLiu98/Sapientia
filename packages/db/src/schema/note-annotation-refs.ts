import { relations } from "drizzle-orm"
import { index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { notes } from "./notes"
import { papers } from "./papers"

// Bridge table between notes and cite-able reader annotations. We only admit
// highlight + underline cites into this table; ink remains purely visual and
// never participates in note anchoring/citation flows.
//
// Deliberately no FK to reader_annotations(id): note citations should remain
// visible even if the source annotation is deleted later. We preserve the id
// as a stale reference key and let the UI degrade gracefully.
export const noteAnnotationRefs = pgTable(
	"note_annotation_refs",
	{
		noteId: uuid("note_id")
			.notNull()
			.references(() => notes.id, { onDelete: "cascade" }),
		paperId: uuid("paper_id")
			.notNull()
			.references(() => papers.id, { onDelete: "cascade" }),
		annotationId: uuid("annotation_id").notNull(),
		annotationKind: text("annotation_kind", { enum: ["highlight", "underline"] }).notNull(),
		citationCount: integer("citation_count").notNull().default(1),
		firstCitedAt: timestamp("first_cited_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		primaryKey({
			name: "note_annotation_refs_pkey",
			columns: [table.noteId, table.paperId, table.annotationId],
		}),
		index("idx_note_annotation_refs_annotation").on(table.paperId, table.annotationId),
		index("idx_note_annotation_refs_note").on(table.noteId),
	],
)

export const noteAnnotationRefsRelations = relations(noteAnnotationRefs, ({ one }) => ({
	note: one(notes, { fields: [noteAnnotationRefs.noteId], references: [notes.id] }),
	paper: one(papers, { fields: [noteAnnotationRefs.paperId], references: [papers.id] }),
}))

export type NoteAnnotationRef = typeof noteAnnotationRefs.$inferSelect
export type NewNoteAnnotationRef = typeof noteAnnotationRefs.$inferInsert
