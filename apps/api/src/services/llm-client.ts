import { logger } from "../logger"
import { getLlmCredential, type LlmProvider } from "./credentials"

// TASK-019: single entry point for all LLM calls in Sapientia, per
// CLAUDE.md "## LLM Usage Inside Sapientia". v0.1 ships only what
// TASK-019 (paper-summarize) and the imminent TASK-022 (agent
// summon-mode) need: non-streaming single-turn completion against
// the user's own API key. Streaming, tool calling, prompt caching,
// and conversation threading are deferred to the cards that need
// them — no premature abstraction.
//
// Privacy hard rule (CLAUDE.md): we log model / token counts /
// latency / userId / workspaceId / promptId, but NEVER prompt or
// response content. Errors log only our own message strings, never
// the raw provider body.

export interface CompleteParams {
	userId: string
	// Optional — present for user-scoped agent calls (TASK-022) so
	// per-workspace usage can be aggregated. Absent for backend jobs
	// like paper-summarize where there's no single workspace context.
	workspaceId?: string
	// Stable identifier of the prompt template that was filled into
	// `messages`. Used for log-side analytics ("which prompts are
	// expensive / slow / failing") without inspecting content.
	promptId: string
	// Canonical model name from the caller (e.g. "claude-sonnet-4-6").
	// Forwarded to the provider as-is. The caller owns model choice;
	// this module doesn't translate or remap names.
	model: string
	messages: Array<{ role: "user" | "assistant"; content: string }>
	system?: string
	maxTokens?: number
	temperature?: number
}

export interface CompleteResult {
	text: string
	inputTokens: number
	outputTokens: number
	latencyMs: number
	// The model the provider actually answered with — usually the same
	// as `params.model` but providers occasionally route to a dated
	// snapshot we want to record for reproducibility.
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

const ANTHROPIC_BASE_URL =
	process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com"
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com"

export async function complete(params: CompleteParams): Promise<CompleteResult> {
	const credential = await getLlmCredential(params.userId)
	if (!credential) throw new LlmCredentialMissingError()

	const start = Date.now()
	let result: CompleteResult
	try {
		if (credential.provider === "anthropic") {
			result = await callAnthropic(credential.apiKey, params)
		} else {
			result = await callOpenAi(credential.apiKey, params)
		}
	} catch (err) {
		const latencyMs = Date.now() - start
		// Errors are logged by the catch path BEFORE rethrow so a
		// failing call still surfaces in metrics/observability with
		// context. Note: only `err.message` (our own thrown text) —
		// never the raw provider body, which may echo prompt fragments.
		logger.warn(
			{
				userId: params.userId,
				workspaceId: params.workspaceId,
				promptId: params.promptId,
				model: params.model,
				provider: credential.provider,
				latencyMs,
				err: err instanceof Error ? err.message : String(err),
				permanent: err instanceof LlmCallError ? err.permanent : undefined,
			},
			"llm_call_failed",
		)
		throw err
	}
	const latencyMs = Date.now() - start
	logger.info(
		{
			userId: params.userId,
			workspaceId: params.workspaceId,
			promptId: params.promptId,
			model: result.model,
			provider: credential.provider,
			inputTokens: result.inputTokens,
			outputTokens: result.outputTokens,
			latencyMs,
		},
		"llm_call",
	)
	return { ...result, latencyMs }
}

// ============================================================
// Anthropic — POST /v1/messages
// ============================================================
interface AnthropicResponse {
	id: string
	type: string
	role: string
	content: Array<{ type: string; text?: string }>
	model: string
	stop_reason: string | null
	usage: { input_tokens: number; output_tokens: number }
}

interface AnthropicErrorBody {
	type?: string
	error?: { type?: string; message?: string }
}

async function callAnthropic(apiKey: string, params: CompleteParams): Promise<CompleteResult> {
	const body: Record<string, unknown> = {
		model: params.model,
		max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
		messages: params.messages,
		temperature: params.temperature ?? DEFAULT_TEMPERATURE,
	}
	if (params.system) body.system = params.system

	const response = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages`, {
		method: "POST",
		headers: {
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01",
			"content-type": "application/json",
		},
		body: JSON.stringify(body),
	})

	if (!response.ok) {
		const text = await response.text().catch(() => "")
		const parsed = safeParseJson<AnthropicErrorBody>(text)
		const message = parsed?.error?.message ?? `Anthropic API error (HTTP ${response.status})`
		throw new LlmCallError(message, {
			permanent: isPermanentHttpStatus(response.status),
			status: response.status,
			provider: "anthropic",
		})
	}

	const json = (await response.json()) as AnthropicResponse
	const text = json.content
		.filter((c) => c.type === "text" && typeof c.text === "string")
		.map((c) => c.text as string)
		.join("")
	if (!text) {
		throw new LlmCallError("Anthropic returned an empty completion", {
			permanent: true,
			provider: "anthropic",
		})
	}
	return {
		text,
		inputTokens: json.usage.input_tokens,
		outputTokens: json.usage.output_tokens,
		latencyMs: 0, // filled by caller
		model: json.model,
	}
}

// ============================================================
// OpenAI — POST /v1/chat/completions
// ============================================================
interface OpenAiResponse {
	id: string
	object: string
	choices: Array<{ index: number; message: { role: string; content: string }; finish_reason: string | null }>
	usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
	model: string
}

interface OpenAiErrorBody {
	error?: { message?: string; type?: string; code?: string | null }
}

async function callOpenAi(apiKey: string, params: CompleteParams): Promise<CompleteResult> {
	const messages: Array<{ role: string; content: string }> = []
	if (params.system) messages.push({ role: "system", content: params.system })
	for (const m of params.messages) messages.push(m)

	const body = {
		model: params.model,
		messages,
		max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
		temperature: params.temperature ?? DEFAULT_TEMPERATURE,
	}

	const response = await fetch(`${OPENAI_BASE_URL}/v1/chat/completions`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	})

	if (!response.ok) {
		const text = await response.text().catch(() => "")
		const parsed = safeParseJson<OpenAiErrorBody>(text)
		const message = parsed?.error?.message ?? `OpenAI API error (HTTP ${response.status})`
		throw new LlmCallError(message, {
			permanent: isPermanentHttpStatus(response.status),
			status: response.status,
			provider: "openai",
		})
	}

	const json = (await response.json()) as OpenAiResponse
	const text = json.choices[0]?.message?.content ?? ""
	if (!text) {
		throw new LlmCallError("OpenAI returned an empty completion", {
			permanent: true,
			provider: "openai",
		})
	}
	return {
		text,
		inputTokens: json.usage.prompt_tokens,
		outputTokens: json.usage.completion_tokens,
		latencyMs: 0,
		model: json.model,
	}
}

// 4xx (auth, bad request, content too long) are permanent — retrying
// won't change the outcome. 5xx and network-level failures are
// transient and worthy of a retry.
function isPermanentHttpStatus(status: number): boolean {
	if (status === 408 || status === 425 || status === 429) return false
	return status >= 400 && status < 500
}

function safeParseJson<T>(text: string): T | null {
	if (!text) return null
	try {
		return JSON.parse(text) as T
	} catch {
		return null
	}
}
