import { userCredentials } from "@sapientia/db"
import { eq } from "drizzle-orm"
import { db } from "../db"
import { logger } from "../logger"
import { decrypt, encrypt } from "./crypto"

export type LlmProvider = "anthropic" | "openai"

export interface CredentialsStatus {
	hasMineruToken: boolean
	hasLlmKey: boolean
	llmProvider: LlmProvider | null
}

export async function getCredentialsStatus(userId: string): Promise<CredentialsStatus> {
	const [row] = await db
		.select()
		.from(userCredentials)
		.where(eq(userCredentials.userId, userId))
		.limit(1)

	if (!row) {
		return { hasMineruToken: false, hasLlmKey: false, llmProvider: null }
	}

	return {
		hasMineruToken: row.mineruTokenCiphertext != null,
		hasLlmKey: row.llmApiKeyCiphertext != null,
		llmProvider: row.llmProvider,
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
): Promise<{ provider: LlmProvider; apiKey: string } | null> {
	const [row] = await db
		.select()
		.from(userCredentials)
		.where(eq(userCredentials.userId, userId))
		.limit(1)

	if (!row?.llmApiKeyCiphertext || !row.llmProvider) return null
	return { provider: row.llmProvider, apiKey: decrypt(row.llmApiKeyCiphertext) }
}

export interface CredentialsUpdate {
	mineruToken?: string | null
	llmProvider?: LlmProvider | null
	llmApiKey?: string | null
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

	await db
		.insert(userCredentials)
		.values(dbValues as typeof userCredentials.$inferInsert)
		.onConflictDoUpdate({
			target: userCredentials.userId,
			set: dbValues,
		})

	logger.info({ userId, updated: Object.keys(updates) }, "credentials_updated")
}
