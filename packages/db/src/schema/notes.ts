import { relations, sql } from "drizzle-orm"
import {
	customType,
	doublePrecision,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core"
import { user } from "./auth"
import { papers } from "./papers"
import { workspaces } from "./workspaces"

const tsvector = customType<{ data: string; default: false }>({
	dataType() {
		return "tsvector"
	},
})

export const notes = pgTable(
	"notes",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		ownerUserId: text("owner_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		// nullable: a note can be standalone (workspace-level) or attached to a
		// specific paper. ON DELETE SET NULL preserves notes if the paper is
		// soft-deleted then hard-purged later.
		paperId: uuid("paper_id").references(() => papers.id, { onDelete: "set null" }),

		title: text("title").notNull().default("Untitled"),
		currentVersion: integer("current_version").notNull().default(1),

		// Spatial anchor for the marginalia model. A note pins to a
		// (page, y_ratio) position in its paper; y_ratio is 0..1 within the
		// page so the anchor survives zoom and device-pixel changes.
		//
		// `anchorKind` declares which conceptual source the user attached the
		// note to: a structural block, a highlight/underline they drew, or
		// just a position on the page. The matching id (block id or
		// reader-annotation uuid) lives in `anchorBlockId` /
		// `anchorAnnotationId`. We store both even when one is the primary —
		// e.g. a highlight-anchored note also remembers which block it
		// landed inside, so the marginalia tag strip can show "block 7" as a
		// secondary structural anchor and the jump-to-anchor flow has a
		// fallback if the highlight is later deleted (block ids are stable;
		// annotation ids aren't).
		//
		// All anchor fields are nullable for legacy / standalone /
		// workspace-level notes.
		anchorPage: integer("anchor_page"),
		anchorYRatio: doublePrecision("anchor_y_ratio"),
		anchorKind: text("anchor_kind", {
			enum: ["page", "block", "highlight", "underline"],
		}),
		anchorBlockId: text("anchor_block_id"),
		anchorAnnotationId: uuid("anchor_annotation_id"),

		// MinIO keys for this note's content. The JSON is BlockNote's authoritative
		// document; the markdown is a lossy derived sibling kept alongside for
		// search + agent context.
		jsonObjectKey: text("json_object_key").notNull(),
		mdObjectKey: text("md_object_key").notNull(),
		// First N chars of the derived markdown, kept in Postgres so the agent
		// loop can pull note context without a MinIO round-trip per note.
		agentMarkdownCache: text("agent_markdown_cache").notNull().default(""),
		// Populated synchronously in updateNote/createNote via to_tsvector(...).
		searchText: tsvector("search_text"),

		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		deletedAt: timestamp("deleted_at", { withTimezone: true }),
	},
	(table) => [
		index("idx_notes_workspace").on(table.workspaceId),
		index("idx_notes_paper").on(table.paperId),
		index("idx_notes_owner").on(table.ownerUserId),
		// Marginalia is plural by design: many notes per (paper, owner),
		// each anchored to a different position. The legacy
		// uniq_notes_paper_owner_active constraint is dropped (TASK-018).
		index("idx_notes_paper_anchor").on(table.paperId, table.anchorPage, table.anchorYRatio),
		// Manually-applied GIN index — see the migration for the SQL. Drizzle's
		// schema layer doesn't model GIN-on-tsvector cleanly, but listing it
		// here keeps the intent visible. The `using` here is a no-op; the real
		// index is `using gin (search_text)`.
		index("idx_notes_search").using("gin", sql`${table.searchText}`),
	],
)

export const notesRelations = relations(notes, ({ one }) => ({
	workspace: one(workspaces, {
		fields: [notes.workspaceId],
		references: [workspaces.id],
	}),
	owner: one(user, {
		fields: [notes.ownerUserId],
		references: [user.id],
	}),
	paper: one(papers, {
		fields: [notes.paperId],
		references: [papers.id],
	}),
}))

export type Note = typeof notes.$inferSelect
export type NewNote = typeof notes.$inferInsert
