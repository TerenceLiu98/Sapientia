import { PutObjectCommand } from "@aws-sdk/client-s3"
import { papers } from "@sapientia/db"
import { type Job, Worker } from "bullmq"
import { eq } from "drizzle-orm"
import yauzl from "yauzl"
import { config } from "../config"
import { db } from "../db"
import { logger } from "../logger"
import { queueConnection } from "../queues/connection"
import {
	PAPER_PARSE_QUEUE,
	type PaperParseJobData,
	type PaperParseJobResult,
} from "../queues/paper-parse"
import { getMineruToken } from "../services/credentials"
import {
	getTaskStatus,
	MineruApiError,
	type MineruTaskStatus,
	submitParseTask,
} from "../services/mineru-client"
import { generatePresignedGetUrl, s3Client } from "../services/s3-client"

const POLL_INTERVAL_MS = process.env.MINERU_POLL_INTERVAL_MS
	? Number(process.env.MINERU_POLL_INTERVAL_MS)
	: 5000
const POLL_TIMEOUT_MS = process.env.MINERU_POLL_TIMEOUT_MS
	? Number(process.env.MINERU_POLL_TIMEOUT_MS)
	: 10 * 60 * 1000

export class MissingCredentialError extends Error {
	constructor() {
		super("MinerU API token not configured. See Settings.")
		this.name = "MissingCredentialError"
	}
}

async function processPaperParse(
	job: Job<PaperParseJobData, PaperParseJobResult>,
): Promise<PaperParseJobResult> {
	const { paperId, userId } = job.data
	const log = logger.child({ jobId: job.id, paperId })

	log.info("paper_parse_job_started")

	const token = await getMineruToken(userId)
	if (!token) throw new MissingCredentialError()

	const [paper] = await db.select().from(papers).where(eq(papers.id, paperId)).limit(1)
	if (!paper) throw new Error(`paper ${paperId} not found`)

	await db
		.update(papers)
		.set({
			parseStatus: "parsing",
			parseError: null,
			parseProgressExtracted: null,
			parseProgressTotal: null,
			updatedAt: new Date(),
		})
		.where(eq(papers.id, paperId))

	// MinerU ingests by URL. Generate a presigned GET that lasts long enough
	// for their queue plus the actual fetch (worst-case 30 min).
	const pdfUrl = await generatePresignedGetUrl(paper.pdfObjectKey, 30 * 60)

	const taskId = await submitParseTask({
		token,
		pdfUrl,
		modelVersion: "vlm",
		dataId: paperId,
	})
	log.info({ mineruTaskId: taskId }, "mineru_task_submitted")

	// Inline poll loop so we can write MinerU's `extract_progress` to the DB
	// each tick. The previous `waitForCompletion` helper hid that signal from
	// the UI.
	const result = await pollWithProgress({
		token,
		taskId,
		paperId,
		log,
	})

	if (result.state === "failed") {
		throw new Error(`MinerU parse failed: ${result.errorMessage ?? "unknown error"}`)
	}
	if (!result.zipUrl) {
		throw new Error("MinerU returned 'done' state without a zip URL")
	}

	const zipRes = await fetch(result.zipUrl)
	if (!zipRes.ok) {
		throw new Error(`failed to download MinerU result zip: HTTP ${zipRes.status}`)
	}
	const zipBuffer = Buffer.from(await zipRes.arrayBuffer())

	const blocksJson = await extractContentList(zipBuffer)

	const blocksKey = `papers/${userId}/${paperId}/blocks.json`
	await s3Client.send(
		new PutObjectCommand({
			Bucket: config.S3_BUCKET,
			Key: blocksKey,
			Body: blocksJson,
			ContentType: "application/json",
		}),
	)

	// Stash the raw zip for future re-extraction (alt formats live alongside).
	const zipKey = `papers/${userId}/${paperId}/mineru-result.zip`
	await s3Client.send(
		new PutObjectCommand({
			Bucket: config.S3_BUCKET,
			Key: zipKey,
			Body: zipBuffer,
			ContentType: "application/zip",
		}),
	)

	await db
		.update(papers)
		.set({
			parseStatus: "done",
			blocksObjectKey: blocksKey,
			parseError: null,
			updatedAt: new Date(),
		})
		.where(eq(papers.id, paperId))

	log.info({ blocksKey }, "paper_parse_job_completed")

	return {
		paperId,
		blocksObjectKey: blocksKey,
		parsedAt: new Date().toISOString(),
	}
}

// Polls MinerU's task status, mirrors `extract_progress` to the DB so the
// frontend can render a live "parsing N/M pages" counter.
async function pollWithProgress(args: {
	token: string
	taskId: string
	paperId: string
	log: typeof logger
}): Promise<MineruTaskStatus> {
	const { token, taskId, paperId, log } = args
	const start = Date.now()

	while (Date.now() - start < POLL_TIMEOUT_MS) {
		const status = await getTaskStatus({ token, taskId })

		// Persist the progress numbers (or null when MinerU hasn't reported any
		// yet) so the UI sees movement without a separate signal channel.
		await db
			.update(papers)
			.set({
				parseProgressExtracted: status.extractedPages ?? null,
				parseProgressTotal: status.totalPages ?? null,
				updatedAt: new Date(),
			})
			.where(eq(papers.id, paperId))

		log.debug(
			{ state: status.state, extracted: status.extractedPages, total: status.totalPages },
			"mineru_poll",
		)

		if (status.state === "done" || status.state === "failed") return status

		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
	}

	throw new Error(`MinerU task ${taskId} did not complete within ${POLL_TIMEOUT_MS}ms`)
}

// Pull `*_content_list.json` out of a MinerU result zip in memory.
async function extractContentList(zipBuffer: Buffer): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		yauzl.fromBuffer(zipBuffer, { lazyEntries: true }, (err, zipfile) => {
			if (err) return reject(err)
			if (!zipfile) return reject(new Error("zip file is empty"))

			let foundEntry = false
			zipfile.readEntry()
			zipfile.on("entry", (entry) => {
				if (entry.fileName.endsWith("_content_list.json")) {
					foundEntry = true
					zipfile.openReadStream(entry, (streamErr, stream) => {
						if (streamErr) return reject(streamErr)
						if (!stream) return reject(new Error("read stream is null"))
						const chunks: Buffer[] = []
						stream.on("data", (c: Buffer) => chunks.push(c))
						stream.on("end", () => resolve(Buffer.concat(chunks)))
						stream.on("error", reject)
					})
				} else {
					zipfile.readEntry()
				}
			})
			zipfile.on("end", () => {
				if (!foundEntry) reject(new Error("content_list.json not found in MinerU zip"))
			})
			zipfile.on("error", reject)
		})
	})
}

// Treat these as "do not retry" — they will not get better with another shot.
function isPermanent(err: Error): boolean {
	if (err instanceof MissingCredentialError) return true

	if (err instanceof MineruApiError) {
		// HTTP-side: 401/403 (bad/expired token), 413/422 (bad input).
		if (err.code === 401 || err.code === 403 || err.code === 413 || err.code === 422) return true
		// MinerU API-side: any negative code is a validation/auth error per their
		// docs — `-10001` invalid token, `-10002` invalid url, `-10003` file
		// format/size/page-count, etc. Retrying won't change the outcome.
		if (err.code < 0) return true
	}

	const msg = err.message.toLowerCase()
	return (
		msg.includes("http 401") ||
		msg.includes("http 403") ||
		msg.includes("not a valid url") ||
		msg.includes("file format") ||
		msg.includes("page count") ||
		msg.includes("page exceeds") ||
		msg.includes("file size") ||
		msg.includes("invalid pdf") ||
		msg.includes("token") // "API token not configured" + MinerU "invalid token"
	)
}

export function createPaperParseWorker() {
	const worker = new Worker<PaperParseJobData, PaperParseJobResult>(
		PAPER_PARSE_QUEUE,
		processPaperParse,
		{ connection: queueConnection, concurrency: 2 },
	)

	worker.on("failed", async (job, err) => {
		if (!job) return
		const log = logger.child({ jobId: job.id, paperId: job.data.paperId })
		log.error({ err: err.message, attempts: job.attemptsMade }, "paper_parse_job_failed")

		const totalAttempts = job.opts.attempts ?? 1
		const finalAttempt = isPermanent(err) || job.attemptsMade >= totalAttempts

		if (finalAttempt) {
			await db
				.update(papers)
				.set({
					parseStatus: "failed",
					parseError: err.message.slice(0, 500),
					updatedAt: new Date(),
				})
				.where(eq(papers.id, job.data.paperId))
		} else {
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
