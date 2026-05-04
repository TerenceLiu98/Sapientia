import { Queue } from "bullmq"
import { queueConnection } from "./connection"

export const PAPER_CONCEPT_DESCRIPTION_QUEUE = "paper-concept-description"

export interface PaperConceptDescriptionJobData {
	paperId: string
	userId: string
	workspaceId: string
	force?: boolean
	reason?: "paper-compile" | "evidence-changed" | "semantic-dirty" | "manual" | "reader-note-concept"
}

export interface PaperConceptDescriptionJobResult {
	paperId: string
	workspaceId: string
	describedConceptCount: number
	skippedConceptCount: number
	failedConceptCount: number
	readerSignalConceptCount: number
}

export const paperConceptDescriptionQueue = new Queue<
	PaperConceptDescriptionJobData,
	PaperConceptDescriptionJobResult
>(PAPER_CONCEPT_DESCRIPTION_QUEUE, {
	connection: queueConnection,
	defaultJobOptions: {
		attempts: 2,
		backoff: { type: "exponential", delay: 5000 },
		removeOnComplete: { age: 24 * 3600, count: 1000 },
		removeOnFail: { age: 7 * 24 * 3600 },
	},
})

export async function enqueuePaperConceptDescription(data: PaperConceptDescriptionJobData) {
	const jobId = `paper-concept-description-${data.paperId}-${data.workspaceId}-${data.userId}`
	const existing = await paperConceptDescriptionQueue.getJob(jobId)
	if (existing) {
		const state = await existing.getState()
		if (state === "completed" || state === "failed") {
			await existing.remove()
		} else {
			return existing
		}
	}

	return paperConceptDescriptionQueue.add(`concept-description-${data.paperId}`, data, {
		jobId,
	})
}
