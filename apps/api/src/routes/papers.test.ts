import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"

const selectMock = vi.fn()
const updateMock = vi.fn()
const enqueuePaperParseMock = vi.fn()
const enqueuePaperSummarizeMock = vi.fn()
const userCanAccessPaperMock = vi.fn()
const markPaperCompilePendingMock = vi.fn()

vi.mock("../db", () => ({
	db: {
		select: (...args: Array<unknown>) => selectMock(...args),
		update: (...args: Array<unknown>) => updateMock(...args),
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

vi.mock("../middleware/workspace", () => ({
	requireMembership: () => async (_c: unknown, next: () => Promise<void>) => {
		await next()
	},
}))

vi.mock("../queues/paper-summarize", () => ({
	enqueuePaperSummarize: (...args: Array<unknown>) => enqueuePaperSummarizeMock(...args),
}))

vi.mock("../queues/paper-parse", () => ({
	enqueuePaperParse: (...args: Array<unknown>) => enqueuePaperParseMock(...args),
}))

vi.mock("../services/paper-compile", () => ({
	markPaperCompilePending: (...args: Array<unknown>) => markPaperCompilePendingMock(...args),
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
		updateMock.mockReset()
		enqueuePaperParseMock.mockReset()
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

	it("queues a knowledge retry for an accessible parsed paper", async () => {
		selectMock.mockReturnValue({
			from: () => ({
				where: () => ({
					limit: async () => [
						{
							id: "paper-1",
							deletedAt: null,
							parseStatus: "done",
							summaryStatus: "failed",
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

		const response = await app.request("/papers/paper-1/retry-knowledge", { method: "POST" })

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

	it("returns 409 when retrying knowledge before parse is ready", async () => {
		selectMock.mockReturnValue({
			from: () => ({
				where: () => ({
					limit: async () => [
						{
							id: "paper-1",
							deletedAt: null,
							parseStatus: "parsing",
						},
					],
				}),
			}),
		})
		userCanAccessPaperMock.mockResolvedValue(true)

		const { paperRoutes } = await import("./papers")
		const app = new Hono()
		app.route("/", paperRoutes)

		const response = await app.request("/papers/paper-1/retry-knowledge", { method: "POST" })

		expect(response.status).toBe(409)
		expect(markPaperCompilePendingMock).not.toHaveBeenCalled()
		expect(enqueuePaperSummarizeMock).not.toHaveBeenCalled()
		expect(await response.json()).toEqual({ error: "paper parse not ready" })
	})

	it("queues a forced parse retry for an owned failed paper", async () => {
		const queuedPaper = {
			id: "paper-1",
			ownerUserId: "user-1",
			deletedAt: null,
			parseStatus: "pending",
			parseError: null,
			parseProgressExtracted: null,
			parseProgressTotal: null,
		}
		selectMock.mockReturnValue({
			from: () => ({
				where: () => ({
					limit: async () => [
						{
							...queuedPaper,
							parseStatus: "failed",
							parseError: "MinerU parse failed",
						},
					],
				}),
			}),
		})
		updateMock.mockReturnValue({
			set: () => ({
				where: () => ({
					returning: async () => [queuedPaper],
				}),
			}),
		})
		userCanAccessPaperMock.mockResolvedValue(true)
		enqueuePaperParseMock.mockResolvedValue(undefined)

		const { paperRoutes } = await import("./papers")
		const app = new Hono()
		app.route("/", paperRoutes)

		const response = await app.request("/papers/paper-1/retry-parse", { method: "POST" })

		expect(response.status).toBe(202)
		expect(enqueuePaperParseMock).toHaveBeenCalledWith(
			{ paperId: "paper-1", userId: "user-1", reuseExistingMineruZip: true },
			{ force: true },
		)
		expect(await response.json()).toEqual({
			ok: true,
			status: "queued",
			paper: queuedPaper,
			queue: "paper-parse",
		})
	})

	it("returns 409 when retrying a paper whose parse has not failed", async () => {
		selectMock.mockReturnValue({
			from: () => ({
				where: () => ({
					limit: async () => [
						{
							id: "paper-1",
							ownerUserId: "user-1",
							deletedAt: null,
							parseStatus: "parsing",
						},
					],
				}),
			}),
		})
		userCanAccessPaperMock.mockResolvedValue(true)

		const { paperRoutes } = await import("./papers")
		const app = new Hono()
		app.route("/", paperRoutes)

		const response = await app.request("/papers/paper-1/retry-parse", { method: "POST" })

		expect(response.status).toBe(409)
		expect(enqueuePaperParseMock).not.toHaveBeenCalled()
		expect(await response.json()).toEqual({ error: "paper parse is not failed" })
	})

	it("returns 403 when a non-owner retries parsing", async () => {
		selectMock.mockReturnValue({
			from: () => ({
				where: () => ({
					limit: async () => [
						{
							id: "paper-1",
							ownerUserId: "owner-1",
							deletedAt: null,
							parseStatus: "failed",
						},
					],
				}),
			}),
		})
		userCanAccessPaperMock.mockResolvedValue(true)

		const { paperRoutes } = await import("./papers")
		const app = new Hono()
		app.route("/", paperRoutes)

		const response = await app.request("/papers/paper-1/retry-parse", { method: "POST" })

		expect(response.status).toBe(403)
		expect(enqueuePaperParseMock).not.toHaveBeenCalled()
		expect(await response.json()).toEqual({
			error: "only the owner can retry parsing this paper",
		})
	})
})
