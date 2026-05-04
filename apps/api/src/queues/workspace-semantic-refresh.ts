import { Queue } from "bullmq"
import { queueConnection } from "./connection"

export const WORKSPACE_SEMANTIC_REFRESH_QUEUE = "workspace-semantic-refresh"

export interface WorkspaceSemanticRefreshJobData {
	workspaceId: string
	userId: string
	forceEmbeddings?: boolean
	reason?:
		| "paper-concept-description"
		| "credentials-updated"
		| "manual"
		| "backfill"
		| "reader-note-concept"
}

export interface WorkspaceSemanticRefreshJobResult {
	workspaceId: string
	embeddedConceptCount: number
	skippedConceptCount: number
	candidateCount: number
	judgedCandidateCount: number
	judgementSkippedReason: "none" | "missing-credentials" | "failed"
	embeddingSkippedReason: "none" | "missing-credentials" | "failed"
}

export const workspaceSemanticRefreshQueue = new Queue<
	WorkspaceSemanticRefreshJobData,
	WorkspaceSemanticRefreshJobResult
>(WORKSPACE_SEMANTIC_REFRESH_QUEUE, {
	connection: queueConnection,
	defaultJobOptions: {
		attempts: 2,
		backoff: { type: "exponential", delay: 5000 },
		removeOnComplete: { age: 24 * 3600, count: 1000 },
		removeOnFail: { age: 7 * 24 * 3600 },
	},
})

export async function enqueueWorkspaceSemanticRefresh(data: WorkspaceSemanticRefreshJobData) {
	const jobId = `workspace-semantic-refresh-${data.workspaceId}-${data.userId}`
	const existing = await workspaceSemanticRefreshQueue.getJob(jobId)
	if (existing) {
		const state = await existing.getState()
		if (state === "completed" || state === "failed") {
			await existing.remove()
		} else {
			return existing
		}
	}

	return workspaceSemanticRefreshQueue.add(`semantic-refresh-${data.workspaceId}`, data, {
		jobId,
	})
}
