import { relations, sql } from "drizzle-orm"
import {
	check,
	doublePrecision,
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

export const compiledLocalConceptEdges = pgTable(
	"compiled_local_concept_edges",
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
		sourceConceptId: uuid("source_concept_id")
			.notNull()
			.references(() => compiledLocalConcepts.id, { onDelete: "cascade" }),
		targetConceptId: uuid("target_concept_id")
			.notNull()
			.references(() => compiledLocalConcepts.id, { onDelete: "cascade" }),
		relationType: text("relation_type", {
			enum: ["addresses", "uses", "measured_by", "improves_on", "related_to"],
		}).notNull(),
		confidence: doublePrecision("confidence"),
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
		unique("compiled_local_concept_edges_owner_workspace_paper_rel_unq").on(
			table.ownerUserId,
			table.workspaceId,
			table.paperId,
			table.sourceConceptId,
			table.targetConceptId,
			table.relationType,
		),
		index("idx_compiled_local_concept_edges_paper").on(table.paperId),
		index("idx_compiled_local_concept_edges_source").on(table.sourceConceptId),
		index("idx_compiled_local_concept_edges_target").on(table.targetConceptId),
		check(
			"compiled_local_concept_edges_status_check",
			sql`${table.status} in ('pending', 'running', 'done', 'failed')`,
		),
		check(
			"compiled_local_concept_edges_source_target_check",
			sql`${table.sourceConceptId} <> ${table.targetConceptId}`,
		),
	],
)

export const compiledLocalConceptEdgeEvidence = pgTable(
	"compiled_local_concept_edge_evidence",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		edgeId: uuid("edge_id")
			.notNull()
			.references(() => compiledLocalConceptEdges.id, { onDelete: "cascade" }),
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
			name: "compiled_local_concept_edge_evidence_block_fk",
			columns: [table.paperId, table.blockId],
			foreignColumns: [blocks.paperId, blocks.blockId],
		}).onDelete("cascade"),
		unique("compiled_local_concept_edge_evidence_edge_block_unq").on(
			table.edgeId,
			table.paperId,
			table.blockId,
		),
		index("idx_compiled_local_concept_edge_evidence_edge").on(table.edgeId),
		index("idx_compiled_local_concept_edge_evidence_block").on(table.paperId, table.blockId),
		check(
			"compiled_local_concept_edge_evidence_confidence_check",
			sql`${table.confidence} is null or (${table.confidence} >= 0 and ${table.confidence} <= 1)`,
		),
	],
)

export const compiledLocalConceptEdgesRelations = relations(
	compiledLocalConceptEdges,
	({ many, one }) => ({
		workspace: one(workspaces, {
			fields: [compiledLocalConceptEdges.workspaceId],
			references: [workspaces.id],
		}),
		owner: one(user, {
			fields: [compiledLocalConceptEdges.ownerUserId],
			references: [user.id],
		}),
		paper: one(papers, {
			fields: [compiledLocalConceptEdges.paperId],
			references: [papers.id],
		}),
		sourceConcept: one(compiledLocalConcepts, {
			fields: [compiledLocalConceptEdges.sourceConceptId],
			references: [compiledLocalConcepts.id],
		}),
		targetConcept: one(compiledLocalConcepts, {
			fields: [compiledLocalConceptEdges.targetConceptId],
			references: [compiledLocalConcepts.id],
		}),
		evidence: many(compiledLocalConceptEdgeEvidence),
	}),
)

export const compiledLocalConceptEdgeEvidenceRelations = relations(
	compiledLocalConceptEdgeEvidence,
	({ one }) => ({
		edge: one(compiledLocalConceptEdges, {
			fields: [compiledLocalConceptEdgeEvidence.edgeId],
			references: [compiledLocalConceptEdges.id],
		}),
		paper: one(papers, {
			fields: [compiledLocalConceptEdgeEvidence.paperId],
			references: [papers.id],
		}),
		block: one(blocks, {
			fields: [compiledLocalConceptEdgeEvidence.paperId, compiledLocalConceptEdgeEvidence.blockId],
			references: [blocks.paperId, blocks.blockId],
		}),
	}),
)

export type CompiledLocalConceptEdge = typeof compiledLocalConceptEdges.$inferSelect
export type NewCompiledLocalConceptEdge = typeof compiledLocalConceptEdges.$inferInsert
export type CompiledLocalConceptEdgeEvidence = typeof compiledLocalConceptEdgeEvidence.$inferSelect
export type NewCompiledLocalConceptEdgeEvidence = typeof compiledLocalConceptEdgeEvidence.$inferInsert
