import { blocks as blocksTable, papers } from "@sapientia/db"
import { fillPrompt, formatBlocksForAgent, loadPrompt } from "@sapientia/shared"
import { type Job, Worker } from "bullmq"
import { asc, eq } from "drizzle-orm"
import { db } from "../db"
import { logger } from "../logger"
import { queueConnection } from "../queues/connection"
import {
	PAPER_SUMMARIZE_QUEUE,
	type PaperSummarizeJobData,
	type PaperSummarizeJobResult,
} from "../queues/paper-summarize"
import { getLlmCredential } from "../services/credentials"
import { complete, LlmCallError, LlmCredentialMissingError } from "../services/llm-client"

// TASK-019 / TASK-022: the prompt version remains app-owned, but the
// actual model name is now user-configured because BYOK providers can
// expose arbitrary deployment names.
const CURRENT_PROMPT_VERSION = "source-summary-v2"

// Bound the prompt's content slot so a long paper can't blow past the
// model's context window. ~120k chars ≈ 30k tokens leaves comfortable
// room for the 800-1500 word output and the rest of the prompt frame.
// If we ever trip this, the fix is per-section truncation, not raising
// the cap silently.
const MAX_BLOCK_CONTENT_CHARS = 120_000

async function processPaperSummarize(
	job: Job<PaperSummarizeJobData, PaperSummarizeJobResult>,
): Promise<PaperSummarizeJobResult> {
	const { paperId, userId } = job.data
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

	const currentModel = credential.model

	// Idempotency: matching model + prompt version + status=done means
	// nothing about the summary's freshness has changed since last run.
	// Returning "skipped" is a normal success path — the BullMQ retry
	// machinery does not run again.
	if (
		paper.summary &&
		paper.summaryStatus === "done" &&
		paper.summaryModel === currentModel &&
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

	// Load blocks in reading order. The block-level agent formatter
	// expects them this way; otherwise the LLM sees content scrambled.
	const paperBlocks = await db
		.select()
		.from(blocksTable)
		.where(eq(blocksTable.paperId, paperId))
		.orderBy(asc(blocksTable.blockIndex))

	let blockText = formatBlocksForAgent({
		blocks: paperBlocks.map((b) => ({
			blockId: b.blockId,
			type: b.type,
			text: b.text,
			headingLevel: b.headingLevel,
		})),
		highlights: [], // source-summary is paper-only; user marks aren't relevant here.
	})
	let truncated = false
	if (blockText.length > MAX_BLOCK_CONTENT_CHARS) {
		blockText = `${blockText.slice(0, MAX_BLOCK_CONTENT_CHARS)}\n\n[paper continues — content truncated for context window]`
		truncated = true
	}

	const template = loadPrompt(CURRENT_PROMPT_VERSION)
	const userPrompt = fillPrompt(template, {
		title: paper.title || "(untitled paper)",
		authors: Array.isArray(paper.authors) && paper.authors.length > 0 ? paper.authors.join(", ") : "(unknown)",
		abstractBlock: "", // No abstract column on papers; leave empty. Block content includes it anyway.
		blocks: blockText,
	})

	let summaryText: string
	let usedModel: string
	try {
		const result = await complete({
			userId,
			promptId: CURRENT_PROMPT_VERSION,
			model: currentModel,
			messages: [{ role: "user", content: userPrompt }],
			maxTokens: 2048,
			temperature: 0.4,
		})
		summaryText = result.text
		usedModel = result.model
		if (!hasBlockCitations(summaryText)) {
			log.warn(
				{ summaryModel: usedModel, summaryPromptVersion: CURRENT_PROMPT_VERSION },
				"paper_summary_missing_block_citations",
			)
		}
	} catch (err) {
		// Missing-credentials is an expected user state for fresh
		// installs — we don't surface it as a worker failure. Persist
		// the status and return cleanly so BullMQ doesn't retry.
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

	await db
		.update(papers)
		.set({
			summary: summaryText,
			summaryStatus: "done",
			summaryGeneratedAt: new Date(),
			summaryModel: usedModel,
			summaryPromptVersion: CURRENT_PROMPT_VERSION,
			summaryError: null,
			updatedAt: new Date(),
		})
		.where(eq(papers.id, paperId))

	log.info(
		{
			summaryModel: usedModel,
			summaryPromptVersion: CURRENT_PROMPT_VERSION,
			summaryChars: summaryText.length,
			truncatedInput: truncated,
		},
		"paper_summarize_job_completed",
	)

	return {
		paperId,
		status: "done",
		generatedAt: new Date().toISOString(),
	}
}

function hasBlockCitations(text: string) {
	return /\[(?:blk|block)\s+[a-zA-Z0-9_-]+\]/i.test(text)
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
			concurrency: 2,
		},
	)

	worker.on("failed", async (job, err) => {
		if (!job) return
		const log = logger.child({ jobId: job.id, paperId: job.data.paperId })
		log.error({ err: err.message, attempts: job.attemptsMade }, "paper_summarize_job_failed")

		const totalAttempts = job.opts.attempts ?? 1
		const finalAttempt = isPermanent(err) || job.attemptsMade >= totalAttempts

		if (finalAttempt) {
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
