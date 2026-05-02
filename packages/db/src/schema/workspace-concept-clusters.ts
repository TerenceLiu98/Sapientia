import { relations, sql } from "drizzle-orm"
import {
	check,
	doublePrecision,
	index,
	integer,
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

export const workspaceConceptClusters = pgTable(
	"workspace_concept_clusters",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		ownerUserId: text("owner_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		kind: text("kind", {
			enum: ["concept", "method", "task", "metric", "dataset", "person", "organization"],
		}).notNull(),
		canonicalName: text("canonical_name").notNull(),
		displayName: text("display_name").notNull(),
		shortDescription: text("short_description"),
		memberCount: integer("member_count").notNull().default(0),
		paperCount: integer("paper_count").notNull().default(0),
		salienceScore: doublePrecision("salience_score").notNull().default(0),
		confidence: doublePrecision("confidence"),
		status: text("status", { enum: ["pending", "running", "done", "failed"] })
			.notNull()
			.default("done"),
		error: text("error"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		deletedAt: timestamp("deleted_at", { withTimezone: true }),
	},
	(table) => [
		unique("workspace_concept_clusters_owner_workspace_kind_name_unq").on(
			table.ownerUserId,
			table.workspaceId,
			table.kind,
			table.canonicalName,
		),
		index("idx_workspace_concept_clusters_workspace_kind").on(table.workspaceId, table.kind),
		index("idx_workspace_concept_clusters_workspace_salience").on(
			table.workspaceId,
			table.salienceScore,
		),
		check(
			"workspace_concept_clusters_status_check",
			sql`${table.status} in ('pending', 'running', 'done', 'failed')`,
		),
		check(
			"workspace_concept_clusters_confidence_check",
			sql`${table.confidence} is null or (${table.confidence} >= 0 and ${table.confidence} <= 1)`,
		),
	],
)

export const workspaceConceptClusterMembers = pgTable(
	"workspace_concept_cluster_members",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		clusterId: uuid("cluster_id")
			.notNull()
			.references(() => workspaceConceptClusters.id, { onDelete: "cascade" }),
		localConceptId: uuid("local_concept_id")
			.notNull()
			.references(() => compiledLocalConcepts.id, { onDelete: "cascade" }),
		paperId: uuid("paper_id")
			.notNull()
			.references(() => papers.id, { onDelete: "cascade" }),
		matchMethod: text("match_method", {
			enum: ["canonical_name", "semantic", "llm", "user_confirmed"],
		})
			.notNull()
			.default("canonical_name"),
		similarityScore: doublePrecision("similarity_score"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		unique("workspace_concept_cluster_members_local_concept_unq").on(table.localConceptId),
		unique("workspace_concept_cluster_members_cluster_local_unq").on(
			table.clusterId,
			table.localConceptId,
		),
		index("idx_workspace_concept_cluster_members_cluster").on(table.clusterId),
		index("idx_workspace_concept_cluster_members_paper").on(table.paperId),
		check(
			"workspace_concept_cluster_members_similarity_check",
			sql`${table.similarityScore} is null or (${table.similarityScore} >= 0 and ${table.similarityScore} <= 1)`,
		),
	],
)

export const workspaceConceptClusterCandidates = pgTable(
	"workspace_concept_cluster_candidates",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		ownerUserId: text("owner_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		sourceLocalConceptId: uuid("source_local_concept_id")
			.notNull()
			.references(() => compiledLocalConcepts.id, { onDelete: "cascade" }),
		targetLocalConceptId: uuid("target_local_concept_id")
			.notNull()
			.references(() => compiledLocalConcepts.id, { onDelete: "cascade" }),
		sourceClusterId: uuid("source_cluster_id").references(() => workspaceConceptClusters.id, {
			onDelete: "cascade",
		}),
		targetClusterId: uuid("target_cluster_id").references(() => workspaceConceptClusters.id, {
			onDelete: "cascade",
		}),
		kind: text("kind", {
			enum: ["concept", "method", "task", "metric", "dataset", "person", "organization"],
		}).notNull(),
		matchMethod: text("match_method", {
			enum: ["lexical_source_description", "embedding", "llm", "user_confirmed"],
		})
			.notNull()
			.default("lexical_source_description"),
		similarityScore: doublePrecision("similarity_score").notNull(),
		llmDecision: text("llm_decision", {
			enum: ["same", "related", "different", "uncertain"],
		}),
		decisionStatus: text("decision_status", {
			enum: [
				"candidate",
				"auto_accepted",
				"needs_review",
				"rejected",
				"user_accepted",
				"user_rejected",
			],
		})
			.notNull()
			.default("candidate"),
		rationale: text("rationale"),
		modelName: text("model_name"),
		promptVersion: text("prompt_version"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		deletedAt: timestamp("deleted_at", { withTimezone: true }),
	},
	(table) => [
		unique("workspace_concept_cluster_candidates_pair_unq").on(
			table.workspaceId,
			table.ownerUserId,
			table.sourceLocalConceptId,
			table.targetLocalConceptId,
		),
		index("idx_workspace_concept_cluster_candidates_workspace").on(
			table.workspaceId,
			table.kind,
			table.decisionStatus,
		),
		index("idx_workspace_concept_cluster_candidates_source_cluster").on(table.sourceClusterId),
		index("idx_workspace_concept_cluster_candidates_target_cluster").on(table.targetClusterId),
		check(
			"workspace_concept_cluster_candidates_similarity_check",
			sql`${table.similarityScore} >= 0 and ${table.similarityScore} <= 1`,
		),
		check(
			"workspace_concept_cluster_candidates_decision_status_check",
			sql`${table.decisionStatus} in ('candidate', 'auto_accepted', 'needs_review', 'rejected', 'user_accepted', 'user_rejected')`,
		),
		check(
			"workspace_concept_cluster_candidates_llm_decision_check",
			sql`${table.llmDecision} is null or ${table.llmDecision} in ('same', 'related', 'different', 'uncertain')`,
		),
	],
)

export const workspaceConceptClustersRelations = relations(
	workspaceConceptClusters,
	({ many, one }) => ({
		workspace: one(workspaces, {
			fields: [workspaceConceptClusters.workspaceId],
			references: [workspaces.id],
		}),
		owner: one(user, {
			fields: [workspaceConceptClusters.ownerUserId],
			references: [user.id],
		}),
		members: many(workspaceConceptClusterMembers),
		sourceCandidates: many(workspaceConceptClusterCandidates, {
			relationName: "sourceClusterCandidates",
		}),
		targetCandidates: many(workspaceConceptClusterCandidates, {
			relationName: "targetClusterCandidates",
		}),
	}),
)

export const workspaceConceptClusterMembersRelations = relations(
	workspaceConceptClusterMembers,
	({ one }) => ({
		cluster: one(workspaceConceptClusters, {
			fields: [workspaceConceptClusterMembers.clusterId],
			references: [workspaceConceptClusters.id],
		}),
		localConcept: one(compiledLocalConcepts, {
			fields: [workspaceConceptClusterMembers.localConceptId],
			references: [compiledLocalConcepts.id],
		}),
		paper: one(papers, {
			fields: [workspaceConceptClusterMembers.paperId],
			references: [papers.id],
		}),
	}),
)

export const workspaceConceptClusterCandidatesRelations = relations(
	workspaceConceptClusterCandidates,
	({ one }) => ({
		workspace: one(workspaces, {
			fields: [workspaceConceptClusterCandidates.workspaceId],
			references: [workspaces.id],
		}),
		owner: one(user, {
			fields: [workspaceConceptClusterCandidates.ownerUserId],
			references: [user.id],
		}),
		sourceLocalConcept: one(compiledLocalConcepts, {
			fields: [workspaceConceptClusterCandidates.sourceLocalConceptId],
			references: [compiledLocalConcepts.id],
		}),
		targetLocalConcept: one(compiledLocalConcepts, {
			fields: [workspaceConceptClusterCandidates.targetLocalConceptId],
			references: [compiledLocalConcepts.id],
		}),
		sourceCluster: one(workspaceConceptClusters, {
			fields: [workspaceConceptClusterCandidates.sourceClusterId],
			references: [workspaceConceptClusters.id],
			relationName: "sourceClusterCandidates",
		}),
		targetCluster: one(workspaceConceptClusters, {
			fields: [workspaceConceptClusterCandidates.targetClusterId],
			references: [workspaceConceptClusters.id],
			relationName: "targetClusterCandidates",
		}),
	}),
)

export type WorkspaceConceptCluster = typeof workspaceConceptClusters.$inferSelect
export type NewWorkspaceConceptCluster = typeof workspaceConceptClusters.$inferInsert
export type WorkspaceConceptClusterMember = typeof workspaceConceptClusterMembers.$inferSelect
export type NewWorkspaceConceptClusterMember = typeof workspaceConceptClusterMembers.$inferInsert
export type WorkspaceConceptClusterCandidate =
	typeof workspaceConceptClusterCandidates.$inferSelect
export type NewWorkspaceConceptClusterCandidate =
	typeof workspaceConceptClusterCandidates.$inferInsert
