import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { LlmCallError, LlmCredentialMissingError } from "../services/llm-client"

const selectMock = vi.fn()
const streamAgentNoteAnswerMock = vi.fn()

vi.mock("../db", () => ({
	db: {
		select: (...args: Array<unknown>) => selectMock(...args),
	},
}))

vi.mock("../middleware/auth", () => ({
	requireAuth: async (
		c: { set: (key: string, value: unknown) => void },
		next: () => Promise<void>,
	) => {
		c.set("user", { id: "user-1" })
		await next()
	},
}))

vi.mock("../services/agent", () => ({
	streamAgentNoteAnswer: (...args: Array<unknown>) => streamAgentNoteAnswerMock(...args),
}))

describe("agent route", () => {
	beforeEach(() => {
		selectMock.mockReset()
		streamAgentNoteAnswerMock.mockReset()
	})

	it("does not expose the legacy panel chat route", async () => {
		const { agentRoutes } = await import("./agent")
		const app = new Hono()
		app.route("/", agentRoutes)

		const response = await app.request("/agent/ask", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		})

		expect(response.status).toBe(404)
	})

	it("streams a note-native ask answer as text", async () => {
		const workspaceId = "123e4567-e89b-42d3-a456-426614174000"
		mockWorkspaceAccess(workspaceId)
		streamAgentNoteAnswerMock.mockResolvedValue({
			model: "mimo-v2.5-pro",
			promptId: "agent-summon-v2",
			stream: {
				toTextStreamResponse: (init?: ResponseInit) =>
					new Response("Grounded answer [blk blk-1]", {
						...init,
						headers: init?.headers,
					}),
			},
		})

		const { agentRoutes } = await import("./agent")
		const app = new Hono()
		app.route("/", agentRoutes)

		const response = await app.request("/agent/note-ask", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				paperId: "paper-1",
				workspaceId,
				question: "Explain this in one paragraph",
				selectionContext: {
					blockIds: ["blk-1"],
					selectedText: "selected note text",
				},
			}),
		})

		expect(response.status).toBe(200)
		expect(response.headers.get("content-type")).toContain("text/plain")
		expect(await response.text()).toBe("Grounded answer [blk blk-1]")
		expect(streamAgentNoteAnswerMock).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: "user-1",
				workspaceId,
				paperId: "paper-1",
				question: "Explain this in one paragraph",
				selectionContext: {
					blockIds: ["blk-1"],
					selectedText: "selected note text",
				},
				abortSignal: expect.any(AbortSignal),
			}),
		)
	})

	it("maps invalid note ask bodies to 400 before access checks", async () => {
		const { agentRoutes } = await import("./agent")
		const app = new Hono()
		app.route("/", agentRoutes)

		const response = await app.request("/agent/note-ask", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{not json",
		})

		expect(response.status).toBe(400)
		expect(await response.text()).toContain("Invalid request body")
		expect(selectMock).not.toHaveBeenCalled()
		expect(streamAgentNoteAnswerMock).not.toHaveBeenCalled()
	})

	it("preserves workspace access checks", async () => {
		const workspaceId = "123e4567-e89b-42d3-a456-426614174000"
		selectMock.mockReturnValue({
			from: () => ({
				innerJoin: () => ({
					where: () => ({
						limit: async () => [],
					}),
				}),
			}),
		})

		const { agentRoutes } = await import("./agent")
		const app = new Hono()
		app.route("/", agentRoutes)

		const response = await app.request("/agent/note-ask", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				paperId: "paper-1",
				workspaceId,
				question: "Explain this",
			}),
		})

		expect(response.status).toBe(403)
		expect(streamAgentNoteAnswerMock).not.toHaveBeenCalled()
	})

	it("maps missing credentials to a 400 response before streaming", async () => {
		const workspaceId = "123e4567-e89b-42d3-a456-426614174000"
		mockWorkspaceAccess(workspaceId)
		streamAgentNoteAnswerMock.mockRejectedValue(new LlmCredentialMissingError())

		const { agentRoutes } = await import("./agent")
		const app = new Hono()
		app.route("/", agentRoutes)

		const response = await app.request("/agent/note-ask", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				paperId: "paper-1",
				workspaceId,
				question: "Explain this",
			}),
		})

		expect(response.status).toBe(400)
		expect(await response.text()).toContain("No LLM API key configured")
	})

	it("maps permanent upstream auth errors to 401 before streaming", async () => {
		const workspaceId = "123e4567-e89b-42d3-a456-426614174000"
		mockWorkspaceAccess(workspaceId)
		streamAgentNoteAnswerMock.mockRejectedValue(
			new LlmCallError("invalid api key", {
				permanent: true,
				status: 401,
				provider: "anthropic",
			}),
		)

		const { agentRoutes } = await import("./agent")
		const app = new Hono()
		app.route("/", agentRoutes)

		const response = await app.request("/agent/note-ask", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				paperId: "paper-1",
				workspaceId,
				question: "Explain this",
			}),
		})

		expect(response.status).toBe(401)
		expect(await response.text()).toContain("invalid api key")
	})

	it("maps transient upstream errors to 502 before streaming", async () => {
		const workspaceId = "123e4567-e89b-42d3-a456-426614174000"
		mockWorkspaceAccess(workspaceId)
		streamAgentNoteAnswerMock.mockRejectedValue(
			new LlmCallError("upstream unavailable", {
				permanent: false,
				status: 503,
				provider: "anthropic",
			}),
		)

		const { agentRoutes } = await import("./agent")
		const app = new Hono()
		app.route("/", agentRoutes)

		const response = await app.request("/agent/note-ask", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				paperId: "paper-1",
				workspaceId,
				question: "Explain this",
			}),
		})

		expect(response.status).toBe(502)
		expect(await response.text()).toContain("upstream unavailable")
	})
})

function mockWorkspaceAccess(workspaceId: string) {
	selectMock.mockReturnValue({
		from: () => ({
			innerJoin: () => ({
				where: () => ({
					limit: async () => [{ workspaceId }],
				}),
			}),
		}),
	})
}
