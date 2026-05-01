import { Queue } from "bullmq"
import { queueConnection } from "./connection"

export const PAPER_INNER_GRAPH_COMPILE_QUEUE = "paper-inner-graph-compile"

export interface PaperInnerGraphCompileJobData {
	paperId: string
	userId: string
	workspaceId: string
}

export interface PaperInnerGraphCompileJobResult {
	paperId: string
	workspaceId: string
	edgeCount: number
}

export const paperInnerGraphCompileQueue = new Queue<
	PaperInnerGraphCompileJobData,
	PaperInnerGraphCompileJobResult
>(PAPER_INNER_GRAPH_COMPILE_QUEUE, {
	connection: queueConnection,
	defaultJobOptions: {
		attempts: 2,
		backoff: { type: "exponential", delay: 5000 },
		removeOnComplete: { age: 24 * 3600, count: 1000 },
		removeOnFail: { age: 7 * 24 * 3600 },
	},
})

export async function enqueuePaperInnerGraphCompile(data: PaperInnerGraphCompileJobData) {
	const jobId = `paper-inner-graph-compile-${data.paperId}-${data.workspaceId}-${data.userId}`
	const existing = await paperInnerGraphCompileQueue.getJob(jobId)
	if (existing) {
		const state = await existing.getState()
		if (state === "completed" || state === "failed") {
			await existing.remove()
		} else {
			return existing
		}
	}

	return paperInnerGraphCompileQueue.add(`inner-graph-compile-${data.paperId}`, data, {
		jobId,
	})
}
