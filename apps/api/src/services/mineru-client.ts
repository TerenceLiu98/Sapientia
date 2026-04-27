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
		state: z.enum(["pending", "running", "done", "failed", "converting"]),
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

export type MineruTaskState = "pending" | "running" | "done" | "failed" | "converting"

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
