import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { LlmCallError, LlmCredentialMissingError } from "../services/llm-client"

const selectMock = vi.fn()
const streamAgentAnswerMock = vi.fn()

vi.mock("../db", () => ({
	db: {
		select: (...args: Array<unknown>) => selectMock(...args),
	},
}))

vi.mock("../middleware/auth", () => ({
	requireAuth: async (c: any, next: () => Promise<void>) => {
		c.set("user", { id: "user-1" })
		await next()
	},
}))

vi.mock("../services/agent", () => ({
	streamAgentAnswer: (...args: Array<unknown>) => streamAgentAnswerMock(...args),
}))

describe("agent route", () => {
	beforeEach(() => {
		selectMock.mockReset()
		streamAgentAnswerMock.mockReset()
	})

	it("returns an AI SDK-style event stream response", async () => {
		const workspaceId = "123e4567-e89b-42d3-a456-426614174000"
		selectMock.mockReturnValue({
			from: () => ({
				innerJoin: () => ({
					where: () => ({
						limit: async () => [{ workspaceId }],
					}),
				}),
			}),
		})

		streamAgentAnswerMock.mockResolvedValue({
			model: "claude-sonnet-4-6",
			promptId: "agent-summon-v2",
			stream: {
				toUIMessageStreamResponse: () =>
					new Response("data: {\"type\":\"start\"}\n\ndata: {\"type\":\"finish\"}\n\n", {
						headers: { "content-type": "text/event-stream; charset=utf-8" },
					}),
			},
		})

		const { agentRoutes } = await import("./agent")
		const app = new Hono()
		app.route("/", agentRoutes)

		const response = await app.request("/agent/ask", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				paperId: "paper-1",
				workspaceId,
				messages: [
					{
						id: "msg-1",
						role: "user",
						parts: [{ type: "text", text: "What is happening here?" }],
					},
				],
			}),
		})

		expect(response.status).toBe(200)
		expect(response.headers.get("content-type")).toContain("text/event-stream")
		expect(await response.text()).toContain('data: {"type":"start"}')
		expect(streamAgentAnswerMock).toHaveBeenCalled()
	})

	it("drops empty placeholder messages before validating and streaming", async () => {
		const workspaceId = "123e4567-e89b-42d3-a456-426614174000"
		selectMock.mockReturnValue({
			from: () => ({
				innerJoin: () => ({
					where: () => ({
						limit: async () => [{ workspaceId }],
					}),
				}),
			}),
		})

		streamAgentAnswerMock.mockResolvedValue({
			model: "claude-sonnet-4-6",
			promptId: "agent-summon-v2",
			stream: {
				toUIMessageStreamResponse: () =>
					new Response("data: {\"type\":\"finish\"}\n\n", {
						headers: { "content-type": "text/event-stream; charset=utf-8" },
					}),
			},
		})

		const { agentRoutes } = await import("./agent")
		const app = new Hono()
		app.route("/", agentRoutes)

		const response = await app.request("/agent/ask", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				paperId: "paper-1",
				workspaceId,
				messages: [
					{
						id: "msg-1",
						role: "user",
						parts: [{ type: "text", text: "First question" }],
					},
					{
						id: "msg-2",
						role: "assistant",
						metadata: { model: "glm-5.1", promptId: "agent-summon-v2" },
						parts: [],
					},
					{
						id: "msg-3",
						role: "user",
						parts: [{ type: "text", text: "Second question" }],
					},
				],
			}),
		})

		expect(response.status).toBe(200)
		expect(streamAgentAnswerMock).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [
					expect.objectContaining({ id: "msg-1" }),
					expect.objectContaining({ id: "msg-3" }),
				],
			}),
		)
	})

	it("passes selectionContext through to the agent service", async () => {
		const workspaceId = "123e4567-e89b-42d3-a456-426614174000"
		selectMock.mockReturnValue({
			from: () => ({
				innerJoin: () => ({
					where: () => ({
						limit: async () => [{ workspaceId }],
					}),
				}),
			}),
		})

		streamAgentAnswerMock.mockResolvedValue({
			model: "claude-sonnet-4-6",
			promptId: "agent-summon-v2",
			stream: {
				toUIMessageStreamResponse: () =>
					new Response("data: {\"type\":\"finish\"}\n\n", {
						headers: { "content-type": "text/event-stream; charset=utf-8" },
					}),
			},
		})

		const { agentRoutes } = await import("./agent")
		const app = new Hono()
		app.route("/", agentRoutes)

		const response = await app.request("/agent/ask", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				paperId: "paper-1",
				workspaceId,
				messages: [
					{
						id: "msg-1",
						role: "user",
						parts: [{ type: "text", text: "What does this selected text mean?" }],
					},
				],
				selectionContext: {
					blockIds: ["blk-1", "blk-2"],
					selectedText: "selected snippet",
				},
			}),
		})

		expect(response.status).toBe(200)
		expect(streamAgentAnswerMock).toHaveBeenCalledWith(
			expect.objectContaining({
				selectionContext: {
					blockIds: ["blk-1", "blk-2"],
					selectedText: "selected snippet",
				},
			}),
		)
	})

	it("passes the request abort signal through to the agent service", async () => {
		const workspaceId = "123e4567-e89b-42d3-a456-426614174000"
		selectMock.mockReturnValue({
			from: () => ({
				innerJoin: () => ({
					where: () => ({
						limit: async () => [{ workspaceId }],
					}),
				}),
			}),
		})

		streamAgentAnswerMock.mockResolvedValue({
			model: "claude-sonnet-4-6",
			promptId: "agent-summon-v2",
			stream: {
				toUIMessageStreamResponse: () =>
					new Response("data: {\"type\":\"finish\"}\n\n", {
						headers: { "content-type": "text/event-stream; charset=utf-8" },
					}),
			},
		})

		const { agentRoutes } = await import("./agent")
		const app = new Hono()
		app.route("/", agentRoutes)

		await app.request("/agent/ask", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				paperId: "paper-1",
				workspaceId,
				messages: [
					{
						id: "msg-1",
						role: "user",
						parts: [{ type: "text", text: "What does this mean?" }],
					},
				],
			}),
		})

		expect(streamAgentAnswerMock).toHaveBeenCalledWith(
			expect.objectContaining({
				abortSignal: expect.any(AbortSignal),
			}),
		)
	})

	it("maps missing credentials to a 400 response", async () => {
		const workspaceId = "123e4567-e89b-42d3-a456-426614174000"
		selectMock.mockReturnValue({
			from: () => ({
				innerJoin: () => ({
					where: () => ({
						limit: async () => [{ workspaceId }],
					}),
				}),
			}),
		})

		streamAgentAnswerMock.mockRejectedValue(new LlmCredentialMissingError())

		const { agentRoutes } = await import("./agent")
		const app = new Hono()
		app.route("/", agentRoutes)

		const response = await app.request("/agent/ask", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				paperId: "paper-1",
				workspaceId,
				messages: [
					{
						id: "msg-1",
						role: "user",
						parts: [{ type: "text", text: "What does this mean?" }],
					},
				],
			}),
		})

		expect(response.status).toBe(400)
		expect(await response.text()).toContain("No LLM API key configured")
	})

	it("maps permanent upstream auth errors to 401", async () => {
		const workspaceId = "123e4567-e89b-42d3-a456-426614174000"
		selectMock.mockReturnValue({
			from: () => ({
				innerJoin: () => ({
					where: () => ({
						limit: async () => [{ workspaceId }],
					}),
				}),
			}),
		})

		streamAgentAnswerMock.mockRejectedValue(
			new LlmCallError("invalid api key", {
				permanent: true,
				status: 401,
				provider: "anthropic",
			}),
		)

		const { agentRoutes } = await import("./agent")
		const app = new Hono()
		app.route("/", agentRoutes)

		const response = await app.request("/agent/ask", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				paperId: "paper-1",
				workspaceId,
				messages: [
					{
						id: "msg-1",
						role: "user",
						parts: [{ type: "text", text: "What does this mean?" }],
					},
				],
			}),
		})

		expect(response.status).toBe(401)
		expect(await response.text()).toContain("invalid api key")
	})

	it("maps transient upstream errors to 502", async () => {
		const workspaceId = "123e4567-e89b-42d3-a456-426614174000"
		selectMock.mockReturnValue({
			from: () => ({
				innerJoin: () => ({
					where: () => ({
						limit: async () => [{ workspaceId }],
					}),
				}),
			}),
		})

		streamAgentAnswerMock.mockRejectedValue(
			new LlmCallError("upstream unavailable", {
				permanent: false,
				status: 503,
				provider: "anthropic",
			}),
		)

		const { agentRoutes } = await import("./agent")
		const app = new Hono()
		app.route("/", agentRoutes)

		const response = await app.request("/agent/ask", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				paperId: "paper-1",
				workspaceId,
				messages: [
					{
						id: "msg-1",
						role: "user",
						parts: [{ type: "text", text: "What does this mean?" }],
					},
				],
			}),
		})

		expect(response.status).toBe(502)
		expect(await response.text()).toContain("upstream unavailable")
	})
})
