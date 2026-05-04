import { type Job, Worker } from "bullmq"
import { logger } from "../logger"
import { queueConnection } from "../queues/connection"
import {
	PAPER_METADATA_RETRY_QUEUE,
	type PaperMetadataRetryJobData,
	type PaperMetadataRetryJobResult,
} from "../queues/paper-metadata-retry"
import { enqueueDueMetadataRetries } from "../services/metadata-retry"

export function createPaperMetadataRetryWorker() {
	return new Worker<PaperMetadataRetryJobData, PaperMetadataRetryJobResult>(
		PAPER_METADATA_RETRY_QUEUE,
		async (job: Job<PaperMetadataRetryJobData, PaperMetadataRetryJobResult>) => {
			const limit = job.data.limit ?? 100
			logger.info({ jobId: job.id, limit }, "paper_metadata_retry_job_started")
			const result = await enqueueDueMetadataRetries({ limit })
			logger.info({ jobId: job.id, ...result }, "paper_metadata_retry_job_completed")
			return result
		},
		{
			connection: queueConnection,
			concurrency: 1,
		},
	)
}
