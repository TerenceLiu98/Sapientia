import { relations, sql } from "drizzle-orm"
import { check, customType, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { user } from "./auth"
import { compiledLocalConcepts } from "./compiled-local-concepts"
import { workspaces } from "./workspaces"

const vector = customType<{ data: string; driverData: string }>({
	dataType() {
		return "vector"
	},
})

export const compiledLocalConceptEmbeddings = pgTable(
	"compiled_local_concept_embeddings",
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
		embeddingProvider: text("embedding_provider", {
			enum: ["openai-compatible", "local"],
		}).notNull(),
		embeddingModel: text("embedding_model").notNull(),
		dimensions: integer("dimensions").notNull(),
		inputHash: text("input_hash").notNull(),
		inputTextVersion: text("input_text_version").notNull(),
		embedding: vector("embedding").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		deletedAt: timestamp("deleted_at", { withTimezone: true }),
	},
	(table) => [
		unique("compiled_local_concept_embeddings_model_input_unq").on(
			table.localConceptId,
			table.embeddingProvider,
			table.embeddingModel,
			table.inputHash,
		),
		index("idx_compiled_local_concept_embeddings_workspace").on(
			table.workspaceId,
			table.ownerUserId,
			table.embeddingProvider,
			table.embeddingModel,
		),
		index("idx_compiled_local_concept_embeddings_local_concept").on(table.localConceptId),
		check("compiled_local_concept_embeddings_dimensions_check", sql`${table.dimensions} > 0`),
	],
)

export const compiledLocalConceptEmbeddingsRelations = relations(
	compiledLocalConceptEmbeddings,
	({ one }) => ({
		workspace: one(workspaces, {
			fields: [compiledLocalConceptEmbeddings.workspaceId],
			references: [workspaces.id],
		}),
		owner: one(user, {
			fields: [compiledLocalConceptEmbeddings.ownerUserId],
			references: [user.id],
		}),
		localConcept: one(compiledLocalConcepts, {
			fields: [compiledLocalConceptEmbeddings.localConceptId],
			references: [compiledLocalConcepts.id],
		}),
	}),
)

export type CompiledLocalConceptEmbedding =
	typeof compiledLocalConceptEmbeddings.$inferSelect
export type NewCompiledLocalConceptEmbedding =
	typeof compiledLocalConceptEmbeddings.$inferInsert
