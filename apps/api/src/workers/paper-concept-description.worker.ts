import { type Job, Worker } from "bullmq"
import { logger } from "../logger"
import { queueConnection } from "../queues/connection"
import {
	PAPER_CONCEPT_DESCRIPTION_QUEUE,
	type PaperConceptDescriptionJobData,
	type PaperConceptDescriptionJobResult,
} from "../queues/paper-concept-description"
import { enqueueWorkspaceSemanticRefresh } from "../queues/workspace-semantic-refresh"
import { compilePaperConceptDescriptions } from "../services/concept-description"

async function processPaperConceptDescription(
	job: Job<PaperConceptDescriptionJobData, PaperConceptDescriptionJobResult>,
): Promise<PaperConceptDescriptionJobResult> {
	const { paperId, userId, workspaceId, force } = job.data
	const log = logger.child({ jobId: job.id, paperId, workspaceId })

	log.info({ reason: job.data.reason, force }, "paper_concept_description_job_started")
	const result = await compilePaperConceptDescriptions({ paperId, userId, workspaceId, force })
	const semanticRefreshJob = await enqueueWorkspaceSemanticRefresh({
		workspaceId,
		userId,
		forceEmbeddings: force,
		reason: "paper-concept-description",
	})
	log.info(
		{
			describedConceptCount: result.describedConceptCount,
			skippedConceptCount: result.skippedConceptCount,
			failedConceptCount: result.failedConceptCount,
			readerSignalConceptCount: result.readerSignalConceptCount,
			semanticRefreshJobId: semanticRefreshJob.id,
		},
		"paper_concept_description_job_completed",
	)
	return result
}

export function createPaperConceptDescriptionWorker() {
	const worker = new Worker<PaperConceptDescriptionJobData, PaperConceptDescriptionJobResult>(
		PAPER_CONCEPT_DESCRIPTION_QUEUE,
		processPaperConceptDescription,
		{
			connection: queueConnection,
			concurrency: 4,
		},
	)

	worker.on("failed", async (job, err) => {
		if (!job) return
		const log = logger.child({
			jobId: job.id,
			paperId: job.data.paperId,
			workspaceId: job.data.workspaceId,
		})
		log.error({ err: err.message, attempts: job.attemptsMade }, "paper_concept_description_job_failed")
	})

	worker.on("error", (err) => {
		logger.error({ err: err.message }, "paper_concept_description_worker_error")
	})

	return worker
}
