import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"

const selectMock = vi.fn()

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

describe("wiki route", () => {
	beforeEach(() => {
		selectMock.mockReset()
	})

	it("returns a source page with references and local concepts", async () => {
		selectMock
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						limit: async () => [
							{
								id: "page-1",
								type: "source",
								canonicalName: "paper:paper-1",
								displayName: "A Paper",
								body: "## Overview",
								status: "done",
								error: null,
								generatedAt: new Date("2026-05-01T12:00:00.000Z"),
								modelName: "claude-sonnet-4-6",
								promptVersion: "paper-compile-v1",
								sourcePaperId: "paper-1",
							},
						],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						orderBy: async () => [
							{ blockId: "blk-2" },
							{ blockId: "blk-1" },
						],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						orderBy: async () => [
							{
								id: "concept-1",
								kind: "metric",
								canonicalName: "f1 score",
								displayName: "F1 score",
								status: "done",
								error: null,
								salienceScore: 0,
								highlightCount: 0,
								weightedHighlightScore: 0,
								noteCitationCount: 0,
								lastMarginaliaAt: null,
								generatedAt: new Date("2026-05-01T12:00:01.000Z"),
								modelName: "claude-sonnet-4-6",
								promptVersion: "paper-compile-v1",
							},
							{
								id: "concept-2",
								kind: "task",
								canonicalName: "question answering",
								displayName: "Question Answering",
								status: "done",
								error: null,
								salienceScore: 0,
								highlightCount: 0,
								weightedHighlightScore: 0,
								noteCitationCount: 0,
								lastMarginaliaAt: null,
								generatedAt: new Date("2026-05-01T12:00:02.000Z"),
								modelName: "claude-sonnet-4-6",
								promptVersion: "paper-compile-v1",
							},
						],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: async () => [
						{
							conceptId: "concept-1",
							blockId: "blk-2",
							snippet: "metric snippet",
							confidence: 0.88,
						},
						{
							conceptId: "concept-2",
							blockId: "blk-1",
							snippet: "task snippet",
							confidence: 0.8,
						},
					],
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						orderBy: async () => [
							{
								id: "edge-1",
								sourceConceptId: "concept-2",
								targetConceptId: "concept-1",
								relationType: "measured_by",
								confidence: 0.93,
							},
						],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: async () => [
						{
							edgeId: "edge-1",
							blockId: "blk-2",
							snippet: "edge evidence snippet",
							confidence: 0.93,
						},
					],
				}),
			})

		const { wikiRoutes } = await import("./wiki")
		const app = new Hono()
		app.route("/", wikiRoutes)

		const response = await app.request("/workspaces/ws-1/papers/paper-1/wiki")

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			page: {
				id: "page-1",
				type: "source",
				canonicalName: "paper:paper-1",
				displayName: "A Paper",
				body: "## Overview",
				status: "done",
				error: null,
				generatedAt: "2026-05-01T12:00:00.000Z",
				modelName: "claude-sonnet-4-6",
				promptVersion: "paper-compile-v1",
				sourcePaperId: "paper-1",
				referenceBlockIds: ["blk-2", "blk-1"],
			},
			concepts: [
				{
					id: "concept-1",
					kind: "metric",
					canonicalName: "f1 score",
					displayName: "F1 score",
					status: "done",
					error: null,
					salienceScore: 0,
					highlightCount: 0,
					weightedHighlightScore: 0,
					noteCitationCount: 0,
					lastMarginaliaAt: null,
					generatedAt: "2026-05-01T12:00:01.000Z",
					modelName: "claude-sonnet-4-6",
					promptVersion: "paper-compile-v1",
					evidence: [
						{
							blockId: "blk-2",
							snippet: "metric snippet",
							confidence: 0.88,
						},
					],
				},
				{
					id: "concept-2",
					kind: "task",
					canonicalName: "question answering",
					displayName: "Question Answering",
					status: "done",
					error: null,
					salienceScore: 0,
					highlightCount: 0,
					weightedHighlightScore: 0,
					noteCitationCount: 0,
					lastMarginaliaAt: null,
					generatedAt: "2026-05-01T12:00:02.000Z",
					modelName: "claude-sonnet-4-6",
					promptVersion: "paper-compile-v1",
					evidence: [
						{
							blockId: "blk-1",
							snippet: "task snippet",
							confidence: 0.8,
						},
					],
				},
			],
			innerGraph: {
				edgeCount: 1,
				relationCounts: {
					measured_by: 1,
				},
				edges: [
					{
						id: "edge-1",
						sourceConceptId: "concept-2",
						targetConceptId: "concept-1",
						relationType: "measured_by",
						confidence: 0.93,
						evidence: [
							{
								blockId: "blk-2",
								snippet: "edge evidence snippet",
								confidence: 0.93,
							},
						],
					},
				],
			},
		})
	})

	it("returns 404 when the source page does not exist", async () => {
		selectMock.mockReturnValueOnce({
			from: () => ({
				where: () => ({
					limit: async () => [],
				}),
			}),
		})

		const { wikiRoutes } = await import("./wiki")
		const app = new Hono()
		app.route("/", wikiRoutes)

		const response = await app.request("/workspaces/ws-1/papers/paper-1/wiki")

		expect(response.status).toBe(404)
		expect(await response.json()).toEqual({ error: "wiki page not found" })
	})

	it("returns a pending source page before compilation finishes", async () => {
		selectMock
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						limit: async () => [
							{
								id: "page-1",
								type: "source",
								canonicalName: "paper:paper-1",
								displayName: "A Paper",
								body: null,
								status: "pending",
								error: null,
								generatedAt: null,
								modelName: null,
								promptVersion: "paper-compile-v1",
								sourcePaperId: "paper-1",
							},
						],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						orderBy: async () => [],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						orderBy: async () => [],
					}),
				}),
			})

		const { wikiRoutes } = await import("./wiki")
		const app = new Hono()
		app.route("/", wikiRoutes)

		const response = await app.request("/workspaces/ws-1/papers/paper-1/wiki")

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			page: {
				id: "page-1",
				type: "source",
				canonicalName: "paper:paper-1",
				displayName: "A Paper",
				body: null,
				status: "pending",
				error: null,
				generatedAt: null,
				modelName: null,
				promptVersion: "paper-compile-v1",
				sourcePaperId: "paper-1",
				referenceBlockIds: [],
			},
			concepts: [],
			innerGraph: {
				edgeCount: 0,
				relationCounts: {},
				edges: [],
			},
		})
	})
})
