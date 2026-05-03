import { relations, sql } from "drizzle-orm"
import {
	check,
	doublePrecision,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core"
import { user } from "./auth"
import { compiledLocalConcepts } from "./compiled-local-concepts"
import { papers } from "./papers"
import { workspaces } from "./workspaces"

export const conceptObservations = pgTable(
	"concept_observations",
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
		localConceptId: uuid("local_concept_id")
			.notNull()
			.references(() => compiledLocalConcepts.id, { onDelete: "cascade" }),
		sourceType: text("source_type", { enum: ["highlight", "note"] }).notNull(),
		sourceId: text("source_id").notNull(),
		blockIds: jsonb("block_ids").$type<string[]>().notNull().default([]),
		observationText: text("observation_text"),
		signalWeight: doublePrecision("signal_weight").notNull().default(0),
		observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
		consolidatedAt: timestamp("consolidated_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		deletedAt: timestamp("deleted_at", { withTimezone: true }),
	},
	(table) => [
		unique("concept_observations_source_unq").on(
			table.workspaceId,
			table.ownerUserId,
			table.localConceptId,
			table.sourceType,
			table.sourceId,
		),
		index("idx_concept_observations_concept").on(table.localConceptId, table.deletedAt),
		index("idx_concept_observations_workspace_type").on(
			table.workspaceId,
			table.sourceType,
			table.observedAt,
		),
		check(
			"concept_observations_source_type_check",
			sql`${table.sourceType} in ('highlight', 'note')`,
		),
		check(
			"concept_observations_signal_weight_check",
			sql`${table.signalWeight} >= 0`,
		),
	],
)

export const conceptMeaningRevisions = pgTable(
	"concept_meaning_revisions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		ownerUserId: text("owner_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		localConceptId: uuid("local_concept_id")
			.notNull()
			.references(() => compiledLocalConcepts.id, { onDelete: "cascade" }),
		previousDescription: text("previous_description"),
		proposedDescription: text("proposed_description").notNull(),
		sourceObservationIds: jsonb("source_observation_ids").$type<string[]>().notNull().default([]),
		changeType: text("change_type", {
			enum: ["clarification", "extension", "correction", "contradiction"],
		}).notNull(),
		confidence: doublePrecision("confidence").notNull(),
		status: text("status", {
			enum: ["candidate", "accepted", "superseded", "rejected"],
		})
			.notNull()
			.default("candidate"),
		rationale: text("rationale"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		acceptedAt: timestamp("accepted_at", { withTimezone: true }),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		index("idx_concept_meaning_revisions_concept_status").on(
			table.localConceptId,
			table.status,
		),
		index("idx_concept_meaning_revisions_workspace_status").on(
			table.workspaceId,
			table.status,
			table.createdAt,
		),
		check(
			"concept_meaning_revisions_change_type_check",
			sql`${table.changeType} in ('clarification', 'extension', 'correction', 'contradiction')`,
		),
		check(
			"concept_meaning_revisions_status_check",
			sql`${table.status} in ('candidate', 'accepted', 'superseded', 'rejected')`,
		),
		check(
			"concept_meaning_revisions_confidence_check",
			sql`${table.confidence} >= 0 and ${table.confidence} <= 1`,
		),
	],
)

export const workspacePaperGraphSnapshots = pgTable(
	"workspace_paper_graph_snapshots",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		ownerUserId: text("owner_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		graphJson: jsonb("graph_json").$type<Record<string, unknown>>().notNull(),
		inputFingerprint: text("input_fingerprint").notNull(),
		status: text("status", {
			enum: ["forming", "stable", "stale", "refreshing", "failed"],
		})
			.notNull()
			.default("forming"),
		error: text("error"),
		generatedAt: timestamp("generated_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		unique("workspace_paper_graph_snapshots_workspace_owner_unq").on(
			table.workspaceId,
			table.ownerUserId,
		),
		index("idx_workspace_paper_graph_snapshots_status").on(table.workspaceId, table.status),
		check(
			"workspace_paper_graph_snapshots_status_check",
			sql`${table.status} in ('forming', 'stable', 'stale', 'refreshing', 'failed')`,
		),
	],
)

export const workspacePaperGraphEdges = pgTable(
	"workspace_paper_graph_edges",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		ownerUserId: text("owner_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		sourcePaperId: uuid("source_paper_id")
			.notNull()
			.references(() => papers.id, { onDelete: "cascade" }),
		targetPaperId: uuid("target_paper_id")
			.notNull()
			.references(() => papers.id, { onDelete: "cascade" }),
		edgeKind: text("edge_kind").notNull(),
		weight: doublePrecision("weight").notNull(),
		confidence: doublePrecision("confidence"),
		evidenceCount: doublePrecision("evidence_count").notNull().default(0),
		topEvidenceJson: jsonb("top_evidence_json").$type<Record<string, unknown>[]>().notNull().default([]),
		lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }),
		status: text("status", { enum: ["active", "stale", "superseded"] })
			.notNull()
			.default("active"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		unique("workspace_paper_graph_edges_pair_unq").on(
			table.workspaceId,
			table.ownerUserId,
			table.sourcePaperId,
			table.targetPaperId,
		),
		index("idx_workspace_paper_graph_edges_workspace_status").on(
			table.workspaceId,
			table.status,
		),
		check(
			"workspace_paper_graph_edges_weight_check",
			sql`${table.weight} >= 0 and ${table.weight} <= 1`,
		),
		check(
			"workspace_paper_graph_edges_confidence_check",
			sql`${table.confidence} is null or (${table.confidence} >= 0 and ${table.confidence} <= 1)`,
		),
		check(
			"workspace_paper_graph_edges_status_check",
			sql`${table.status} in ('active', 'stale', 'superseded')`,
		),
	],
)

export const conceptObservationsRelations = relations(conceptObservations, ({ one }) => ({
	workspace: one(workspaces, {
		fields: [conceptObservations.workspaceId],
		references: [workspaces.id],
	}),
	owner: one(user, {
		fields: [conceptObservations.ownerUserId],
		references: [user.id],
	}),
	paper: one(papers, {
		fields: [conceptObservations.paperId],
		references: [papers.id],
	}),
	localConcept: one(compiledLocalConcepts, {
		fields: [conceptObservations.localConceptId],
		references: [compiledLocalConcepts.id],
	}),
}))

export const conceptMeaningRevisionsRelations = relations(
	conceptMeaningRevisions,
	({ one }) => ({
		workspace: one(workspaces, {
			fields: [conceptMeaningRevisions.workspaceId],
			references: [workspaces.id],
		}),
		owner: one(user, {
			fields: [conceptMeaningRevisions.ownerUserId],
			references: [user.id],
		}),
		localConcept: one(compiledLocalConcepts, {
			fields: [conceptMeaningRevisions.localConceptId],
			references: [compiledLocalConcepts.id],
		}),
	}),
)

export type ConceptObservation = typeof conceptObservations.$inferSelect
export type NewConceptObservation = typeof conceptObservations.$inferInsert
export type ConceptMeaningRevision = typeof conceptMeaningRevisions.$inferSelect
export type NewConceptMeaningRevision = typeof conceptMeaningRevisions.$inferInsert
export type WorkspacePaperGraphSnapshot = typeof workspacePaperGraphSnapshots.$inferSelect
export type NewWorkspacePaperGraphSnapshot = typeof workspacePaperGraphSnapshots.$inferInsert
export type WorkspacePaperGraphEdge = typeof workspacePaperGraphEdges.$inferSelect
export type NewWorkspacePaperGraphEdge = typeof workspacePaperGraphEdges.$inferInsert
