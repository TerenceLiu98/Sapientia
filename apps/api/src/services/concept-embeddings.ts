import { createHash } from "node:crypto"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import {
	compiledLocalConceptEmbeddings,
	compiledLocalConcepts,
	papers,
} from "@sapientia/db"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import { embedMany } from "ai"
import { db } from "../db"
import { logger } from "../logger"
import { getEmbeddingCredential, type EmbeddingProvider } from "./credentials"

export const CONCEPT_EMBEDDING_INPUT_VERSION = "concept-embedding-input-v1"

const DEFAULT_OPENAI_EMBEDDING_BASE_URL =
	process.env.OPENAI_EMBEDDING_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"
const DEFAULT_LOCAL_EMBEDDING_BASE_URL =
	process.env.LOCAL_EMBEDDING_BASE_URL ?? "http://localhost:11434/v1"
const EMBEDDING_BATCH_SIZE = 64
const GRAPH_EMBEDDING_KINDS = new Set(["concept", "method", "task", "metric"])

type ConceptForEmbedding = {
	id: string
	workspaceId: string
	ownerUserId: string
	paperId: string
	paperTitle: string | null
	kind: string
	canonicalName: string
	displayName: string
	sourceLevelDescription: string | null
}

type EmbeddingCredential = {
	provider: EmbeddingProvider
	apiKey: string | null
	baseURL: string | null
	model: string
}

export class EmbeddingCredentialMissingError extends Error {
	constructor() {
		super("No embedding backend configured for this user. See Settings.")
		this.name = "EmbeddingCredentialMissingError"
	}
}

export async function compileWorkspaceConceptEmbeddings(args: {
	workspaceId: string
	userId: string
	force?: boolean
	limit?: number
}) {
	const { workspaceId, userId, force = false } = args
	const credential = await getEmbeddingCredential(userId)
	if (!credential) throw new EmbeddingCredentialMissingError()

	const concepts = await loadConceptsForEmbedding({ workspaceId, userId })
	const limitedConcepts =
		args.limit && args.limit > 0 ? concepts.slice(0, args.limit) : concepts
	const inputs = limitedConcepts.map((concept) => ({
		concept,
		text: buildConceptEmbeddingInput(concept),
	}))
	const hashedInputs = inputs.map((input) => ({
		...input,
		inputHash: hashText(input.text),
	}))

	const existing =
		hashedInputs.length === 0
			? []
			: await db
					.select({
						localConceptId: compiledLocalConceptEmbeddings.localConceptId,
						inputHash: compiledLocalConceptEmbeddings.inputHash,
					})
					.from(compiledLocalConceptEmbeddings)
					.where(
						and(
							eq(compiledLocalConceptEmbeddings.workspaceId, workspaceId),
							eq(compiledLocalConceptEmbeddings.ownerUserId, userId),
							eq(compiledLocalConceptEmbeddings.embeddingProvider, credential.provider),
							eq(compiledLocalConceptEmbeddings.embeddingModel, credential.model),
							isNull(compiledLocalConceptEmbeddings.deletedAt),
							inArray(
								compiledLocalConceptEmbeddings.localConceptId,
								hashedInputs.map((input) => input.concept.id),
							),
						),
					)
	const existingInputHashByConceptId = new Map(
		existing.map((row) => [row.localConceptId, row.inputHash] as const),
	)
	const eligibleInputs = hashedInputs.filter(
		(input) =>
			force || existingInputHashByConceptId.get(input.concept.id) !== input.inputHash,
	)

	let embeddedConceptCount = 0
	for (const batch of chunk(eligibleInputs, EMBEDDING_BATCH_SIZE)) {
		const embeddings = await embedTexts({
			credential,
			values: batch.map((input) => input.text),
		})
		for (let index = 0; index < batch.length; index += 1) {
			const input = batch[index]
			const embedding = embeddings[index]
			if (!embedding) continue
			await upsertConceptEmbedding({
				concept: input.concept,
				credential,
				inputHash: input.inputHash,
				embedding,
			})
			embeddedConceptCount += 1
		}
	}

	logger.info(
		{
			userId,
			workspaceId,
			provider: credential.provider,
			model: credential.model,
			conceptCount: limitedConcepts.length,
			embeddedConceptCount,
			skippedConceptCount: limitedConcepts.length - embeddedConceptCount,
		},
		"concept_embeddings_compiled",
	)

	return {
		workspaceId,
		conceptCount: limitedConcepts.length,
		embeddedConceptCount,
		skippedConceptCount: limitedConcepts.length - embeddedConceptCount,
		provider: credential.provider,
		model: credential.model,
	}
}

export function buildConceptEmbeddingInput(concept: ConceptForEmbedding) {
	return [
		`Kind: ${concept.kind}`,
		`Name: ${concept.displayName}`,
		`Canonical name: ${concept.canonicalName}`,
		concept.paperTitle ? `Paper: ${concept.paperTitle}` : null,
		`Paper-specific meaning: ${concept.sourceLevelDescription ?? ""}`,
	]
		.filter(Boolean)
		.join("\n")
}

export function hashText(text: string) {
	return createHash("sha256").update(text).digest("hex")
}

async function loadConceptsForEmbedding(args: { workspaceId: string; userId: string }) {
	const rows = await db
		.select({
			id: compiledLocalConcepts.id,
			workspaceId: compiledLocalConcepts.workspaceId,
			ownerUserId: compiledLocalConcepts.ownerUserId,
			paperId: compiledLocalConcepts.paperId,
			paperTitle: papers.title,
			kind: compiledLocalConcepts.kind,
			canonicalName: compiledLocalConcepts.canonicalName,
			displayName: compiledLocalConcepts.displayName,
			sourceLevelDescription: compiledLocalConcepts.sourceLevelDescription,
		})
		.from(compiledLocalConcepts)
		.innerJoin(papers, eq(papers.id, compiledLocalConcepts.paperId))
		.where(
			and(
				eq(compiledLocalConcepts.workspaceId, args.workspaceId),
				eq(compiledLocalConcepts.ownerUserId, args.userId),
				eq(compiledLocalConcepts.sourceLevelDescriptionStatus, "done"),
				isNull(compiledLocalConcepts.deletedAt),
				isNull(papers.deletedAt),
			),
		)
	return rows.filter(
		(row) => GRAPH_EMBEDDING_KINDS.has(row.kind) && row.sourceLevelDescription?.trim(),
	)
}

async function embedTexts(args: {
	credential: EmbeddingCredential
	values: string[]
}) {
	const provider = createOpenAICompatible({
		name: `sapientia-${args.credential.provider}-embedding`,
		apiKey: args.credential.apiKey ?? undefined,
		baseURL: normalizeEmbeddingBaseUrlForProvider(args.credential),
	})
	const result = await embedMany({
		model: provider.textEmbeddingModel(args.credential.model),
		values: args.values,
		maxRetries: 0,
	})
	return result.embeddings
}

export function normalizeEmbeddingBaseUrlForProvider(credential: EmbeddingCredential) {
	const fallback =
		credential.provider === "local"
			? DEFAULT_LOCAL_EMBEDDING_BASE_URL
			: DEFAULT_OPENAI_EMBEDDING_BASE_URL
	const value = credential.baseURL?.trim() || fallback
	const url = new URL(value)
	const normalized = url.toString().replace(/\/$/, "")
	return normalized.endsWith("/embeddings")
		? normalized.slice(0, -"/embeddings".length)
		: normalized
}

async function upsertConceptEmbedding(args: {
	concept: ConceptForEmbedding
	credential: EmbeddingCredential
	inputHash: string
	embedding: number[]
}) {
	const vectorLiteral = toVectorLiteral(args.embedding)
	await db.execute(sql`
		insert into compiled_local_concept_embeddings (
			workspace_id,
			owner_user_id,
			local_concept_id,
			embedding_provider,
			embedding_model,
			dimensions,
			input_hash,
			input_text_version,
			embedding,
			updated_at,
			deleted_at
		)
		values (
			${args.concept.workspaceId},
			${args.concept.ownerUserId},
			${args.concept.id},
			${args.credential.provider},
			${args.credential.model},
			${args.embedding.length},
			${args.inputHash},
			${CONCEPT_EMBEDDING_INPUT_VERSION},
			${vectorLiteral}::vector,
			now(),
			null
		)
		on conflict (local_concept_id, embedding_provider, embedding_model, input_hash)
		do update set
			dimensions = excluded.dimensions,
			input_text_version = excluded.input_text_version,
			embedding = excluded.embedding,
			updated_at = now(),
			deleted_at = null
	`)
}

function toVectorLiteral(values: number[]) {
	if (values.length === 0) throw new Error("embedding vector is empty")
	return `[${values.map((value) => Number(value).toString()).join(",")}]`
}

function chunk<T>(items: T[], size: number) {
	const chunks: T[][] = []
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size))
	}
	return chunks
}
