import { type Job, Worker } from "bullmq"
import { logger } from "../logger"
import { queueConnection } from "../queues/connection"
import {
	PAPER_CONCEPT_DESCRIPTION_QUEUE,
	type PaperConceptDescriptionJobData,
	type PaperConceptDescriptionJobResult,
} from "../queues/paper-concept-description"
import { compilePaperConceptDescriptions } from "../services/concept-description"
import {
	compileWorkspaceConceptEmbeddings,
	EmbeddingCredentialMissingError,
} from "../services/concept-embeddings"
import { compileWorkspaceConceptClusterCandidates } from "../services/workspace-concept-cluster-candidates"

async function processPaperConceptDescription(
	job: Job<PaperConceptDescriptionJobData, PaperConceptDescriptionJobResult>,
): Promise<PaperConceptDescriptionJobResult> {
	const { paperId, userId, workspaceId, force } = job.data
	const log = logger.child({ jobId: job.id, paperId, workspaceId })

	log.info({ reason: job.data.reason, force }, "paper_concept_description_job_started")
	const result = await compilePaperConceptDescriptions({ paperId, userId, workspaceId, force })
	let embeddedConceptCount = 0
	try {
		const embeddingResult = await compileWorkspaceConceptEmbeddings({
			workspaceId,
			userId,
			force,
		})
		embeddedConceptCount = embeddingResult.embeddedConceptCount
	} catch (error) {
		if (error instanceof EmbeddingCredentialMissingError) {
			log.info("paper_concept_description_embedding_skipped_no_credentials")
		} else {
			log.warn(
				{ err: error instanceof Error ? error.message : "embedding generation failed" },
				"paper_concept_description_embedding_failed",
			)
		}
	}
	const candidateResult = await compileWorkspaceConceptClusterCandidates({ workspaceId, userId })
	log.info(
		{
			describedConceptCount: result.describedConceptCount,
			skippedConceptCount: result.skippedConceptCount,
			failedConceptCount: result.failedConceptCount,
			readerSignalConceptCount: result.readerSignalConceptCount,
			embeddedConceptCount,
			candidateCount: candidateResult.candidateCount,
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
