import { Queue } from "bullmq"
import { queueConnection } from "./connection"

// TASK-019: enqueued at the end of paper-parse for every successfully
// parsed paper. Worker generates the agent-facing source-summary.
// Single in-flight job per paper id (BullMQ jobId dedup) — re-adds
// during a running job are silently dropped. The worker's idempotency
// check then short-circuits when the persisted summary's
// (model, prompt_version) already match the current canonical pair.
export const PAPER_SUMMARIZE_QUEUE = "paper-summarize"

export interface PaperSummarizeJobData {
	paperId: string
	userId: string
	force?: boolean
}

export interface PaperSummarizeJobResult {
	paperId: string
	status: "done" | "skipped" | "no-credentials"
	generatedAt?: string
}

export const paperSummarizeQueue = new Queue<PaperSummarizeJobData, PaperSummarizeJobResult>(
	PAPER_SUMMARIZE_QUEUE,
	{
		connection: queueConnection,
		defaultJobOptions: {
			attempts: 2,
			backoff: { type: "exponential", delay: 5000 },
			removeOnComplete: { age: 24 * 3600, count: 1000 },
			removeOnFail: { age: 7 * 24 * 3600 },
		},
	},
)

export async function enqueuePaperSummarize(data: PaperSummarizeJobData) {
	const jobId = `paper-summarize-${data.paperId}`
	const existing = await paperSummarizeQueue.getJob(jobId)
	if (existing) {
		const state = await existing.getState()
		if (state === "completed" || state === "failed") {
			await existing.remove()
		} else {
			return existing
		}
	}

	return paperSummarizeQueue.add(`summarize-${data.paperId}`, data, {
		jobId,
	})
}
