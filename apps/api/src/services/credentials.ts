import { userCredentials } from "@sapientia/db"
import { eq } from "drizzle-orm"
import { db } from "../db"
import { logger } from "../logger"
import { decrypt, encrypt } from "./crypto"

export type LlmProvider = "anthropic" | "openai"
export type EmbeddingProvider = "openai-compatible" | "local"

export interface CredentialsStatus {
	hasMineruToken: boolean
	hasLlmKey: boolean
	llmProvider: LlmProvider | null
	llmBaseUrl: string | null
	llmModel: string | null
	hasEmbeddingKey: boolean
	embeddingProvider: EmbeddingProvider | null
	embeddingBaseUrl: string | null
	embeddingModel: string | null
	hasSemanticScholarKey: boolean
}

export async function getCredentialsStatus(userId: string): Promise<CredentialsStatus> {
	const [row] = await db
		.select()
		.from(userCredentials)
		.where(eq(userCredentials.userId, userId))
		.limit(1)

	if (!row) {
		return {
			hasMineruToken: false,
			hasLlmKey: false,
			llmProvider: null,
			llmBaseUrl: null,
			llmModel: null,
			hasEmbeddingKey: false,
			embeddingProvider: null,
			embeddingBaseUrl: null,
			embeddingModel: null,
			hasSemanticScholarKey: false,
		}
	}

	return {
		hasMineruToken: row.mineruTokenCiphertext != null,
		hasLlmKey: row.llmApiKeyCiphertext != null,
		llmProvider: row.llmProvider,
		llmBaseUrl: row.llmBaseUrl ?? null,
		llmModel: row.llmModel?.trim() ? row.llmModel.trim() : null,
		hasEmbeddingKey: row.embeddingProvider === "local" || row.embeddingApiKeyCiphertext != null,
		embeddingProvider: row.embeddingProvider,
		embeddingBaseUrl: row.embeddingBaseUrl ?? null,
		embeddingModel: row.embeddingModel?.trim() ? row.embeddingModel.trim() : null,
		hasSemanticScholarKey: row.semanticScholarApiKeyCiphertext != null,
	}
}

export async function getMineruToken(userId: string): Promise<string | null> {
	const [row] = await db
		.select()
		.from(userCredentials)
		.where(eq(userCredentials.userId, userId))
		.limit(1)

	if (!row?.mineruTokenCiphertext) return null
	return decrypt(row.mineruTokenCiphertext)
}

export async function getLlmCredential(
	userId: string,
): Promise<{ provider: LlmProvider; apiKey: string; baseURL: string | null; model: string } | null> {
	const [row] = await db
		.select()
		.from(userCredentials)
		.where(eq(userCredentials.userId, userId))
		.limit(1)

	const model = row?.llmModel?.trim()
	if (!row?.llmApiKeyCiphertext || !row.llmProvider || !model) return null
	return {
		provider: row.llmProvider,
		apiKey: decrypt(row.llmApiKeyCiphertext),
		baseURL: row.llmBaseUrl?.trim() ? row.llmBaseUrl.trim() : null,
		model,
	}
}

export async function getEmbeddingCredential(
	userId: string,
): Promise<{
	provider: EmbeddingProvider
	apiKey: string | null
	baseURL: string | null
	model: string
} | null> {
	const [row] = await db
		.select()
		.from(userCredentials)
		.where(eq(userCredentials.userId, userId))
		.limit(1)

	const model = row?.embeddingModel?.trim()
	if (!row?.embeddingProvider || !model) return null
	if (row.embeddingProvider === "openai-compatible" && !row.embeddingApiKeyCiphertext) return null
	return {
		provider: row.embeddingProvider,
		apiKey: row.embeddingApiKeyCiphertext ? decrypt(row.embeddingApiKeyCiphertext) : null,
		baseURL: row.embeddingBaseUrl?.trim() ? row.embeddingBaseUrl.trim() : null,
		model,
	}
}

export async function getSemanticScholarApiKey(userId: string): Promise<string | null> {
	const [row] = await db
		.select()
		.from(userCredentials)
		.where(eq(userCredentials.userId, userId))
		.limit(1)

	if (!row?.semanticScholarApiKeyCiphertext) return null
	return decrypt(row.semanticScholarApiKeyCiphertext)
}

export interface CredentialsUpdate {
	mineruToken?: string | null
	llmProvider?: LlmProvider | null
	llmApiKey?: string | null
	llmBaseUrl?: string | null
	llmModel?: string | null
	embeddingProvider?: EmbeddingProvider | null
	embeddingApiKey?: string | null
	embeddingBaseUrl?: string | null
	embeddingModel?: string | null
	semanticScholarApiKey?: string | null
}

export async function updateCredentials(userId: string, updates: CredentialsUpdate) {
	const dbValues: Partial<typeof userCredentials.$inferInsert> = {
		userId,
		updatedAt: new Date(),
	}

	if (updates.mineruToken !== undefined) {
		dbValues.mineruTokenCiphertext = updates.mineruToken ? encrypt(updates.mineruToken) : null
	}
	if (updates.llmProvider !== undefined) {
		dbValues.llmProvider = updates.llmProvider
	}
	if (updates.llmApiKey !== undefined) {
		dbValues.llmApiKeyCiphertext = updates.llmApiKey ? encrypt(updates.llmApiKey) : null
	}
	if (updates.llmBaseUrl !== undefined) {
		dbValues.llmBaseUrl = updates.llmBaseUrl?.trim() ? updates.llmBaseUrl.trim() : null
	}
	if (updates.llmModel !== undefined) {
		dbValues.llmModel = updates.llmModel?.trim() ? updates.llmModel.trim() : null
	}
	if (updates.embeddingProvider !== undefined) {
		dbValues.embeddingProvider = updates.embeddingProvider
	}
	if (updates.embeddingApiKey !== undefined) {
		dbValues.embeddingApiKeyCiphertext = updates.embeddingApiKey
			? encrypt(updates.embeddingApiKey)
			: null
	}
	if (updates.embeddingBaseUrl !== undefined) {
		dbValues.embeddingBaseUrl = updates.embeddingBaseUrl?.trim()
			? updates.embeddingBaseUrl.trim()
			: null
	}
	if (updates.embeddingModel !== undefined) {
		dbValues.embeddingModel = updates.embeddingModel?.trim()
			? updates.embeddingModel.trim()
			: null
	}
	if (updates.semanticScholarApiKey !== undefined) {
		dbValues.semanticScholarApiKeyCiphertext = updates.semanticScholarApiKey
			? encrypt(updates.semanticScholarApiKey)
			: null
	}

	await db
		.insert(userCredentials)
		.values(dbValues as typeof userCredentials.$inferInsert)
		.onConflictDoUpdate({
			target: userCredentials.userId,
			set: dbValues,
		})

	logger.info({ userId, updated: Object.keys(updates) }, "credentials_updated")
}
