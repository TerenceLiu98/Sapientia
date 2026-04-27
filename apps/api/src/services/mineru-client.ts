import { z } from "zod"
import { config } from "../config"
import { logger } from "../logger"

// API contract: https://mineru.net/apiManage/docs
// Tokens come from each user's row in user_credentials, never from env.

const SubmitTaskResponseSchema = z.object({
	code: z.number(),
	msg: z.string(),
	data: z
		.object({
			task_id: z.string(),
		})
		.optional(),
	trace_id: z.string().optional(),
})

const TaskStatusResponseSchema = z.object({
	code: z.number(),
	msg: z.string().optional(),
	data: z.object({
		task_id: z.string(),
		state: z.enum(["waiting-file", "pending", "running", "done", "failed", "converting"]),
		full_zip_url: z.string().optional(),
		err_msg: z.string().optional(),
		extract_progress: z
			.object({
				extracted_pages: z.number().optional(),
				total_pages: z.number().optional(),
				start_time: z.string().optional(),
			})
			.optional(),
	}),
})

// Batch flow adds "waiting-file" while we have a presigned URL but haven't
// PUT the bytes yet. Single-task URL flow doesn't see this state.
export type MineruTaskState =
	| "waiting-file"
	| "pending"
	| "running"
	| "done"
	| "failed"
	| "converting"

export interface MineruTaskStatus {
	taskId: string
	state: MineruTaskState
	zipUrl?: string
	errorMessage?: string
	extractedPages?: number
	totalPages?: number
}

export class MineruApiError extends Error {
	constructor(
		public code: number,
		public msg: string,
	) {
		super(`MinerU API error ${code}: ${msg}`)
		this.name = "MineruApiError"
	}
}

export interface SubmitParseTaskArgs {
	token: string
	pdfUrl: string
	modelVersion?: "pipeline" | "vlm" | "MinerU-HTML"
	isOcr?: boolean
	enableFormula?: boolean
	enableTable?: boolean
	language?: string
	dataId?: string
	baseUrl?: string
}

export async function submitParseTask(args: SubmitParseTaskArgs): Promise<string> {
	const {
		token,
		pdfUrl,
		modelVersion = "vlm",
		isOcr = false,
		enableFormula = true,
		enableTable = true,
		language = "ch",
		dataId,
		baseUrl = config.MINERU_BASE_URL,
	} = args

	const res = await fetch(`${baseUrl}/api/v4/extract/task`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({
			url: pdfUrl,
			model_version: modelVersion,
			is_ocr: isOcr,
			enable_formula: enableFormula,
			enable_table: enableTable,
			language,
			...(dataId ? { data_id: dataId } : {}),
		}),
	})

	if (!res.ok) {
		throw new MineruApiError(res.status, `HTTP ${res.status} ${res.statusText}`)
	}

	const json = await res.json()
	const parsed = SubmitTaskResponseSchema.parse(json)
	if (parsed.code !== 0 || !parsed.data?.task_id) {
		throw new MineruApiError(parsed.code, parsed.msg)
	}
	return parsed.data.task_id
}

export interface GetTaskStatusArgs {
	token: string
	taskId: string
	baseUrl?: string
}

export async function getTaskStatus(args: GetTaskStatusArgs): Promise<MineruTaskStatus> {
	const { token, taskId, baseUrl = config.MINERU_BASE_URL } = args

	const res = await fetch(`${baseUrl}/api/v4/extract/task/${taskId}`, {
		headers: { authorization: `Bearer ${token}` },
	})

	if (!res.ok) {
		throw new MineruApiError(res.status, `HTTP ${res.status} ${res.statusText}`)
	}

	const json = await res.json()
	const parsed = TaskStatusResponseSchema.parse(json)
	if (parsed.code !== 0) {
		throw new MineruApiError(parsed.code, parsed.msg ?? "non-zero code")
	}

	const data = parsed.data
	return {
		taskId: data.task_id,
		state: data.state,
		zipUrl: data.full_zip_url,
		errorMessage: data.err_msg,
		extractedPages: data.extract_progress?.extracted_pages,
		totalPages: data.extract_progress?.total_pages,
	}
}

export interface WaitForCompletionArgs {
	token: string
	taskId: string
	intervalMs?: number
	timeoutMs?: number
	baseUrl?: string
}

// Poll until state is `done` or `failed`, or until timeoutMs elapses.
export async function waitForCompletion(args: WaitForCompletionArgs): Promise<MineruTaskStatus> {
	const { token, taskId, intervalMs = 5000, timeoutMs = 10 * 60 * 1000, baseUrl } = args
	const start = Date.now()

	while (Date.now() - start < timeoutMs) {
		const status = await getTaskStatus({ token, taskId, baseUrl })
		logger.debug(
			{ taskId, state: status.state, extractedPages: status.extractedPages },
			"mineru_poll",
		)

		if (status.state === "done" || status.state === "failed") return status

		await new Promise((resolve) => setTimeout(resolve, intervalMs))
	}

	throw new Error(`MinerU task ${taskId} did not complete within ${timeoutMs}ms`)
}

/* ---------- Batch upload flow (no public source URL needed) ---------- */
//
// MinerU returns a presigned PUT URL we can ship the PDF bytes to. After the
// PUT completes their side automatically queues parsing — there's no
// separate "start" call.
//
// Why this exists: the URL-based flow above requires the source PDF to be
// reachable from MinerU's servers. Self-hosted MinIO sitting behind a NAT
// or in a K8s cluster isn't, and `localhost`/private IPs are rejected at
// validation with code -10002. The batch flow sidesteps the whole public
// reachability problem.

const FileUrlsBatchResponseSchema = z.object({
	code: z.number(),
	msg: z.string().optional(),
	data: z
		.object({
			batch_id: z.string(),
			file_urls: z.array(z.string()),
		})
		.optional(),
	trace_id: z.string().optional(),
})

const BatchExtractResultEntrySchema = z.object({
	file_name: z.string(),
	data_id: z.string().optional(),
	state: z.enum(["waiting-file", "pending", "running", "done", "failed", "converting"]),
	full_zip_url: z.string().optional(),
	err_msg: z.string().optional(),
	extract_progress: z
		.object({
			extracted_pages: z.number().optional(),
			total_pages: z.number().optional(),
			start_time: z.string().optional(),
		})
		.optional(),
})

const BatchResultsResponseSchema = z.object({
	code: z.number(),
	msg: z.string().optional(),
	data: z.object({
		batch_id: z.string(),
		extract_result: z.array(BatchExtractResultEntrySchema),
	}),
})

export interface SubmitFileBatchArgs {
	token: string
	files: Array<{
		name: string
		dataId?: string
		isOcr?: boolean
		pageRanges?: string
	}>
	modelVersion?: "pipeline" | "vlm" | "MinerU-HTML"
	enableFormula?: boolean
	enableTable?: boolean
	language?: string
	baseUrl?: string
}

// Returns a batch_id and a presigned URL per file. PUT each file's bytes to
// its corresponding URL; the array order matches `files`.
export async function submitFileBatch(
	args: SubmitFileBatchArgs,
): Promise<{ batchId: string; fileUrls: string[] }> {
	const {
		token,
		files,
		modelVersion = "vlm",
		enableFormula = true,
		enableTable = true,
		language = "ch",
		baseUrl = config.MINERU_BASE_URL,
	} = args

	const res = await fetch(`${baseUrl}/api/v4/file-urls/batch`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({
			files: files.map((f) => ({
				name: f.name,
				...(f.dataId ? { data_id: f.dataId } : {}),
				is_ocr: f.isOcr ?? false,
				...(f.pageRanges ? { page_ranges: f.pageRanges } : {}),
			})),
			model_version: modelVersion,
			enable_formula: enableFormula,
			enable_table: enableTable,
			language,
		}),
	})

	if (!res.ok) {
		throw new MineruApiError(res.status, `HTTP ${res.status} ${res.statusText}`)
	}

	const json = await res.json()
	const parsed = FileUrlsBatchResponseSchema.parse(json)
	if (parsed.code !== 0 || !parsed.data) {
		throw new MineruApiError(parsed.code, parsed.msg ?? "non-zero code")
	}
	return { batchId: parsed.data.batch_id, fileUrls: parsed.data.file_urls }
}

// MinerU's docs are explicit: do NOT set Content-Type on the PUT.
export async function uploadFileToMineru(fileUrl: string, body: Uint8Array): Promise<void> {
	const res = await fetch(fileUrl, {
		method: "PUT",
		body,
		// `headers` left empty — passing none forces fetch to omit
		// content-type which is what the presigned signature was generated
		// against. Setting any value here breaks the signature.
	})
	if (!res.ok) {
		throw new Error(`MinerU file upload PUT failed: HTTP ${res.status} ${res.statusText}`)
	}
}

export interface BatchExtractResult {
	fileName: string
	dataId?: string
	state: MineruTaskState
	zipUrl?: string
	errorMessage?: string
	extractedPages?: number
	totalPages?: number
}

export interface GetBatchResultArgs {
	token: string
	batchId: string
	baseUrl?: string
}

export async function getBatchResult(
	args: GetBatchResultArgs,
): Promise<{ batchId: string; results: BatchExtractResult[] }> {
	const { token, batchId, baseUrl = config.MINERU_BASE_URL } = args

	const res = await fetch(`${baseUrl}/api/v4/extract-results/batch/${batchId}`, {
		headers: { authorization: `Bearer ${token}` },
	})
	if (!res.ok) {
		throw new MineruApiError(res.status, `HTTP ${res.status} ${res.statusText}`)
	}

	const json = await res.json()
	const parsed = BatchResultsResponseSchema.parse(json)
	if (parsed.code !== 0) {
		throw new MineruApiError(parsed.code, parsed.msg ?? "non-zero code")
	}

	return {
		batchId: parsed.data.batch_id,
		results: parsed.data.extract_result.map((r) => ({
			fileName: r.file_name,
			dataId: r.data_id,
			state: r.state,
			zipUrl: r.full_zip_url,
			errorMessage: r.err_msg,
			extractedPages: r.extract_progress?.extracted_pages,
			totalPages: r.extract_progress?.total_pages,
		})),
	}
}

export interface WaitForBatchArgs {
	token: string
	batchId: string
	intervalMs?: number
	timeoutMs?: number
	baseUrl?: string
	// Called every poll with the current result entries so callers can mirror
	// progress to their own storage.
	onProgress?: (results: BatchExtractResult[]) => void | Promise<void>
}

// Wait until every file in the batch has reached a terminal state
// (`done` or `failed`).
export async function waitForBatchCompletion(
	args: WaitForBatchArgs,
): Promise<BatchExtractResult[]> {
	const {
		token,
		batchId,
		intervalMs = 5000,
		timeoutMs = 10 * 60 * 1000,
		baseUrl,
		onProgress,
	} = args
	const start = Date.now()

	while (Date.now() - start < timeoutMs) {
		const { results } = await getBatchResult({ token, batchId, baseUrl })
		if (onProgress) await onProgress(results)
		logger.debug({ batchId, states: results.map((r) => r.state) }, "mineru_batch_poll")

		if (results.length > 0 && results.every((r) => r.state === "done" || r.state === "failed")) {
			return results
		}

		await new Promise((resolve) => setTimeout(resolve, intervalMs))
	}

	throw new Error(`MinerU batch ${batchId} did not complete within ${timeoutMs}ms`)
}
