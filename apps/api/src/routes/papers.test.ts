import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"

const selectMock = vi.fn()
const enqueuePaperSummarizeMock = vi.fn()
const userCanAccessPaperMock = vi.fn()
const markPaperCompilePendingMock = vi.fn()

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

vi.mock("../middleware/workspace", () => ({
	requireMembership: () => async (_c: any, next: () => Promise<void>) => {
		await next()
	},
}))

vi.mock("../queues/paper-summarize", () => ({
	enqueuePaperSummarize: (...args: Array<unknown>) => enqueuePaperSummarizeMock(...args),
}))

vi.mock("../services/paper-compile", () => ({
	markPaperCompilePending: (...args: Array<unknown>) =>
		markPaperCompilePendingMock(...args),
}))

vi.mock("../services/paper", async () => {
	const actual = await vi.importActual<typeof import("../services/paper")>("../services/paper")
	return {
		...actual,
		userCanAccessPaper: (...args: Array<unknown>) => userCanAccessPaperMock(...args),
	}
})

describe("paper route", () => {
	beforeEach(() => {
		selectMock.mockReset()
		enqueuePaperSummarizeMock.mockReset()
		userCanAccessPaperMock.mockReset()
		markPaperCompilePendingMock.mockReset()
	})

	it("queues paper compilation for an accessible parsed paper", async () => {
		selectMock.mockReturnValue({
			from: () => ({
				where: () => ({
					limit: async () => [
						{
							id: "paper-1",
							deletedAt: null,
							parseStatus: "done",
						},
					],
				}),
			}),
		})
		userCanAccessPaperMock.mockResolvedValue(true)
		markPaperCompilePendingMock.mockResolvedValue(undefined)
		enqueuePaperSummarizeMock.mockResolvedValue(undefined)

		const { paperRoutes } = await import("./papers")
		const app = new Hono()
		app.route("/", paperRoutes)

		const response = await app.request("/papers/paper-1/compile-wiki", { method: "POST" })

		expect(response.status).toBe(202)
		expect(markPaperCompilePendingMock).toHaveBeenCalledWith({
			paperId: "paper-1",
			userId: "user-1",
		})
		expect(enqueuePaperSummarizeMock).toHaveBeenCalledWith({
			paperId: "paper-1",
			userId: "user-1",
			force: true,
		})
		expect(await response.json()).toEqual({
			ok: true,
			status: "queued",
			paperId: "paper-1",
			queue: "paper-summarize",
		})
	})

	it("returns 409 when the paper parse is not ready", async () => {
		selectMock.mockReturnValue({
			from: () => ({
				where: () => ({
					limit: async () => [
						{
							id: "paper-1",
							deletedAt: null,
							parseStatus: "pending",
						},
					],
				}),
			}),
		})
		userCanAccessPaperMock.mockResolvedValue(true)

		const { paperRoutes } = await import("./papers")
		const app = new Hono()
		app.route("/", paperRoutes)

		const response = await app.request("/papers/paper-1/compile-wiki", { method: "POST" })

		expect(response.status).toBe(409)
		expect(markPaperCompilePendingMock).not.toHaveBeenCalled()
		expect(enqueuePaperSummarizeMock).not.toHaveBeenCalled()
		expect(await response.json()).toEqual({ error: "paper parse not ready" })
	})
})
