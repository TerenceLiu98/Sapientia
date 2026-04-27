import { relations } from "drizzle-orm"
import { index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { notes } from "./notes"
import { papers } from "./papers"

// Bridge table between notes and the blocks they cite. Rebuilt fully on
// every note save (idempotent: delete-by-noteId + insert). Composite PK
// guarantees one row per (note, paper, block); citationCount sums up
// repeated references in the same note.
export const noteBlockRefs = pgTable(
	"note_block_refs",
	{
		noteId: uuid("note_id")
			.notNull()
			.references(() => notes.id, { onDelete: "cascade" }),
		paperId: uuid("paper_id")
			.notNull()
			.references(() => papers.id, { onDelete: "cascade" }),
		// We deliberately don't FK to blocks(paperId, blockId): a citation
		// can outlive a re-parse that changes block ids, and v0.2 may want
		// to keep stale references visible with a "block changed" hint.
		blockId: text("block_id").notNull(),
		citationCount: integer("citation_count").notNull().default(1),
		firstCitedAt: timestamp("first_cited_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		primaryKey({
			name: "note_block_refs_pkey",
			columns: [table.noteId, table.paperId, table.blockId],
		}),
		index("idx_note_block_refs_block").on(table.paperId, table.blockId),
		index("idx_note_block_refs_note").on(table.noteId),
	],
)

export const noteBlockRefsRelations = relations(noteBlockRefs, ({ one }) => ({
	note: one(notes, { fields: [noteBlockRefs.noteId], references: [notes.id] }),
	paper: one(papers, { fields: [noteBlockRefs.paperId], references: [papers.id] }),
}))

export type NoteBlockRef = typeof noteBlockRefs.$inferSelect
export type NewNoteBlockRef = typeof noteBlockRefs.$inferInsert
