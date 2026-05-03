import { type Job, Worker } from "bullmq"
import { logger } from "../logger"
import { queueConnection } from "../queues/connection"
import {
	PAPER_CONCEPT_REFINE_QUEUE,
	type PaperConceptRefineJobData,
	type PaperConceptRefineJobResult,
} from "../queues/paper-concept-refine"
import { refreshPaperConceptReaderSignals } from "../services/concept-description"
import { refinePaperConceptSalience } from "../services/concept-refine"

export async function processPaperConceptRefine(
	job: Job<PaperConceptRefineJobData, PaperConceptRefineJobResult>,
): Promise<PaperConceptRefineJobResult> {
	const { paperId, userId, workspaceId } = job.data
	const log = logger.child({ jobId: job.id, paperId, workspaceId })

	log.info("paper_concept_refine_job_started")
	const result = await refinePaperConceptSalience({ paperId, userId, workspaceId })
	const readerSignalResult = await refreshPaperConceptReaderSignals({ paperId, userId, workspaceId })
	log.info(
		{
			refinedConceptCount: result.refinedConceptCount,
			readerSignalConceptCount: readerSignalResult.readerSignalConceptCount,
		},
		"paper_concept_refine_job_completed",
	)
	return {
		...result,
		readerSignalConceptCount: readerSignalResult.readerSignalConceptCount,
	}
}

export function createPaperConceptRefineWorker() {
	const worker = new Worker<PaperConceptRefineJobData, PaperConceptRefineJobResult>(
		PAPER_CONCEPT_REFINE_QUEUE,
		processPaperConceptRefine,
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
		log.error({ err: err.message, attempts: job.attemptsMade }, "paper_concept_refine_job_failed")
	})

	worker.on("error", (err) => {
		logger.error({ err: err.message }, "paper_concept_refine_worker_error")
	})

	return worker
}
