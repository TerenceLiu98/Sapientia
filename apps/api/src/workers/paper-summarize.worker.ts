import { type Job, Worker } from "bullmq"
import { papers, workspacePapers } from "@sapientia/db"
import { eq } from "drizzle-orm"
import { db } from "../db"
import { logger } from "../logger"
import { enqueuePaperConceptDescription } from "../queues/paper-concept-description"
import { enqueuePaperConceptRefine } from "../queues/paper-concept-refine"
import { enqueuePaperInnerGraphCompile } from "../queues/paper-inner-graph-compile"
import { queueConnection } from "../queues/connection"
import {
	PAPER_SUMMARIZE_QUEUE,
	type PaperSummarizeJobData,
	type PaperSummarizeJobResult,
} from "../queues/paper-summarize"
import { getLlmCredential } from "../services/credentials"
import { LlmCallError, LlmCredentialMissingError } from "../services/llm-client"
import {
	compilePaper,
	markPaperCompileFailed,
	markPaperCompileRunning,
	PAPER_COMPILE_PROMPT_VERSION,
} from "../services/paper-compile"

const CURRENT_PROMPT_VERSION = PAPER_COMPILE_PROMPT_VERSION

async function processPaperSummarize(
	job: Job<PaperSummarizeJobData, PaperSummarizeJobResult>,
): Promise<PaperSummarizeJobResult> {
	const { paperId, userId, force = false } = job.data
	const log = logger.child({ jobId: job.id, paperId })

	log.info("paper_summarize_job_started")

	const [paper] = await db.select().from(papers).where(eq(papers.id, paperId)).limit(1)
	if (!paper) throw new Error(`paper ${paperId} not found`)
	const credential = await getLlmCredential(userId)
	if (!credential) {
		await db
			.update(papers)
			.set({
				summaryStatus: "no-credentials",
				summaryError: null,
				updatedAt: new Date(),
			})
			.where(eq(papers.id, paperId))
		log.info("paper_summarize_no_credentials")
		return { paperId, status: "no-credentials" }
	}

	// Idempotency: matching model + prompt version + status=done means
	// nothing about the compiled paper context has changed since last run.
	if (
		!force &&
		paper.summary &&
		paper.summaryStatus === "done" &&
		paper.summaryModel === credential.model &&
		paper.summaryPromptVersion === CURRENT_PROMPT_VERSION
	) {
		log.info(
			{ summaryModel: paper.summaryModel, summaryPromptVersion: paper.summaryPromptVersion },
			"paper_summarize_skipped_up_to_date",
		)
		return { paperId, status: "skipped" }
	}

	await db
		.update(papers)
		.set({
			summaryStatus: "running",
			summaryError: null,
			updatedAt: new Date(),
		})
		.where(eq(papers.id, paperId))
	await markPaperCompileRunning({ paperId, userId })

	try {
		const result = await compilePaper({ paperId, userId })

		log.info(
			{
				summaryModel: result.model,
				summaryPromptVersion: CURRENT_PROMPT_VERSION,
				summaryChars: result.summaryChars,
				workspaceCount: result.workspaceCount,
				conceptCount: result.conceptCount,
				compileStrategy: result.compileStrategy,
				windowCount: result.windowCount,
			},
			"paper_summarize_job_completed",
		)

		const workspaceIds = await getWorkspaceIdsForPaper(paperId)
		for (const workspaceId of workspaceIds) {
			await enqueuePaperConceptRefine({ paperId, userId, workspaceId })
			await enqueuePaperConceptDescription({
				paperId,
				userId,
				workspaceId,
				reason: "paper-compile",
			})
			await enqueuePaperInnerGraphCompile({ paperId, userId, workspaceId })
		}

		return {
			paperId,
			status: "done",
			generatedAt: new Date().toISOString(),
		}
	} catch (err) {
		if (err instanceof LlmCredentialMissingError) {
			await db
				.update(papers)
				.set({
					summaryStatus: "no-credentials",
					summaryError: null,
					updatedAt: new Date(),
				})
				.where(eq(papers.id, paperId))
			log.info("paper_summarize_no_credentials")
			return { paperId, status: "no-credentials" }
		}
		throw err
	}
}

function isPermanent(err: Error): boolean {
	if (err instanceof LlmCredentialMissingError) return true
	if (err instanceof LlmCallError) return err.permanent
	// Unknown error — let BullMQ retry. If it's a real bug it'll burn
	// 3 attempts then surface in failed status; not great but bounded.
	return false
}

export function createPaperSummarizeWorker() {
	const worker = new Worker<PaperSummarizeJobData, PaperSummarizeJobResult>(
		PAPER_SUMMARIZE_QUEUE,
		processPaperSummarize,
		{
			connection: queueConnection,
			concurrency: 4,
		},
	)

	worker.on("failed", async (job, err) => {
		if (!job) return
		const log = logger.child({ jobId: job.id, paperId: job.data.paperId })
		log.error({ err: err.message, attempts: job.attemptsMade }, "paper_summarize_job_failed")

		const totalAttempts = job.opts.attempts ?? 1
		const finalAttempt = isPermanent(err) || job.attemptsMade >= totalAttempts

		if (finalAttempt) {
			await markPaperCompileFailed({
				paperId: job.data.paperId,
				userId: job.data.userId,
				error: err.message,
			})
			await db
				.update(papers)
				.set({
					summaryStatus: "failed",
					summaryError: err.message.slice(0, 500),
					updatedAt: new Date(),
				})
				.where(eq(papers.id, job.data.paperId))
		} else {
			// Transient failure mid-retries: leave the running marker so
			// the UI (when one is added) sees "still trying" rather than
			// flickering through pending/running.
			await db
				.update(papers)
				.set({ updatedAt: new Date() })
				.where(eq(papers.id, job.data.paperId))
		}
	})

	worker.on("error", (err) => {
		logger.error({ err: err.message }, "paper_summarize_worker_error")
	})

	return worker
}

async function getWorkspaceIdsForPaper(paperId: string) {
	const rows = await db
		.select({ workspaceId: workspacePapers.workspaceId })
		.from(workspacePapers)
		.where(eq(workspacePapers.paperId, paperId))
	return rows.map((row) => row.workspaceId)
}
