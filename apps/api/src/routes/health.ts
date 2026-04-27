import { Queue, QueueEvents } from "bullmq"
import { Hono } from "hono"
import { logger } from "../logger"
import { queueConnection } from "../queues/connection"
import { paperParseQueue } from "../queues/paper-parse"

export const healthRoutes = new Hono()

const HEALTHCHECK_QUEUE = "healthcheck"

// Created lazily on first roundtrip request to avoid pulling Redis into the
// boot path of every test that doesn't exercise the queue.
let healthcheckQueue: Queue | null = null
let healthcheckQueueEvents: QueueEvents | null = null

function ensureHealthcheckClients() {
	if (!healthcheckQueue) {
		healthcheckQueue = new Queue(HEALTHCHECK_QUEUE, {
			connection: queueConnection,
			defaultJobOptions: {
				// Cap the completed list so this diagnostic queue doesn't grow
				// without bound; we never need long history here.
				removeOnComplete: { count: 100 },
				removeOnFail: { count: 100 },
			},
		})
	}
	if (!healthcheckQueueEvents) {
		healthcheckQueueEvents = new QueueEvents(HEALTHCHECK_QUEUE, { connection: queueConnection })
	}
	return { queue: healthcheckQueue, events: healthcheckQueueEvents }
}

healthRoutes.get("/health/queue", async (c) => {
	const counts = await paperParseQueue.getJobCounts(
		"waiting",
		"active",
		"completed",
		"failed",
		"delayed",
	)
	return c.json({ queue: "paper-parse", counts })
})

healthRoutes.get("/health/queue-roundtrip", async (c) => {
	const { queue, events } = ensureHealthcheckClients()
	// We don't auto-remove the job: BullMQ deletes the job key before
	// waitUntilFinished can read it back, surfacing as "Missing key for job
	// bull:healthcheck:N. isFinished". Pruning happens via the queue's own
	// completed-list cap below; the diagnostic endpoint stays correct.
	const job = await queue.add("ping", { timestamp: Date.now() })

	try {
		const result = await job.waitUntilFinished(events, 5000)
		return c.json({ status: "ok", result })
	} catch (err) {
		const message = err instanceof Error ? err.message : "unknown error"
		logger.warn({ err: message }, "queue_roundtrip_timeout")
		return c.json({ status: "error", message }, 503)
	}
})
