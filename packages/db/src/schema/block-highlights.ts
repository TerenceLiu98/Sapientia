import { relations } from "drizzle-orm"
import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { user } from "./auth"
import { papers } from "./papers"
import { workspaces } from "./workspaces"

// User-applied semantic highlights on a paper's blocks. Two-layer design
// (TASK-017):
//
// - UI / storage granularity = character-level. The user picks the precise
//   words they meant; we keep `charStart` / `charEnd` within the block's
//   `text` column. `(null, null)` means "whole-block highlight" (used for
//   non-text blocks: figure, table, equation).
// - Agent-context granularity = block-level. The agent layer (TASK-018+)
//   reads the containing block plus the highlight's `selectedText` as an
//   "user marked" annotation. See `formatBlocksForAgent()` in
//   `@sapientia/shared`.
//
// `selectedText` is redundantly stored: if MinerU re-parses the paper and
// the block text drifts, we still know what the user originally meant.
//
// Multiple highlights per `(paper, block, user, workspace)` are intentionally
// allowed — different ranges, different colors. v0.1 has no overlap merging.
export const blockHighlights = pgTable(
	"block_highlights",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		paperId: uuid("paper_id")
			.notNull()
			.references(() => papers.id, { onDelete: "cascade" }),
		// Block IDs are the 8-char content hashes from MinerU parsing; not FK
		// to `blocks` because (paperId, blockId) is the composite key there.
		blockId: text("block_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),

		charStart: integer("char_start"),
		charEnd: integer("char_end"),
		selectedText: text("selected_text").notNull(),

		color: text("color", {
			enum: ["questioning", "important", "original", "pending", "background"],
		}).notNull(),

		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		// "Show me everything I've highlighted on this paper" — primary query.
		index("idx_highlights_paper_user").on(table.paperId, table.userId),
		// "What highlights does this block have?" — for agent context build.
		index("idx_highlights_block").on(table.paperId, table.blockId),
		// Cross-paper queries by color (e.g. "all my questioning highlights").
		index("idx_highlights_workspace_color").on(table.workspaceId, table.color),
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
export type HighlightColor = "questioning" | "important" | "original" | "pending" | "background"
