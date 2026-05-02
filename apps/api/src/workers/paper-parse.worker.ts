import { PutObjectCommand } from "@aws-sdk/client-s3"
import { blocks as blocksTable, papers } from "@sapientia/db"
import { type Job, Worker } from "bullmq"
import { eq } from "drizzle-orm"
import { config } from "../config"
import { db } from "../db"
import { logger } from "../logger"
import { queueConnection } from "../queues/connection"
import {
	PAPER_PARSE_QUEUE,
	type PaperParseJobData,
	type PaperParseJobResult,
} from "../queues/paper-parse"
import { enqueuePaperSummarize } from "../queues/paper-summarize"
import { parseContentList } from "../services/block-parser"
import { getMineruToken } from "../services/credentials"
import {
	type BatchExtractResult,
	getBatchResult,
	MineruApiError,
	submitFileBatch,
	uploadFileToMineru,
} from "../services/mineru-client"
import { extractMineruZip, parsePageSizes } from "../services/mineru-zip"
import { markPaperCompilePending } from "../services/paper-compile"
import { readPdfPageSizes } from "../services/pdf-dims"
import { downloadFromS3, s3Client } from "../services/s3-client"

const POLL_INTERVAL_MS = process.env.MINERU_POLL_INTERVAL_MS
	? Number(process.env.MINERU_POLL_INTERVAL_MS)
	: 5000
const POLL_TIMEOUT_MS = process.env.MINERU_POLL_TIMEOUT_MS
	? Number(process.env.MINERU_POLL_TIMEOUT_MS)
	: 10 * 60 * 1000
const NETWORK_STAGE_TIMEOUT_MS = process.env.PAPER_PARSE_NETWORK_STAGE_TIMEOUT_MS
	? Number(process.env.PAPER_PARSE_NETWORK_STAGE_TIMEOUT_MS)
	: 2 * 60 * 1000

export class MissingCredentialError extends Error {
	constructor() {
		super("MinerU API token not configured. See Settings.")
		this.name = "MissingCredentialError"
	}
}

async function processPaperParseJob(
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

	// Read the PDF bytes out of our own MinIO. Going URL-based with a
	// presigned MinIO link doesn't work for self-hosted deployments because
	// MinerU's servers can't reach localhost / private K8s ingress; they
	// reject those URLs at validation time with code -10002. The batch
	// upload flow side-steps the public-reachability problem entirely:
	// MinerU hands us a presigned PUT URL and we upload the bytes directly.
	const pdfBytes = await withStageTimeout(
		"download source PDF from S3",
		downloadFromS3(paper.pdfObjectKey),
	)

	const fileName = `${paper.title.replace(/[/\\?%*:|"<>]/g, "_") || paperId}.pdf`
	const { batchId, fileUrls } = await withStageTimeout(
		"submit MinerU batch",
		submitFileBatch({
			token,
			files: [{ name: fileName, dataId: paperId }],
			modelVersion: "vlm",
		}),
	)
	if (fileUrls.length === 0) {
		throw new Error("MinerU returned an empty file_urls array for batch upload")
	}
	log.info({ mineruBatchId: batchId, fileName }, "mineru_batch_submitted")

	await withStageTimeout("upload source PDF to MinerU", uploadFileToMineru(fileUrls[0], pdfBytes))
	log.info({ mineruBatchId: batchId }, "mineru_file_uploaded")

	// Poll the batch result endpoint, mirroring extract_progress to the DB
	// each tick so the UI can render a live "parsing N/M pages" counter.
	const result = await pollBatchUntilDone({ token, batchId, paperId, log })

	if (result.state === "failed") {
		throw new Error(`MinerU parse failed: ${result.errorMessage ?? "unknown error"}`)
	}
	if (!result.zipUrl) {
		throw new Error("MinerU returned 'done' state without a zip URL")
	}

	const zipRes = await withStageTimeout("download MinerU result zip", fetch(result.zipUrl))
	if (!zipRes.ok) {
		throw new Error(`failed to download MinerU result zip: HTTP ${zipRes.status}`)
	}
	const zipBuffer = Buffer.from(await zipRes.arrayBuffer())

	const { contentList: blocksJson, middle, layout, images } = await extractMineruZip(zipBuffer)

	const blocksKey = `papers/${userId}/${paperId}/blocks.json`
	await s3Client.send(
		new PutObjectCommand({
			Bucket: config.S3_BUCKET,
			Key: blocksKey,
			Body: blocksJson,
			ContentType: "application/json",
			ContentLength: blocksJson.byteLength,
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
			ContentLength: zipBuffer.byteLength,
		}),
	)

	// Upload each MinerU image crop to its own S3 key. Returns img_path →
	// object_key so the parser can stamp `imageObjectKey` on figure/table
	// blocks. Skipped silently when there are no images.
	const imageKeys = new Map<string, string>()
	const imagePrefix = `papers/${userId}/${paperId}/`
	for (const [imgPath, bytes] of images) {
		const objectKey = `${imagePrefix}${imgPath}`
		const contentType = imgPath.endsWith(".png")
			? "image/png"
			: imgPath.endsWith(".jpeg") || imgPath.endsWith(".jpg")
				? "image/jpeg"
				: "application/octet-stream"
		await s3Client.send(
			new PutObjectCommand({
				Bucket: config.S3_BUCKET,
				Key: objectKey,
				Body: bytes,
				ContentType: contentType,
				ContentLength: bytes.byteLength,
			}),
		)
		imageKeys.set(imgPath, objectKey)
	}

	// Page dims for bbox normalization. Source priority:
	//   1. PDF MediaBox (read from the original PDF) — ground truth, always
	//      in the same coordinate system as content_list.json bbox.
	//   2. middle.json / layout.json `page_size` — fallback only, since
	//      MinerU has been observed to report dims here in different units
	//      than content_list bbox (e.g. US-Letter [612, 792] for a page
	//      whose bbox values clearly span ~1000pt wide).
	let pageSizes = await readPdfPageSizes(pdfBytes).catch((err) => {
		log.warn({ err: err instanceof Error ? err.message : String(err) }, "pdf_dims_read_failed")
		return new Map<number, { w: number; h: number }>()
	})
	if (pageSizes.size === 0) {
		pageSizes = parsePageSizes({ middle, layout })
	}

	// Parse the block list and bulk-replace this paper's rows. Idempotent —
	// re-running on the same paper produces the same blocks (block_id is a
	// content hash + index).
	const parsedBlocks = parseContentList(blocksJson, {
		pageSizesPx: pageSizes,
		imageKeys,
	})
	await db.delete(blocksTable).where(eq(blocksTable.paperId, paperId))
	if (parsedBlocks.length > 0) {
		await db.insert(blocksTable).values(parsedBlocks.map((b) => ({ ...b, paperId })))
	}

	await db
		.update(papers)
		.set({
			parseStatus: "done",
			blocksObjectKey: blocksKey,
			parseError: null,
			updatedAt: new Date(),
		})
		.where(eq(papers.id, paperId))

	log.info({ blocksKey, blockCount: parsedBlocks.length }, "paper_parse_job_completed")

	// TASK-019: enqueue source-summary now that blocks are persisted.
	// Best-effort — a failure here doesn't roll back the parse-done
	// status. The summary is only consumed by the agent (TASK-022)
	// and isn't load-bearing for marginalia / highlights / notes,
	// so a missing one is recoverable: re-enqueue manually or wait
	// for the next time the user triggers something that uses it.
	try {
		await markPaperCompilePending({ paperId, userId })
		await enqueuePaperSummarize({ paperId, userId, force: false })
	} catch (err) {
		log.warn(
			{ err: err instanceof Error ? err.message : String(err) },
			"paper_summarize_enqueue_failed",
		)
	}

	return {
		paperId,
		blocksObjectKey: blocksKey,
		parsedAt: new Date().toISOString(),
	}
}

async function processPaperParse(
	job: Job<PaperParseJobData, PaperParseJobResult>,
): Promise<PaperParseJobResult> {
	try {
		return await processPaperParseJob(job)
	} catch (err) {
		if (err instanceof Error && isPermanent(err)) {
			job.discard()
		}
		throw err
	}
}

// Each `paper-parse` job submits a batch of exactly one file, so the result
// array is always length 1. We extract that single entry and mirror its
// progress to the DB so the frontend has a live signal.
async function pollBatchUntilDone(args: {
	token: string
	batchId: string
	paperId: string
	log: typeof logger
}): Promise<BatchExtractResult> {
	const { token, batchId, paperId, log } = args
	const start = Date.now()

	while (Date.now() - start < POLL_TIMEOUT_MS) {
		const { results } = await getBatchResult({ token, batchId })
		const result = results[0]
		if (!result) {
			log.warn({ batchId }, "mineru_batch_returned_no_results")
		} else {
			await db
				.update(papers)
				.set({
					parseProgressExtracted: result.extractedPages ?? null,
					parseProgressTotal: result.totalPages ?? null,
					updatedAt: new Date(),
				})
				.where(eq(papers.id, paperId))

			log.debug(
				{ state: result.state, extracted: result.extractedPages, total: result.totalPages },
				"mineru_batch_poll",
			)

			if (result.state === "done" || result.state === "failed") return result
		}

		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
	}

	throw new Error(`MinerU batch ${batchId} did not complete within ${POLL_TIMEOUT_MS}ms`)
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
	// MinerU polls take up to POLL_TIMEOUT_MS (10 min by default), plus zip
	// download + image uploads can add another minute or two on a large paper.
	// BullMQ's default 30s lock would expire mid-job, fire a "could not renew
	// lock" error, mark the job stalled, and retry it from scratch — so we
	// extend the lock to comfortably cover the full pipeline.
	const lockDurationMs = POLL_TIMEOUT_MS + 5 * 60 * 1000
	const worker = new Worker<PaperParseJobData, PaperParseJobResult>(
		PAPER_PARSE_QUEUE,
		processPaperParse,
		{
			connection: queueConnection,
			concurrency: 4,
			lockDuration: lockDurationMs,
			stalledInterval: lockDurationMs,
		},
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

function withStageTimeout<T>(stage: string, promise: Promise<T>): Promise<T> {
	let timeout: ReturnType<typeof setTimeout> | undefined
	const timeoutPromise = new Promise<never>((_, reject) => {
		timeout = setTimeout(() => {
			reject(
				new Error(`paper parse stage "${stage}" timed out after ${NETWORK_STAGE_TIMEOUT_MS}ms`),
			)
		}, NETWORK_STAGE_TIMEOUT_MS)
	})

	return Promise.race([promise, timeoutPromise]).finally(() => {
		if (timeout) clearTimeout(timeout)
	})
}
