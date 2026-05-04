import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import {
	APICallError,
	type LanguageModel,
	type LanguageModelUsage,
	type ModelMessage,
	Output,
	type StreamTextResult,
	generateText,
	streamText,
} from "ai"
import { z } from "zod"
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

export interface CompleteObjectParams<T> extends CompleteParams {
	schema: z.ZodType<T>
}

export interface CompleteObjectResult<T> {
	object: T
	inputTokens: number
	outputTokens: number
	latencyMs: number
	model: string
}

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
	readonly diagnostics?: Record<string, unknown>

	constructor(message: string, opts: {
		permanent: boolean
		status?: number
		provider: LlmProvider
		diagnostics?: Record<string, unknown>
	}) {
		super(message)
		this.name = "LlmCallError"
		this.permanent = opts.permanent
		this.status = opts.status
		this.provider = opts.provider
		this.diagnostics = opts.diagnostics
	}
}

class ObjectTextParseError extends Error {
	readonly kind: "json_parse" | "schema_parse"
	readonly candidate: string

	constructor(
		message: string,
		opts: {
			kind: "json_parse" | "schema_parse"
			candidate: string
		},
	) {
		super(message)
		this.name = "ObjectTextParseError"
		this.kind = opts.kind
		this.candidate = opts.candidate
	}
}

const DEFAULT_MAX_TOKENS = 2048
const DEFAULT_TEMPERATURE = 0.4
const DEFAULT_ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1"
const DEFAULT_OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"
const OPENAI_COMPATIBLE_PROVIDER_NAME = "sapientia-openai-compatible"

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

export async function completeObject<T>(
	params: CompleteObjectParams<T>,
): Promise<CompleteObjectResult<T>> {
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
		if (credential.provider === "openai") {
			return await completeObjectWithJsonMode({
				params,
				model: resolved.model,
				provider: credential.provider,
				startedAt: start,
			})
		}

		const result = await generateText({
			model: resolved.model,
			system: params.system,
			messages: params.messages,
			experimental_output: Output.object({
				schema: params.schema,
			}),
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
			usage: result.usage,
			latencyMs,
		})

		return {
			object: result.experimental_output,
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

async function completeObjectWithJsonMode<T>(args: {
	params: CompleteObjectParams<T>
	model: LanguageModel
	provider: LlmProvider
	startedAt: number
}): Promise<CompleteObjectResult<T>> {
	const { params, model, provider, startedAt } = args
	const maxParseAttempts = 2
	let lastParseError: ObjectTextParseError | null = null

	for (let attempt = 0; attempt < maxParseAttempts; attempt += 1) {
		const result = await generateText({
			model,
			system: buildJsonObjectSystem(params.system, params.schema, {
				repairAttempt: attempt > 0,
			}),
			messages: params.messages,
			maxOutputTokens:
				attempt > 0
					? Math.ceil((params.maxTokens ?? DEFAULT_MAX_TOKENS) * 1.25)
					: (params.maxTokens ?? DEFAULT_MAX_TOKENS),
			temperature: attempt > 0 ? 0 : (params.temperature ?? DEFAULT_TEMPERATURE),
			maxRetries: 0,
			abortSignal: params.abortSignal,
			providerOptions: {
				[OPENAI_COMPATIBLE_PROVIDER_NAME]: {
					response_format: { type: "json_object" },
				},
			},
		})

		try {
			const parsed = parseObjectFromText(params.schema, result.text, params.promptId)
			const latencyMs = Date.now() - startedAt
			logSuccess({
				params,
				provider,
				model: result.response.modelId,
				usage: result.totalUsage,
				latencyMs,
			})

			return {
				object: parsed,
				inputTokens: result.totalUsage.inputTokens ?? 0,
				outputTokens: result.totalUsage.outputTokens ?? 0,
				latencyMs,
				model: result.response.modelId,
			}
		} catch (error) {
			if (error instanceof ObjectTextParseError && attempt + 1 < maxParseAttempts) {
				lastParseError = error
				logger.warn(
					{
						userId: params.userId,
						workspaceId: params.workspaceId,
						promptId: params.promptId,
						model: params.model,
						provider,
						attempt: attempt + 1,
						kind: error.kind,
						candidateChars: error.candidate.length,
					},
					"llm_object_parse_retry",
				)
				continue
			}
			throw error
		}
	}

	throw lastParseError ?? new Error(`${params.promptId} did not produce a parseable object`)
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
		name: OPENAI_COMPATIBLE_PROVIDER_NAME,
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
			diagnostics: args.error instanceof LlmCallError ? args.error.diagnostics : undefined,
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
			diagnostics: extractErrorDiagnostics(error),
		})
	}

	if (error instanceof Error) {
		const permanent =
			error.name === "TypeError" && /invalid url|failed to parse url/i.test(error.message)
		return new LlmCallError(error.message, {
			provider,
			permanent,
			diagnostics: extractErrorDiagnostics(error),
		})
	}

	return new LlmCallError("LLM request failed.", {
		provider,
		permanent: false,
		diagnostics: extractErrorDiagnostics(error),
	})
}

function isPermanentHttpStatus(status: number): boolean {
	if (status === 408 || status === 425 || status === 429) return false
	return status >= 400 && status < 500
}

function buildJsonObjectSystem<T>(
	system: string | undefined,
	schema: z.ZodType<T>,
	options: { repairAttempt?: boolean } = {},
) {
	const schemaJson = JSON.stringify(z.toJSONSchema(schema), null, 2)
	const instructions = [
		"Return only a valid JSON object.",
		"Do not wrap the JSON in markdown fences.",
		"Do not add commentary before or after the JSON.",
		"The JSON must be complete and parseable; never stop in the middle of an array, string, or object.",
		options.repairAttempt
			? "Your previous response for this request was invalid or truncated. Return a smaller complete JSON object now."
			: null,
		`The JSON must satisfy this schema:\n${schemaJson}`,
	]
		.filter(Boolean)
		.join("\n\n")
	return system ? `${system}\n\n${instructions}` : instructions
}

function parseObjectFromText<T>(schema: z.ZodType<T>, text: string, promptId: string) {
	const trimmed = text.trim()
	const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
	const candidate = fenced?.[1] ?? trimmed
	let parsedJson: unknown
	try {
		parsedJson = JSON.parse(candidate)
	} catch (error) {
		throw new ObjectTextParseError(
			`${promptId} did not return valid JSON${error instanceof Error ? `: ${error.message}` : ""}`,
			{
				kind: "json_parse",
				candidate,
			},
		)
	}
	try {
		return schema.parse(parsedJson)
	} catch (error) {
		throw new ObjectTextParseError(
			`${promptId} returned JSON that did not satisfy schema${error instanceof Error ? `: ${error.message}` : ""}`,
			{
				kind: "schema_parse",
				candidate,
			},
		)
	}
}

function extractErrorDiagnostics(error: unknown) {
	if (error == null) return { rawType: String(error) }

	if (error instanceof Error) {
		return compactDiagnostics({
			rawType: "Error",
			errorName: error.name,
			errorConstructor: error.constructor?.name,
			errorCode: getObjectStringField(error, "code"),
			errorType: getObjectStringField(error, "type"),
			errorStatus: getObjectNumberField(error, "status") ?? getObjectNumberField(error, "statusCode"),
			causeName:
				error.cause instanceof Error
					? error.cause.name
					: getObjectStringField(error, "causeName"),
			causeCode:
				error.cause && typeof error.cause === "object"
					? getObjectStringField(error.cause, "code")
					: undefined,
			rawKeys: Object.keys(error).slice(0, 8),
		})
	}

	if (typeof error === "object") {
		const nestedError =
			typeof (error as Record<string, unknown>).error === "object"
				? ((error as Record<string, unknown>).error as Record<string, unknown>)
				: undefined
		return compactDiagnostics({
			rawType: "object",
			objectType: getObjectStringField(error, "type"),
			objectCode: getObjectStringField(error, "code"),
			objectName: getObjectStringField(error, "name"),
			objectStatus: getObjectNumberField(error, "status") ?? getObjectNumberField(error, "statusCode"),
			nestedErrorType: nestedError ? getObjectStringField(nestedError, "type") : undefined,
			nestedErrorCode: nestedError ? getObjectStringField(nestedError, "code") : undefined,
			nestedErrorName: nestedError ? getObjectStringField(nestedError, "name") : undefined,
			nestedErrorMessage: nestedError ? getObjectStringField(nestedError, "message") : undefined,
			nestedErrorStatus:
				nestedError
					? getObjectNumberField(nestedError, "status") ?? getObjectNumberField(nestedError, "statusCode")
					: undefined,
			nestedErrorKeys: nestedError ? Object.keys(nestedError).slice(0, 8) : undefined,
			rawKeys: Object.keys(error).slice(0, 8),
		})
	}

	return { rawType: typeof error }
}

function getObjectStringField(value: unknown, key: string) {
	if (!value || typeof value !== "object") return undefined
	const candidate = (value as Record<string, unknown>)[key]
	return typeof candidate === "string" ? candidate : undefined
}

function getObjectNumberField(value: unknown, key: string) {
	if (!value || typeof value !== "object") return undefined
	const candidate = (value as Record<string, unknown>)[key]
	return typeof candidate === "number" ? candidate : undefined
}

function compactDiagnostics(value: Record<string, unknown>) {
	return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}
