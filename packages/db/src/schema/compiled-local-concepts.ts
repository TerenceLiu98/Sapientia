import { relations, sql } from "drizzle-orm"
import {
	check,
	doublePrecision,
	foreignKey,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core"
import { user } from "./auth"
import { blocks } from "./blocks"
import { papers } from "./papers"
import { workspaces } from "./workspaces"

export const compiledLocalConcepts = pgTable(
	"compiled_local_concepts",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		ownerUserId: text("owner_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
			paperId: uuid("paper_id")
				.notNull()
				.references(() => papers.id, { onDelete: "cascade" }),
			kind: text("kind", {
				enum: ["concept", "method", "task", "metric", "dataset", "person", "organization"],
			}).notNull(),
		canonicalName: text("canonical_name").notNull(),
		displayName: text("display_name").notNull(),
		salienceScore: doublePrecision("salience_score").notNull().default(0),
		highlightCount: integer("highlight_count").notNull().default(0),
		weightedHighlightScore: doublePrecision("weighted_highlight_score")
			.notNull()
			.default(0),
		noteCitationCount: integer("note_citation_count").notNull().default(0),
		lastMarginaliaAt: timestamp("last_marginalia_at", { withTimezone: true }),
		sourceLevelDescription: text("source_level_description"),
		sourceLevelDescriptionConfidence: doublePrecision("source_level_description_confidence"),
		sourceLevelDescriptionGeneratedAt: timestamp("source_level_description_generated_at", {
			withTimezone: true,
		}),
		sourceLevelDescriptionModel: text("source_level_description_model"),
		sourceLevelDescriptionPromptVersion: text("source_level_description_prompt_version"),
		sourceLevelDescriptionStatus: text("source_level_description_status", {
			enum: ["pending", "running", "done", "failed"],
		})
			.notNull()
			.default("pending"),
		sourceLevelDescriptionError: text("source_level_description_error"),
		sourceLevelDescriptionInputHash: text("source_level_description_input_hash"),
		sourceLevelDescriptionDirtyAt: timestamp("source_level_description_dirty_at", {
			withTimezone: true,
		}),
		readerSignalSummary: text("reader_signal_summary"),
		readerSignalSummaryGeneratedAt: timestamp("reader_signal_summary_generated_at", {
			withTimezone: true,
		}),
		readerSignalSummaryModel: text("reader_signal_summary_model"),
		readerSignalSummaryPromptVersion: text("reader_signal_summary_prompt_version"),
		readerSignalSummaryStatus: text("reader_signal_summary_status", {
			enum: ["pending", "running", "done", "failed"],
		})
			.notNull()
			.default("pending"),
		readerSignalSummaryError: text("reader_signal_summary_error"),
		readerSignalSummaryInputHash: text("reader_signal_summary_input_hash"),
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
		unique("compiled_local_concepts_owner_workspace_paper_kind_name_unq").on(
			table.ownerUserId,
			table.workspaceId,
			table.paperId,
			table.kind,
			table.canonicalName,
		),
		index("idx_compiled_local_concepts_workspace_kind").on(table.workspaceId, table.kind),
		index("idx_compiled_local_concepts_paper_kind").on(table.paperId, table.kind),
		index("idx_compiled_local_concepts_description_status").on(
			table.workspaceId,
			table.paperId,
			table.sourceLevelDescriptionStatus,
		),
		check(
			"compiled_local_concepts_status_check",
			sql`${table.status} in ('pending', 'running', 'done', 'failed')`,
		),
		check(
			"compiled_local_concepts_source_level_description_status_check",
			sql`${table.sourceLevelDescriptionStatus} in ('pending', 'running', 'done', 'failed')`,
		),
		check(
			"compiled_local_concepts_reader_signal_summary_status_check",
			sql`${table.readerSignalSummaryStatus} in ('pending', 'running', 'done', 'failed')`,
		),
		check(
			"compiled_local_concepts_source_level_description_confidence_check",
			sql`${table.sourceLevelDescriptionConfidence} is null or (${table.sourceLevelDescriptionConfidence} >= 0 and ${table.sourceLevelDescriptionConfidence} <= 1)`,
		),
	],
)

export const compiledLocalConceptEvidence = pgTable(
	"compiled_local_concept_evidence",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		conceptId: uuid("concept_id")
			.notNull()
			.references(() => compiledLocalConcepts.id, { onDelete: "cascade" }),
		paperId: uuid("paper_id")
			.notNull()
			.references(() => papers.id, { onDelete: "cascade" }),
		blockId: text("block_id").notNull(),
		snippet: text("snippet"),
		confidence: doublePrecision("confidence"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		foreignKey({
			name: "compiled_local_concept_evidence_block_fk",
			columns: [table.paperId, table.blockId],
			foreignColumns: [blocks.paperId, blocks.blockId],
		}).onDelete("cascade"),
		unique("compiled_local_concept_evidence_concept_block_unq").on(
			table.conceptId,
			table.paperId,
			table.blockId,
		),
		index("idx_compiled_local_concept_evidence_concept").on(table.conceptId),
		index("idx_compiled_local_concept_evidence_block").on(table.paperId, table.blockId),
		check(
			"compiled_local_concept_evidence_confidence_check",
			sql`${table.confidence} is null or (${table.confidence} >= 0 and ${table.confidence} <= 1)`,
		),
	],
)

export const compiledLocalConceptsRelations = relations(compiledLocalConcepts, ({ many, one }) => ({
	workspace: one(workspaces, {
		fields: [compiledLocalConcepts.workspaceId],
		references: [workspaces.id],
	}),
	owner: one(user, {
		fields: [compiledLocalConcepts.ownerUserId],
		references: [user.id],
	}),
	paper: one(papers, {
		fields: [compiledLocalConcepts.paperId],
		references: [papers.id],
	}),
	evidence: many(compiledLocalConceptEvidence),
}))

export const compiledLocalConceptEvidenceRelations = relations(
	compiledLocalConceptEvidence,
	({ one }) => ({
		concept: one(compiledLocalConcepts, {
			fields: [compiledLocalConceptEvidence.conceptId],
			references: [compiledLocalConcepts.id],
		}),
		paper: one(papers, {
			fields: [compiledLocalConceptEvidence.paperId],
			references: [papers.id],
		}),
		block: one(blocks, {
			fields: [compiledLocalConceptEvidence.paperId, compiledLocalConceptEvidence.blockId],
			references: [blocks.paperId, blocks.blockId],
		}),
	}),
)

export type CompiledLocalConcept = typeof compiledLocalConcepts.$inferSelect
export type NewCompiledLocalConcept = typeof compiledLocalConcepts.$inferInsert
export type CompiledLocalConceptEvidence = typeof compiledLocalConceptEvidence.$inferSelect
export type NewCompiledLocalConceptEvidence = typeof compiledLocalConceptEvidence.$inferInsert
