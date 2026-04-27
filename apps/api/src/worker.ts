import { Worker } from "bullmq"
import { config } from "./config"
import { closeDb } from "./db"
import { logger } from "./logger"
import { queueConnection } from "./queues/connection"
import { createPaperParseWorker } from "./workers/paper-parse.worker"

logger.info({ env: config.NODE_ENV }, "worker_starting")

const paperParseWorker = createPaperParseWorker()

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
	await healthcheckWorker.close()
	await queueConnection.quit()
	await closeDb()
	process.exit(0)
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))

logger.info("worker_ready")
