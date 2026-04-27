import { Queue } from "bullmq"
import { queueConnection } from "./connection"

export const PAPER_ENRICH_QUEUE = "paper-enrich"

export interface PaperEnrichJobData {
	paperId: string
	userId: string
}

export interface PaperEnrichJobResult {
	paperId: string
	status: "enriched" | "partial" | "failed" | "skipped"
	sources: string[]
}

export const paperEnrichQueue = new Queue<PaperEnrichJobData, PaperEnrichJobResult>(
	PAPER_ENRICH_QUEUE,
	{
		connection: queueConnection,
		defaultJobOptions: {
			attempts: 2,
			backoff: { type: "exponential", delay: 30_000 },
			removeOnComplete: { age: 24 * 3600, count: 1000 },
			removeOnFail: { age: 7 * 24 * 3600 },
		},
	},
)

export async function enqueuePaperEnrich(data: PaperEnrichJobData) {
	return paperEnrichQueue.add(`enrich-${data.paperId}`, data, {
		jobId: `paper-enrich-${data.paperId}`,
	})
}
