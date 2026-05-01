import { relations, sql } from "drizzle-orm"
import {
	check,
	foreignKey,
	index,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core"
import { user } from "./auth"
import { blocks } from "./blocks"
import { compiledLocalConcepts } from "./compiled-local-concepts"
import { papers } from "./papers"
import { workspaces } from "./workspaces"

export const wikiPages = pgTable(
	"wiki_pages",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		ownerUserId: text("owner_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		type: text("type", { enum: ["source", "entity", "concept"] }).notNull(),
		canonicalName: text("canonical_name").notNull(),
		displayName: text("display_name").notNull(),
		sourcePaperId: uuid("source_paper_id").references(() => papers.id, { onDelete: "cascade" }),
		compiledConceptId: uuid("compiled_concept_id").references(() => compiledLocalConcepts.id, {
			onDelete: "set null",
		}),
		body: text("body"),
		generatedAt: timestamp("generated_at", { withTimezone: true }),
		modelName: text("model_name"),
		promptVersion: text("prompt_version"),
		status: text("status", { enum: ["pending", "running", "done", "failed"] })
			.notNull()
			.default("pending"),
		error: text("error"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		deletedAt: timestamp("deleted_at", { withTimezone: true }),
	},
	(table) => [
		unique("wiki_pages_owner_workspace_type_source_paper_name_unq").on(
			table.ownerUserId,
			table.workspaceId,
			table.type,
			table.sourcePaperId,
			table.canonicalName,
		),
		index("idx_wiki_pages_workspace_type").on(table.workspaceId, table.type),
		index("idx_wiki_pages_source_paper").on(table.sourcePaperId),
		index("idx_wiki_pages_compiled_concept").on(table.compiledConceptId),
		check("wiki_pages_status_check", sql`${table.status} in ('pending', 'running', 'done', 'failed')`),
		check(
			"wiki_pages_source_type_paper_check",
			sql`(
				(${table.type} = 'source' and ${table.sourcePaperId} is not null)
				or
				(${table.type} in ('entity', 'concept'))
			)`,
		),
	],
)

export const wikiPageReferences = pgTable(
	"wiki_page_references",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		pageId: uuid("page_id")
			.notNull()
			.references(() => wikiPages.id, { onDelete: "cascade" }),
		paperId: uuid("paper_id")
			.notNull()
			.references(() => papers.id, { onDelete: "cascade" }),
		blockId: text("block_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		foreignKey({
			name: "wiki_page_references_block_fk",
			columns: [table.paperId, table.blockId],
			foreignColumns: [blocks.paperId, blocks.blockId],
		}).onDelete("cascade"),
		unique("wiki_page_references_page_block_unq").on(table.pageId, table.paperId, table.blockId),
		index("idx_wiki_page_references_page").on(table.pageId),
		index("idx_wiki_page_references_block").on(table.paperId, table.blockId),
	],
)

export const wikiPagesRelations = relations(wikiPages, ({ many, one }) => ({
	workspace: one(workspaces, {
		fields: [wikiPages.workspaceId],
		references: [workspaces.id],
	}),
	owner: one(user, {
		fields: [wikiPages.ownerUserId],
		references: [user.id],
	}),
	sourcePaper: one(papers, {
		fields: [wikiPages.sourcePaperId],
		references: [papers.id],
	}),
	compiledConcept: one(compiledLocalConcepts, {
		fields: [wikiPages.compiledConceptId],
		references: [compiledLocalConcepts.id],
	}),
	references: many(wikiPageReferences),
}))

export const wikiPageReferencesRelations = relations(wikiPageReferences, ({ one }) => ({
	page: one(wikiPages, {
		fields: [wikiPageReferences.pageId],
		references: [wikiPages.id],
	}),
	paper: one(papers, {
		fields: [wikiPageReferences.paperId],
		references: [papers.id],
	}),
	block: one(blocks, {
		fields: [wikiPageReferences.paperId, wikiPageReferences.blockId],
		references: [blocks.paperId, blocks.blockId],
	}),
}))

export type WikiPage = typeof wikiPages.$inferSelect
export type NewWikiPage = typeof wikiPages.$inferInsert
export type WikiPageReference = typeof wikiPageReferences.$inferSelect
export type NewWikiPageReference = typeof wikiPageReferences.$inferInsert
