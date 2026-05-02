import { Worker } from "bullmq"
import { config } from "./config"
import { closeDb } from "./db"
import { logger } from "./logger"
import { queueConnection } from "./queues/connection"
import { createPaperConceptDescriptionWorker } from "./workers/paper-concept-description.worker"
import { createPaperConceptRefineWorker } from "./workers/paper-concept-refine.worker"
import { createPaperEnrichWorker } from "./workers/paper-enrich.worker"
import { createPaperInnerGraphCompileWorker } from "./workers/paper-inner-graph-compile.worker"
import { createPaperParseWorker } from "./workers/paper-parse.worker"
import { createPaperSummarizeWorker } from "./workers/paper-summarize.worker"
import { createWorkspaceSemanticRefreshWorker } from "./workers/workspace-semantic-refresh.worker"

logger.info({ env: config.NODE_ENV }, "worker_starting")

const paperParseWorker = createPaperParseWorker()
const paperEnrichWorker = createPaperEnrichWorker()
const paperConceptRefineWorker = createPaperConceptRefineWorker()
const paperConceptDescriptionWorker = createPaperConceptDescriptionWorker()
const paperInnerGraphCompileWorker = createPaperInnerGraphCompileWorker()
const paperSummarizeWorker = createPaperSummarizeWorker()
const workspaceSemanticRefreshWorker = createWorkspaceSemanticRefreshWorker()

// Tiny worker for /health/queue-roundtrip diagnostic pings.
const healthcheckWorker = new Worker(
	"healthcheck",
	async (job) => ({
		pong: true,
		receivedAt: Date.now(),
		originalAt: (job.data as { timestamp: number }).timestamp,
	}),
	{ connection: queueConnection, concurrency: 1 },
)

const shutdown = async (signal: string) => {
	logger.info({ signal }, "worker_shutdown_initiated")
	await paperParseWorker.close()
	await paperEnrichWorker.close()
	await paperConceptRefineWorker.close()
	await paperConceptDescriptionWorker.close()
	await paperInnerGraphCompileWorker.close()
	await paperSummarizeWorker.close()
	await workspaceSemanticRefreshWorker.close()
	await healthcheckWorker.close()
	await queueConnection.quit()
	await closeDb()
	process.exit(0)
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))

logger.info("worker_ready")
