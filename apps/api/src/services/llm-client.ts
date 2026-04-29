import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import {
	APICallError,
	type LanguageModel,
	type LanguageModelUsage,
	type ModelMessage,
	type StreamTextResult,
	generateText,
	streamText,
} from "ai"
import { logger } from "../logger"
import { getLlmCredential, type LlmProvider } from "./credentials"

// TASK-019 / TASK-022: single entry point for all LLM calls in
// Sapientia. We use AI SDK Core for both generateText() and
// streamText(), but keep provider selection, logging discipline, and
// credential resolution inside this module so the rest of the app never
// touches provider SDKs directly.

export interface CompleteParams {
	userId: string
	workspaceId?: string
	promptId: string
	model: string
	messages: ModelMessage[]
	system?: string
	maxTokens?: number
	temperature?: number
	abortSignal?: AbortSignal
}

export interface CompleteResult {
	text: string
	inputTokens: number
	outputTokens: number
	latencyMs: number
	model: string
}

export interface StreamCompleteParams extends CompleteParams {}

export class LlmCredentialMissingError extends Error {
	constructor() {
		super("No LLM API key configured for this user. See Settings.")
		this.name = "LlmCredentialMissingError"
	}
}

export class LlmCallError extends Error {
	readonly permanent: boolean
	readonly status?: number
	readonly provider: LlmProvider

	constructor(message: string, opts: { permanent: boolean; status?: number; provider: LlmProvider }) {
		super(message)
		this.name = "LlmCallError"
		this.permanent = opts.permanent
		this.status = opts.status
		this.provider = opts.provider
	}
}

const DEFAULT_MAX_TOKENS = 2048
const DEFAULT_TEMPERATURE = 0.4
const DEFAULT_ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1"
const DEFAULT_OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"

export async function complete(params: CompleteParams): Promise<CompleteResult> {
	const credential = await getLlmCredential(params.userId)
	if (!credential) throw new LlmCredentialMissingError()

	const start = Date.now()
	const resolved = resolveLanguageModel({
		provider: credential.provider,
		apiKey: credential.apiKey,
		baseURL: credential.baseURL,
		model: params.model,
	})

	try {
		const result = await generateText({
			model: resolved.model,
			system: params.system,
			messages: params.messages,
			maxOutputTokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
			temperature: params.temperature ?? DEFAULT_TEMPERATURE,
			maxRetries: 0,
			abortSignal: params.abortSignal,
		})

		const latencyMs = Date.now() - start
		logSuccess({
			params,
			provider: credential.provider,
			model: result.response.modelId,
			usage: result.totalUsage,
			latencyMs,
		})

		return {
			text: result.text,
			inputTokens: result.totalUsage.inputTokens ?? 0,
			outputTokens: result.totalUsage.outputTokens ?? 0,
			latencyMs,
			model: result.response.modelId,
		}
	} catch (err) {
		const mapped = mapLlmError(err, credential.provider)
		logFailure({
			params,
			provider: credential.provider,
			latencyMs: Date.now() - start,
			error: mapped,
		})
		throw mapped
	}
}

export async function streamComplete(
	params: StreamCompleteParams,
): Promise<StreamTextResult<Record<string, never>, never>> {
	const credential = await getLlmCredential(params.userId)
	if (!credential) throw new LlmCredentialMissingError()

	const start = Date.now()
	const resolved = resolveLanguageModel({
		provider: credential.provider,
		apiKey: credential.apiKey,
		baseURL: credential.baseURL,
		model: params.model,
	})

	try {
		return streamText({
			model: resolved.model,
			system: params.system,
			messages: params.messages,
			maxOutputTokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
			temperature: params.temperature ?? DEFAULT_TEMPERATURE,
			maxRetries: 0,
			abortSignal: params.abortSignal,
			onFinish: ({ totalUsage, response }) => {
				logSuccess({
					params,
					provider: credential.provider,
					model: response.modelId,
					usage: totalUsage,
					latencyMs: Date.now() - start,
				})
			},
			onError: (error) => {
				const mapped = mapLlmError(error, credential.provider)
				logFailure({
					params,
					provider: credential.provider,
					latencyMs: Date.now() - start,
					error: mapped,
				})
			},
			onAbort: () => {
				logger.info(
					{
						userId: params.userId,
						workspaceId: params.workspaceId,
						promptId: params.promptId,
						model: params.model,
						provider: credential.provider,
						latencyMs: Date.now() - start,
					},
					"llm_stream_aborted",
				)
			},
		})
	} catch (err) {
		const mapped = mapLlmError(err, credential.provider)
		logFailure({
			params,
			provider: credential.provider,
			latencyMs: Date.now() - start,
			error: mapped,
		})
		throw mapped
	}
}

function resolveLanguageModel(args: {
	provider: LlmProvider
	apiKey: string
	baseURL: string | null
	model: string
}): { model: LanguageModel } {
	const baseURL = normalizeBaseUrl(args.provider, args.baseURL)
	if (args.provider === "anthropic") {
		const provider = createAnthropic({
			apiKey: args.apiKey,
			baseURL,
			name: "sapientia-anthropic",
		})
		return { model: provider(args.model) }
	}

	const provider = createOpenAICompatible({
		name: "sapientia-openai-compatible",
		apiKey: args.apiKey,
		baseURL,
	})
	return { model: provider(args.model) }
}

function normalizeBaseUrl(provider: LlmProvider, baseURL: string | null): string {
	const fallback = provider === "anthropic" ? DEFAULT_ANTHROPIC_BASE_URL : DEFAULT_OPENAI_BASE_URL
	if (!baseURL) return fallback

	try {
		return new URL(baseURL).toString().replace(/\/$/, "")
	} catch {
		throw new LlmCallError("Invalid base URL in Settings.", {
			permanent: true,
			provider,
		})
	}
}

function logSuccess(args: {
	params: CompleteParams
	provider: LlmProvider
	model: string
	usage: LanguageModelUsage
	latencyMs: number
}) {
	logger.info(
		{
			userId: args.params.userId,
			workspaceId: args.params.workspaceId,
			promptId: args.params.promptId,
			model: args.model,
			provider: args.provider,
			inputTokens: args.usage.inputTokens ?? 0,
			outputTokens: args.usage.outputTokens ?? 0,
			latencyMs: args.latencyMs,
		},
		"llm_call",
	)
}

function logFailure(args: {
	params: CompleteParams
	provider: LlmProvider
	latencyMs: number
	error: Error
}) {
	logger.warn(
		{
			userId: args.params.userId,
			workspaceId: args.params.workspaceId,
			promptId: args.params.promptId,
			model: args.params.model,
			provider: args.provider,
			latencyMs: args.latencyMs,
			err: args.error.message,
			permanent: args.error instanceof LlmCallError ? args.error.permanent : undefined,
			status: args.error instanceof LlmCallError ? args.error.status : undefined,
		},
		"llm_call_failed",
	)
}

function mapLlmError(error: unknown, provider: LlmProvider): Error {
	if (error instanceof LlmCallError || error instanceof LlmCredentialMissingError) {
		return error
	}

	if (APICallError.isInstance(error)) {
		const status = error.statusCode
		return new LlmCallError(error.message, {
			provider,
			status,
			permanent: status != null ? isPermanentHttpStatus(status) : false,
		})
	}

	if (error instanceof Error) {
		const permanent =
			error.name === "TypeError" && /invalid url|failed to parse url/i.test(error.message)
		return new LlmCallError(error.message, {
			provider,
			permanent,
		})
	}

	return new LlmCallError("LLM request failed.", {
		provider,
		permanent: false,
	})
}

function isPermanentHttpStatus(status: number): boolean {
	if (status === 408 || status === 425 || status === 429) return false
	return status >= 400 && status < 500
}
