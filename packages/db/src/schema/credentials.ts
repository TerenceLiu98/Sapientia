import { customType, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { user } from "./auth"

const bytea = customType<{ data: Buffer; default: false }>({
	dataType() {
		return "bytea"
	},
})

export const userCredentials = pgTable("user_credentials", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),

	// AES-256-GCM envelope ciphertext for the user's MinerU API token.
	mineruTokenCiphertext: bytea("mineru_token_ciphertext"),

	// LLM provider + envelope-encrypted API key.
	llmProvider: text("llm_provider", { enum: ["anthropic", "openai"] }),
	llmApiKeyCiphertext: bytea("llm_api_key_ciphertext"),
	llmBaseUrl: text("llm_base_url"),
	llmModel: text("llm_model"),

	// Embedding provider is configured separately from chat/agent LLMs.
	embeddingProvider: text("embedding_provider", { enum: ["openai-compatible", "local"] }),
	embeddingApiKeyCiphertext: bytea("embedding_api_key_ciphertext"),
	embeddingBaseUrl: text("embedding_base_url"),
	embeddingModel: text("embedding_model"),

	// Metadata providers. Semantic Scholar supports optional x-api-key auth
	// to avoid the shared unauthenticated throttle.
	semanticScholarApiKeyCiphertext: bytea("semantic_scholar_api_key_ciphertext"),

	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export type UserCredentials = typeof userCredentials.$inferSelect
export type NewUserCredentials = typeof userCredentials.$inferInsert
