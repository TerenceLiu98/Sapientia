import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"

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
			promptId: "agent-summon-v1",
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
			promptId: "agent-summon-v1",
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
						metadata: { model: "glm-5.1", promptId: "agent-summon-v1" },
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
})
