import { Queue } from "bullmq"
import { queueConnection } from "./connection"

export const PAPER_CONCEPT_REFINE_QUEUE = "paper-concept-refine"

export interface PaperConceptRefineJobData {
	paperId: string
	userId: string
	workspaceId: string
}

export interface PaperConceptRefineJobResult {
	paperId: string
	workspaceId: string
	refinedConceptCount: number
}

export const paperConceptRefineQueue = new Queue<
	PaperConceptRefineJobData,
	PaperConceptRefineJobResult
>(PAPER_CONCEPT_REFINE_QUEUE, {
	connection: queueConnection,
	defaultJobOptions: {
		attempts: 2,
		backoff: { type: "exponential", delay: 5000 },
		removeOnComplete: { age: 24 * 3600, count: 1000 },
		removeOnFail: { age: 7 * 24 * 3600 },
	},
})

export async function enqueuePaperConceptRefine(data: PaperConceptRefineJobData) {
	const jobId = `paper-concept-refine-${data.paperId}-${data.workspaceId}-${data.userId}`
	const existing = await paperConceptRefineQueue.getJob(jobId)
	if (existing) {
		const state = await existing.getState()
		if (state === "completed" || state === "failed") {
			await existing.remove()
		} else {
			return existing
		}
	}

	return paperConceptRefineQueue.add(`concept-refine-${data.paperId}`, data, {
		jobId,
	})
}
