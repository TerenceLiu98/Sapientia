import { Queue } from "bullmq"
import { queueConnection } from "./connection"

export const PAPER_METADATA_RETRY_QUEUE = "paper-metadata-retry"
export const PAPER_METADATA_RETRY_JOB_ID = "paper-metadata-retry"
export const PAPER_METADATA_RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface PaperMetadataRetryJobData {
	limit?: number
}

export interface PaperMetadataRetryJobResult {
	scannedLimit: number
	queuedCount: number
}

export const paperMetadataRetryQueue = new Queue<
	PaperMetadataRetryJobData,
	PaperMetadataRetryJobResult
>(PAPER_METADATA_RETRY_QUEUE, {
	connection: queueConnection,
	defaultJobOptions: {
		attempts: 1,
		removeOnComplete: { age: 24 * 3600, count: 100 },
		removeOnFail: { age: 7 * 24 * 3600 },
	},
})

export async function schedulePaperMetadataRetry() {
	await paperMetadataRetryQueue.add(
		PAPER_METADATA_RETRY_JOB_ID,
		{ limit: 100 },
		{
			jobId: PAPER_METADATA_RETRY_JOB_ID,
			repeat: { every: PAPER_METADATA_RETRY_INTERVAL_MS },
		},
	)
}
