import { type Job, Worker } from "bullmq"
import { logger } from "../logger"
import { queueConnection } from "../queues/connection"
import {
	WORKSPACE_SEMANTIC_REFRESH_QUEUE,
	type WorkspaceSemanticRefreshJobData,
	type WorkspaceSemanticRefreshJobResult,
} from "../queues/workspace-semantic-refresh"
import { refreshWorkspaceSemanticLayer } from "../services/workspace-semantic-refresh"

async function processWorkspaceSemanticRefresh(
	job: Job<WorkspaceSemanticRefreshJobData, WorkspaceSemanticRefreshJobResult>,
): Promise<WorkspaceSemanticRefreshJobResult> {
	const { workspaceId, userId } = job.data
	const log = logger.child({ jobId: job.id, workspaceId, userId })

	log.info(
		{ reason: job.data.reason, forceEmbeddings: job.data.forceEmbeddings },
		"workspace_semantic_refresh_job_started",
	)
	const result = await refreshWorkspaceSemanticLayer(job.data)
	log.info(result, "workspace_semantic_refresh_job_completed")
	return result
}

export function createWorkspaceSemanticRefreshWorker() {
	const worker = new Worker<WorkspaceSemanticRefreshJobData, WorkspaceSemanticRefreshJobResult>(
		WORKSPACE_SEMANTIC_REFRESH_QUEUE,
		processWorkspaceSemanticRefresh,
		{
			connection: queueConnection,
			concurrency: 2,
		},
	)

	worker.on("failed", async (job, err) => {
		if (!job) return
		const log = logger.child({
			jobId: job.id,
			workspaceId: job.data.workspaceId,
			userId: job.data.userId,
		})
		log.error({ err: err.message, attempts: job.attemptsMade }, "workspace_semantic_refresh_job_failed")
	})

	worker.on("error", (err) => {
		logger.error({ err: err.message }, "workspace_semantic_refresh_worker_error")
	})

	return worker
}
