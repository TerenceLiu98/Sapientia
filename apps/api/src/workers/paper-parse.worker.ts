import { papers } from "@sapientia/db"
import { type Job, Worker } from "bullmq"
import { eq } from "drizzle-orm"
import { db } from "../db"
import { logger } from "../logger"
import { queueConnection } from "../queues/connection"
import {
	PAPER_PARSE_QUEUE,
	type PaperParseJobData,
	type PaperParseJobResult,
} from "../queues/paper-parse"

// Toggleable for tests so the stub finishes quickly.
const STUB_DURATION_MS = process.env.PAPER_PARSE_STUB_MS
	? Number(process.env.PAPER_PARSE_STUB_MS)
	: 3000

async function processPaperParse(
	job: Job<PaperParseJobData, PaperParseJobResult>,
): Promise<PaperParseJobResult> {
	const { paperId } = job.data
	const log = logger.child({ jobId: job.id, paperId })

	log.info("paper_parse_job_started")

	await db
		.update(papers)
		.set({ parseStatus: "parsing", parseError: null, updatedAt: new Date() })
		.where(eq(papers.id, paperId))

	// STUB: pretend to parse. TASK-010 swaps this for a real MinerU call.
	await new Promise((resolve) => setTimeout(resolve, STUB_DURATION_MS))

	await db
		.update(papers)
		.set({
			parseStatus: "done",
			blocksObjectKey: null,
			parseError: null,
			updatedAt: new Date(),
		})
		.where(eq(papers.id, paperId))

	log.info("paper_parse_job_completed")

	return {
		paperId,
		blocksObjectKey: null,
		parsedAt: new Date().toISOString(),
	}
}

export function createPaperParseWorker() {
	const worker = new Worker<PaperParseJobData, PaperParseJobResult>(
		PAPER_PARSE_QUEUE,
		processPaperParse,
		{
			connection: queueConnection,
			concurrency: 4,
		},
	)

	worker.on("failed", async (job, err) => {
		if (!job) return
		const log = logger.child({ jobId: job.id, paperId: job.data.paperId })
		log.error({ err: err.message, attempts: job.attemptsMade }, "paper_parse_job_failed")

		const totalAttempts = job.opts.attempts ?? 1
		if (job.attemptsMade >= totalAttempts) {
			// All retries exhausted.
			await db
				.update(papers)
				.set({
					parseStatus: "failed",
					parseError: err.message.slice(0, 500),
					updatedAt: new Date(),
				})
				.where(eq(papers.id, job.data.paperId))
		} else {
			// Reset to pending between retries so the UI doesn't claim "parsing"
			// while the next attempt waits in backoff.
			await db
				.update(papers)
				.set({ parseStatus: "pending", updatedAt: new Date() })
				.where(eq(papers.id, job.data.paperId))
		}
	})

	worker.on("error", (err) => {
		logger.error({ err: err.message }, "paper_parse_worker_error")
	})

	return worker
}
