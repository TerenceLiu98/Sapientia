import { relations } from "drizzle-orm"
import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { user } from "./auth"
import { papers } from "./papers"
import { workspaces } from "./workspaces"

// User-applied semantic highlight on a paper's block. Block-level only —
// highlighting is a one-color fill on the entire block, not a character
// range. (We tried char-level first; it was unworkable to keep visually
// aligned with PDF.js's rendered text.)
//
// `color` is a free-form string. The frontend ships five built-in
// semantic names (questioning / important / original / pending /
// background) per docs/DESIGN_TOKENS.md §2.5, but users can register
// custom names + display colors via settings; we don't constrain them
// at the DB level. (Older rows from before TASK-019.1 may carry
// `conclusion` — migration 0018 renames those to `background`.)
//
// Unique on `(paperId, blockId, userId, workspaceId)` so a block has at
// most one highlight per user + workspace; clicking a different color
// overwrites, clicking the same color again clears.
export const blockHighlights = pgTable(
	"block_highlights",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		paperId: uuid("paper_id")
			.notNull()
			.references(() => papers.id, { onDelete: "cascade" }),
		blockId: text("block_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),

		color: text("color").notNull(),

		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index("idx_highlights_paper_user").on(table.paperId, table.userId),
		index("idx_highlights_block").on(table.paperId, table.blockId),
		index("idx_highlights_workspace_color").on(table.workspaceId, table.color),
		unique("uniq_highlights_block_owner").on(
			table.paperId,
			table.blockId,
			table.userId,
			table.workspaceId,
		),
	],
)

export const blockHighlightsRelations = relations(blockHighlights, ({ one }) => ({
	paper: one(papers, {
		fields: [blockHighlights.paperId],
		references: [papers.id],
	}),
	user: one(user, {
		fields: [blockHighlights.userId],
		references: [user.id],
	}),
	workspace: one(workspaces, {
		fields: [blockHighlights.workspaceId],
		references: [workspaces.id],
	}),
}))

export type BlockHighlight = typeof blockHighlights.$inferSelect
export type NewBlockHighlight = typeof blockHighlights.$inferInsert
// Built-in semantic colors. Users can persist additional names via the
// frontend settings module; the DB doesn't constrain `color` so any string
// the frontend recognizes is valid.
export type BuiltinHighlightColor =
	| "questioning"
	| "important"
	| "original"
	| "pending"
	| "background"
