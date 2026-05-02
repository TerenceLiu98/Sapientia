import { compiledLocalConcepts } from "@sapientia/db"
import { and, eq, isNotNull, isNull } from "drizzle-orm"
import { db } from "../db"
import {
	enqueueWorkspaceSemanticRefresh,
	type WorkspaceSemanticRefreshJobData,
	type WorkspaceSemanticRefreshJobResult,
} from "../queues/workspace-semantic-refresh"
import {
	compileWorkspaceConceptEmbeddings,
	EmbeddingCredentialMissingError,
} from "./concept-embeddings"
import { judgeWorkspaceSemanticCandidates } from "./semantic-candidate-judgement"
import { LlmCredentialMissingError } from "./llm-client"
import { compileWorkspaceConceptClusterCandidates } from "./workspace-concept-cluster-candidates"

export async function refreshWorkspaceSemanticLayer(
	args: WorkspaceSemanticRefreshJobData,
): Promise<WorkspaceSemanticRefreshJobResult> {
	let embeddedConceptCount = 0
	let skippedConceptCount = 0
	let embeddingSkippedReason: WorkspaceSemanticRefreshJobResult["embeddingSkippedReason"] = "none"
	let judgedCandidateCount = 0
	let judgementSkippedReason: WorkspaceSemanticRefreshJobResult["judgementSkippedReason"] = "none"

	try {
		const embeddingResult = await compileWorkspaceConceptEmbeddings({
			workspaceId: args.workspaceId,
			userId: args.userId,
			force: args.forceEmbeddings,
		})
		embeddedConceptCount = embeddingResult.embeddedConceptCount
		skippedConceptCount = embeddingResult.skippedConceptCount
	} catch (error) {
		if (error instanceof EmbeddingCredentialMissingError) {
			embeddingSkippedReason = "missing-credentials"
		} else {
			embeddingSkippedReason = "failed"
			throw error
		}
	}

	const candidateResult = await compileWorkspaceConceptClusterCandidates({
		workspaceId: args.workspaceId,
		userId: args.userId,
	})
	if (candidateResult.candidateCount > 0) {
		try {
			const judgementResult = await judgeWorkspaceSemanticCandidates({
				workspaceId: args.workspaceId,
				userId: args.userId,
			})
			judgedCandidateCount = judgementResult.judgedCount
		} catch (error) {
			if (error instanceof LlmCredentialMissingError) {
				judgementSkippedReason = "missing-credentials"
			} else {
				judgementSkippedReason = "failed"
				throw error
			}
		}
	}

	return {
		workspaceId: args.workspaceId,
		embeddedConceptCount,
		skippedConceptCount,
		candidateCount: candidateResult.candidateCount,
		judgedCandidateCount,
		judgementSkippedReason,
		embeddingSkippedReason,
	}
}

export async function enqueueWorkspaceSemanticRefreshesForUser(args: {
	userId: string
	forceEmbeddings?: boolean
	reason?: WorkspaceSemanticRefreshJobData["reason"]
}) {
	const rows = await db
		.select({ workspaceId: compiledLocalConcepts.workspaceId })
		.from(compiledLocalConcepts)
		.where(
			and(
				eq(compiledLocalConcepts.ownerUserId, args.userId),
				eq(compiledLocalConcepts.sourceLevelDescriptionStatus, "done"),
				isNotNull(compiledLocalConcepts.sourceLevelDescription),
				isNull(compiledLocalConcepts.deletedAt),
			),
		)
		.groupBy(compiledLocalConcepts.workspaceId)

	for (const row of rows) {
		await enqueueWorkspaceSemanticRefresh({
			workspaceId: row.workspaceId,
			userId: args.userId,
			forceEmbeddings: args.forceEmbeddings,
			reason: args.reason,
		})
	}

	return { queuedCount: rows.length }
}

export function touchesEmbeddingCredentials(updates: {
	embeddingProvider?: unknown
	embeddingApiKey?: unknown
	embeddingBaseUrl?: unknown
	embeddingModel?: unknown
}) {
	return (
		updates.embeddingProvider !== undefined ||
		updates.embeddingApiKey !== undefined ||
		updates.embeddingBaseUrl !== undefined ||
		updates.embeddingModel !== undefined
	)
}
