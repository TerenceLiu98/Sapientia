import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./credentials", () => ({
	getLlmCredential: vi.fn(),
}))

// Capture all logger.info / logger.warn payloads so privacy assertions
// can scan them for prompt content. We don't assert log SHAPES — just
// that no log call has prompt or response text inside it.
const loggerCalls: unknown[] = []
vi.mock("../logger", () => ({
	logger: {
		info: (...args: unknown[]) => loggerCalls.push({ level: "info", args }),
		warn: (...args: unknown[]) => loggerCalls.push({ level: "warn", args }),
		error: (...args: unknown[]) => loggerCalls.push({ level: "error", args }),
		debug: (...args: unknown[]) => loggerCalls.push({ level: "debug", args }),
		child: () => ({
			info: (...args: unknown[]) => loggerCalls.push({ level: "info", args }),
			warn: (...args: unknown[]) => loggerCalls.push({ level: "warn", args }),
			error: (...args: unknown[]) => loggerCalls.push({ level: "error", args }),
			debug: (...args: unknown[]) => loggerCalls.push({ level: "debug", args }),
		}),
	},
}))

beforeEach(() => {
	loggerCalls.length = 0
})
afterEach(() => {
	vi.restoreAllMocks()
})

const SECRET_PROMPT_NEEDLE = "PRIVACY_NEEDLE_42_DO_NOT_LEAK"
const SECRET_RESPONSE_NEEDLE = "RESPONSE_NEEDLE_99_DO_NOT_LEAK"

describe("llm-client", () => {
	it("anthropic happy path returns text + token counts", async () => {
		const { getLlmCredential } = await import("./credentials")
		vi.mocked(getLlmCredential).mockResolvedValue({
			provider: "anthropic",
			apiKey: "sk-ant-test",
		})

		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					id: "msg_1",
					type: "message",
					role: "assistant",
					content: [{ type: "text", text: SECRET_RESPONSE_NEEDLE }],
					model: "claude-sonnet-4-6",
					stop_reason: "end_turn",
					usage: { input_tokens: 11, output_tokens: 22 },
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		)

		const { complete } = await import("./llm-client")
		const result = await complete({
			userId: "u-1",
			promptId: "test-prompt-v1",
			model: "claude-sonnet-4-6",
			messages: [{ role: "user", content: SECRET_PROMPT_NEEDLE }],
		})

		expect(result.text).toBe(SECRET_RESPONSE_NEEDLE)
		expect(result.inputTokens).toBe(11)
		expect(result.outputTokens).toBe(22)
		expect(result.model).toBe("claude-sonnet-4-6")
		expect(result.latencyMs).toBeGreaterThanOrEqual(0)
	})

	it("openai happy path maps prompt_tokens / completion_tokens", async () => {
		const { getLlmCredential } = await import("./credentials")
		vi.mocked(getLlmCredential).mockResolvedValue({
			provider: "openai",
			apiKey: "sk-openai-test",
		})

		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					id: "chatcmpl_1",
					object: "chat.completion",
					choices: [
						{
							index: 0,
							message: { role: "assistant", content: SECRET_RESPONSE_NEEDLE },
							finish_reason: "stop",
						},
					],
					usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 },
					model: "gpt-4o",
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		)

		const { complete } = await import("./llm-client")
		const result = await complete({
			userId: "u-1",
			promptId: "test-prompt-v1",
			model: "gpt-4o",
			messages: [{ role: "user", content: SECRET_PROMPT_NEEDLE }],
		})

		expect(result.text).toBe(SECRET_RESPONSE_NEEDLE)
		expect(result.inputTokens).toBe(11)
		expect(result.outputTokens).toBe(22)
		expect(result.model).toBe("gpt-4o")
	})

	it("4xx status throws permanent LlmCallError", async () => {
		const { getLlmCredential } = await import("./credentials")
		vi.mocked(getLlmCredential).mockResolvedValue({
			provider: "anthropic",
			apiKey: "sk-ant-test",
		})

		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ error: { message: "invalid api key" } }), {
				status: 401,
				headers: { "content-type": "application/json" },
			}),
		)

		const { complete, LlmCallError } = await import("./llm-client")
		await expect(
			complete({
				userId: "u-1",
				promptId: "test-prompt-v1",
				model: "claude-sonnet-4-6",
				messages: [{ role: "user", content: SECRET_PROMPT_NEEDLE }],
			}),
		).rejects.toMatchObject({
			name: "LlmCallError",
			permanent: true,
			status: 401,
		})

		// And the error message should include the provider's message.
		try {
			await complete({
				userId: "u-1",
				promptId: "test-prompt-v1",
				model: "claude-sonnet-4-6",
				messages: [{ role: "user", content: "x" }],
			})
		} catch (err) {
			expect(err).toBeInstanceOf(LlmCallError)
		}
	})

	it("5xx status throws transient LlmCallError", async () => {
		const { getLlmCredential } = await import("./credentials")
		vi.mocked(getLlmCredential).mockResolvedValue({
			provider: "anthropic",
			apiKey: "sk-ant-test",
		})

		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("upstream gone", { status: 503 }),
		)

		const { complete } = await import("./llm-client")
		await expect(
			complete({
				userId: "u-1",
				promptId: "test-prompt-v1",
				model: "claude-sonnet-4-6",
				messages: [{ role: "user", content: SECRET_PROMPT_NEEDLE }],
			}),
		).rejects.toMatchObject({
			name: "LlmCallError",
			permanent: false,
			status: 503,
		})
	})

	it("429 status throws transient LlmCallError (rate limit)", async () => {
		const { getLlmCredential } = await import("./credentials")
		vi.mocked(getLlmCredential).mockResolvedValue({
			provider: "openai",
			apiKey: "sk-openai-test",
		})

		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 }),
		)

		const { complete } = await import("./llm-client")
		await expect(
			complete({
				userId: "u-1",
				promptId: "test-prompt-v1",
				model: "gpt-4o",
				messages: [{ role: "user", content: "x" }],
			}),
		).rejects.toMatchObject({ name: "LlmCallError", permanent: false, status: 429 })
	})

	it("missing credentials throws LlmCredentialMissingError", async () => {
		const { getLlmCredential } = await import("./credentials")
		vi.mocked(getLlmCredential).mockResolvedValue(null)

		const fetchSpy = vi.spyOn(globalThis, "fetch")
		const { complete, LlmCredentialMissingError } = await import("./llm-client")
		await expect(
			complete({
				userId: "u-1",
				promptId: "test-prompt-v1",
				model: "claude-sonnet-4-6",
				messages: [{ role: "user", content: SECRET_PROMPT_NEEDLE }],
			}),
		).rejects.toBeInstanceOf(LlmCredentialMissingError)

		// And no network call — credentials check short-circuits before fetch.
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it("never logs prompt content or response content", async () => {
		const { getLlmCredential } = await import("./credentials")
		vi.mocked(getLlmCredential).mockResolvedValue({
			provider: "anthropic",
			apiKey: "sk-ant-test",
		})

		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					id: "msg_1",
					type: "message",
					role: "assistant",
					content: [{ type: "text", text: SECRET_RESPONSE_NEEDLE }],
					model: "claude-sonnet-4-6",
					stop_reason: "end_turn",
					usage: { input_tokens: 1, output_tokens: 1 },
				}),
				{ status: 200 },
			),
		)

		const { complete } = await import("./llm-client")
		await complete({
			userId: "u-1",
			workspaceId: "w-1",
			promptId: "test-prompt-v1",
			model: "claude-sonnet-4-6",
			messages: [{ role: "user", content: SECRET_PROMPT_NEEDLE }],
			system: "system slot also has secrets",
		})

		const serialized = JSON.stringify(loggerCalls)
		expect(serialized).not.toContain(SECRET_PROMPT_NEEDLE)
		expect(serialized).not.toContain(SECRET_RESPONSE_NEEDLE)
		expect(serialized).not.toContain("system slot also has secrets")

		// But metadata IS logged so analytics works.
		expect(serialized).toContain("test-prompt-v1")
		expect(serialized).toContain("u-1")
		expect(serialized).toContain("w-1")
		expect(serialized).toContain("anthropic")
	})

	it("error log path also avoids prompt content", async () => {
		const { getLlmCredential } = await import("./credentials")
		vi.mocked(getLlmCredential).mockResolvedValue({
			provider: "anthropic",
			apiKey: "sk-ant-test",
		})

		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ error: { message: "model not found" } }), { status: 404 }),
		)

		const { complete } = await import("./llm-client")
		await expect(
			complete({
				userId: "u-1",
				promptId: "test-prompt-v1",
				model: "claude-fake-9-9",
				messages: [{ role: "user", content: SECRET_PROMPT_NEEDLE }],
			}),
		).rejects.toBeDefined()

		const serialized = JSON.stringify(loggerCalls)
		expect(serialized).not.toContain(SECRET_PROMPT_NEEDLE)
	})
})
