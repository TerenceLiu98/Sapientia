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

	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export type UserCredentials = typeof userCredentials.$inferSelect
export type NewUserCredentials = typeof userCredentials.$inferInsert
