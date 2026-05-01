import { type Job, Worker } from "bullmq"
import { logger } from "../logger"
import { queueConnection } from "../queues/connection"
import {
	type PaperInnerGraphCompileJobData,
	type PaperInnerGraphCompileJobResult,
	PAPER_INNER_GRAPH_COMPILE_QUEUE,
} from "../queues/paper-inner-graph-compile"
import { compilePaperInnerGraph } from "../services/concept-graph"
import { LlmCallError, LlmCredentialMissingError } from "../services/llm-client"

async function processPaperInnerGraphCompile(
	job: Job<PaperInnerGraphCompileJobData, PaperInnerGraphCompileJobResult>,
): Promise<PaperInnerGraphCompileJobResult> {
	const { paperId, userId, workspaceId } = job.data
	const log = logger.child({ jobId: job.id, paperId, workspaceId })

	log.info("paper_inner_graph_compile_job_started")
	const result = await compilePaperInnerGraph({ paperId, userId, workspaceId })
	log.info({ edgeCount: result.edgeCount }, "paper_inner_graph_compile_job_completed")
	return result
}

function isPermanent(err: Error) {
	if (err instanceof LlmCredentialMissingError) return true
	if (err instanceof LlmCallError) return err.permanent
	return false
}

export function createPaperInnerGraphCompileWorker() {
	const worker = new Worker<PaperInnerGraphCompileJobData, PaperInnerGraphCompileJobResult>(
		PAPER_INNER_GRAPH_COMPILE_QUEUE,
		processPaperInnerGraphCompile,
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
		log.error(
			{ err: err.message, attempts: job.attemptsMade, permanent: isPermanent(err) },
			"paper_inner_graph_compile_job_failed",
		)
	})

	worker.on("error", (err) => {
		logger.error({ err: err.message }, "paper_inner_graph_compile_worker_error")
	})

	return worker
}
