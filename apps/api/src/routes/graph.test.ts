import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"

const selectMock = vi.fn()
const updateMock = vi.fn()
type MockAuthContext = {
	set: (key: string, value: unknown) => void
}

vi.mock("../db", () => ({
	db: {
		select: (...args: Array<unknown>) => selectMock(...args),
		update: (...args: Array<unknown>) => updateMock(...args),
	},
}))

vi.mock("../middleware/auth", () => ({
	requireAuth: async (c: MockAuthContext, next: () => Promise<void>) => {
		c.set("user", { id: "user-1" })
		await next()
	},
}))

vi.mock("../middleware/workspace", () => ({
	requireMembership: () => async (_c: unknown, next: () => Promise<void>) => {
		await next()
	},
}))

describe("graph route", () => {
	beforeEach(() => {
		selectMock.mockReset()
		updateMock.mockReset()
	})

	it("returns a workspace concept graph from clusters and projected local edges", async () => {
		selectMock
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						orderBy: async () => [
							{
								id: "cluster-1",
								kind: "method",
								canonicalName: "transformer",
								displayName: "Transformer",
								memberCount: 2,
								paperCount: 2,
								salienceScore: 0.8,
								confidence: 1,
								status: "done",
								updatedAt: new Date("2026-05-02T10:00:00.000Z"),
							},
							{
								id: "cluster-2",
								kind: "task",
								canonicalName: "machine translation",
								displayName: "Machine Translation",
								memberCount: 1,
								paperCount: 1,
								salienceScore: 0.4,
								confidence: 1,
								status: "done",
								updatedAt: new Date("2026-05-02T10:01:00.000Z"),
							},
							{
								id: "cluster-hidden",
								kind: "dataset",
								canonicalName: "wmt 2014",
								displayName: "WMT 2014",
								memberCount: 1,
								paperCount: 1,
								salienceScore: 0,
								confidence: 1,
								status: "done",
								updatedAt: new Date("2026-05-02T10:02:00.000Z"),
							},
						],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					innerJoin: () => ({
						innerJoin: () => ({
							where: async () => [
								{
									clusterId: "cluster-1",
									localConceptId: "concept-1a",
									paperId: "paper-1",
									paperTitle: "Attention Is All You Need",
									displayName: "Transformer",
									canonicalName: "transformer",
									salienceScore: 0.5,
								},
								{
									clusterId: "cluster-1",
									localConceptId: "concept-1b",
									paperId: "paper-2",
									paperTitle: "Another Transformer Paper",
									displayName: "Transformer",
									canonicalName: "transformer",
									salienceScore: 0.3,
								},
								{
									clusterId: "cluster-2",
									localConceptId: "concept-2",
									paperId: "paper-1",
									paperTitle: "Attention Is All You Need",
									displayName: "Machine Translation",
									canonicalName: "machine translation",
									salienceScore: 0.4,
								},
							],
						}),
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: async () => [
						{ conceptId: "concept-1a", blockId: "blk-1" },
						{ conceptId: "concept-1b", blockId: "blk-9" },
						{ conceptId: "concept-2", blockId: "blk-2" },
					],
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						orderBy: async () => [
							{
								id: "edge-1",
								sourceConceptId: "concept-1a",
								targetConceptId: "concept-2",
								paperId: "paper-1",
								relationType: "addresses",
								confidence: 0.91,
							},
							{
								id: "edge-hidden",
								sourceConceptId: "concept-1a",
								targetConceptId: "concept-1b",
								paperId: "paper-1",
								relationType: "uses",
								confidence: 0.75,
							},
						],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: async () => [{ edgeId: "edge-1", blockId: "blk-2" }],
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						orderBy: async () => [
							{
								id: "candidate-1",
								sourceLocalConceptId: "concept-1b",
								targetLocalConceptId: "concept-2",
								sourceClusterId: "cluster-1",
								targetClusterId: "cluster-2",
								kind: "method",
									matchMethod: "lexical_source_description",
									similarityScore: 0.72,
									llmDecision: "related",
									decisionStatus: "needs_review",
									rationale: "name=0.5; description=0.82; containment=0.67",
							},
						],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						groupBy: async () => [
							{ decisionStatus: "needs_review", count: 1 },
							{ decisionStatus: "user_accepted", count: 2 },
						],
					}),
				}),
			})

		const { graphRoutes } = await import("./graph")
		const app = new Hono()
		app.route("/", graphRoutes)

		const response = await app.request("/workspaces/ws-1/graph")

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			workspaceId: "ws-1",
			visibility: {
				defaultNodeKinds: ["concept", "method", "task", "metric"],
				supportingNodeKinds: ["dataset", "person", "organization"],
			},
			graph: {
					nodeCount: 2,
					edgeCount: 1,
					relationCounts: { addresses: 1 },
					semanticCandidateCounts: {
						total: 3,
						needsReview: 1,
						userAccepted: 2,
						userRejected: 0,
					},
					nodes: [
					{
						id: "cluster-1",
						clusterId: "cluster-1",
						conceptId: "cluster-1",
						label: "Transformer",
						kind: "method",
						canonicalName: "transformer",
						status: "done",
						memberCount: 2,
						paperCount: 2,
						salienceScore: 0.8,
						confidence: 1,
						updatedAt: "2026-05-02T10:00:00.000Z",
						degree: 1,
						evidenceBlockIds: ["blk-1", "blk-9"],
						members: [
							{
								localConceptId: "concept-1a",
								paperId: "paper-1",
								paperTitle: "Attention Is All You Need",
								displayName: "Transformer",
								canonicalName: "transformer",
								salienceScore: 0.5,
								evidenceBlockIds: ["blk-1"],
							},
							{
								localConceptId: "concept-1b",
								paperId: "paper-2",
								paperTitle: "Another Transformer Paper",
								displayName: "Transformer",
								canonicalName: "transformer",
								salienceScore: 0.3,
								evidenceBlockIds: ["blk-9"],
							},
						],
					},
					{
						id: "cluster-2",
						clusterId: "cluster-2",
						conceptId: "cluster-2",
						label: "Machine Translation",
						kind: "task",
						canonicalName: "machine translation",
						status: "done",
						memberCount: 1,
						paperCount: 1,
						salienceScore: 0.4,
						confidence: 1,
						updatedAt: "2026-05-02T10:01:00.000Z",
						degree: 1,
						evidenceBlockIds: ["blk-2"],
						members: [
							{
								localConceptId: "concept-2",
								paperId: "paper-1",
								paperTitle: "Attention Is All You Need",
								displayName: "Machine Translation",
								canonicalName: "machine translation",
								salienceScore: 0.4,
								evidenceBlockIds: ["blk-2"],
							},
						],
					},
				],
				edges: [
					{
						id: "cluster-edge:cluster-1:cluster-2:addresses",
						source: "cluster-1",
						target: "cluster-2",
						sourceConceptId: "cluster-1",
						targetConceptId: "cluster-2",
						relationType: "addresses",
						confidence: 0.91,
						evidenceBlockIds: ["blk-2"],
						localEdgeCount: 1,
					},
				],
				semanticCandidates: [
					{
						id: "candidate-1",
						source: "cluster-1",
						target: "cluster-2",
						sourceConceptId: "cluster-1",
						targetConceptId: "cluster-2",
						sourceLocalConceptId: "concept-1b",
						targetLocalConceptId: "concept-2",
						kind: "method",
							matchMethod: "lexical_source_description",
							similarityScore: 0.72,
							llmDecision: "related",
							decisionStatus: "needs_review",
							rationale: "name=0.5; description=0.82; containment=0.67",
					},
				],
			},
		})
	})

	it("marks semantic candidates as user-reviewed without merging clusters", async () => {
		updateMock.mockReturnValueOnce({
			set: () => ({
				where: () => ({
					returning: async () => [
						{
							id: "candidate-1",
							decisionStatus: "user_rejected",
						},
					],
				}),
			}),
		})

		const { graphRoutes } = await import("./graph")
		const app = new Hono()
		app.route("/", graphRoutes)

		const response = await app.request("/workspaces/ws-1/graph/semantic-candidates/candidate-1", {
			body: JSON.stringify({ decisionStatus: "user_rejected" }),
			headers: { "content-type": "application/json" },
			method: "PATCH",
		})

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			id: "candidate-1",
			decisionStatus: "user_rejected",
		})
		expect(updateMock).toHaveBeenCalledOnce()
	})
})
