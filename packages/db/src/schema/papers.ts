import { relations, sql } from "drizzle-orm"
import {
	bigint,
	check,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core"
import { user } from "./auth"
import { workspaces } from "./workspaces"

export const papers = pgTable(
	"papers",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		ownerUserId: text("owner_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		contentHash: text("content_hash").notNull(),
		doi: text("doi"),
		arxivId: text("arxiv_id"),
		title: text("title").notNull(),
		authors: jsonb("authors").$type<string[]>(),
		fileSizeBytes: bigint("file_size_bytes", { mode: "number" }).notNull(),
		pdfObjectKey: text("pdf_object_key").notNull(),
		blocksObjectKey: text("blocks_object_key"),
		parseStatus: text("parse_status").notNull().default("pending"),
		parseError: text("parse_error"),
		// Live progress reported by MinerU during the `running` state. Both null
		// when no parse has started; populated and updated each poll while
		// state="running"; left in place after `done`/`failed` for the UI.
		parseProgressExtracted: integer("parse_progress_extracted"),
		parseProgressTotal: integer("parse_progress_total"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		deletedAt: timestamp("deleted_at", { withTimezone: true }),
	},
	(table) => [
		unique("papers_owner_content_hash_unq").on(table.ownerUserId, table.contentHash),
		index("idx_papers_owner_user_id").on(table.ownerUserId),
		index("idx_papers_content_hash").on(table.contentHash),
		check(
			"papers_parse_status_check",
			sql`${table.parseStatus} in ('pending', 'parsing', 'done', 'failed')`,
		),
	],
)

export const workspacePapers = pgTable(
	"workspace_papers",
	{
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		paperId: uuid("paper_id")
			.notNull()
			.references(() => papers.id, { onDelete: "cascade" }),
		grantedBy: text("granted_by")
			.notNull()
			.references(() => user.id),
		grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		primaryKey({ name: "workspace_papers_pkey", columns: [table.workspaceId, table.paperId] }),
		index("idx_workspace_papers_workspace_id").on(table.workspaceId),
	],
)

export const papersRelations = relations(papers, ({ many, one }) => ({
	owner: one(user, {
		fields: [papers.ownerUserId],
		references: [user.id],
	}),
	workspaceLinks: many(workspacePapers),
}))

export const workspacePapersRelations = relations(workspacePapers, ({ one }) => ({
	workspace: one(workspaces, {
		fields: [workspacePapers.workspaceId],
		references: [workspaces.id],
	}),
	paper: one(papers, {
		fields: [workspacePapers.paperId],
		references: [papers.id],
	}),
	granter: one(user, {
		fields: [workspacePapers.grantedBy],
		references: [user.id],
	}),
}))

export type Paper = typeof papers.$inferSelect
export type NewPaper = typeof papers.$inferInsert
export type WorkspacePaper = typeof workspacePapers.$inferSelect
