import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"

const selectMock = vi.fn()
type MockAuthContext = {
	set: (key: string, value: unknown) => void
}

vi.mock("../db", () => ({
	db: {
		select: (...args: Array<unknown>) => selectMock(...args),
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

describe("wiki route", () => {
	beforeEach(() => {
		selectMock.mockReset()
	})

	it("registers the block concept lens route without requiring a prior wiki request", async () => {
		selectMock.mockReturnValueOnce({
			from: () => ({
				innerJoin: () => ({
					leftJoin: () => ({
						leftJoin: () => ({
							where: () => ({
								orderBy: async () => [],
							}),
						}),
					}),
				}),
			}),
		})

		const { wikiRoutes } = await import("./wiki")
		const app = new Hono()
		app.route("/", wikiRoutes)

		const response = await app.request("/workspaces/ws-1/papers/paper-1/blocks/blk-1/concepts")

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			workspaceId: "ws-1",
			paperId: "paper-1",
			blockId: "blk-1",
			concepts: [],
			semanticCandidates: [],
		})
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
						orderBy: async () => [{ blockId: "blk-2" }, { blockId: "blk-1" }],
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

	it("returns a Cytoscape-ready paper concept graph payload", async () => {
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
								promptVersion: "paper-compile-hierarchical-v1",
								sourcePaperId: "paper-1",
							},
						],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						orderBy: async () => [{ blockId: "blk-2" }],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						orderBy: async () => [
							{
								id: "concept-1",
								kind: "method",
								canonicalName: "transformer",
								displayName: "Transformer",
								status: "done",
								error: null,
								salienceScore: 0.8,
								highlightCount: 2,
								weightedHighlightScore: 2,
								noteCitationCount: 1,
								lastMarginaliaAt: null,
								generatedAt: new Date("2026-05-01T12:00:01.000Z"),
								modelName: "claude-sonnet-4-6",
								promptVersion: "paper-compile-hierarchical-v1",
							},
							{
								id: "concept-2",
								kind: "task",
								canonicalName: "machine translation",
								displayName: "Machine Translation",
								status: "done",
								error: null,
								salienceScore: 0.4,
								highlightCount: 0,
								weightedHighlightScore: 0,
								noteCitationCount: 0,
								lastMarginaliaAt: null,
								generatedAt: new Date("2026-05-01T12:00:02.000Z"),
								modelName: "claude-sonnet-4-6",
								promptVersion: "paper-compile-hierarchical-v1",
							},
							{
								id: "concept-hidden",
								kind: "dataset",
								canonicalName: "wmt 2014",
								displayName: "WMT 2014",
								status: "done",
								error: null,
								salienceScore: 0,
								highlightCount: 0,
								weightedHighlightScore: 0,
								noteCitationCount: 0,
								lastMarginaliaAt: null,
								generatedAt: null,
								modelName: null,
								promptVersion: null,
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
							blockId: "blk-1",
							snippet: "method snippet",
							confidence: 0.9,
						},
						{
							conceptId: "concept-2",
							blockId: "blk-2",
							snippet: "task snippet",
							confidence: 0.8,
						},
						{
							conceptId: "concept-hidden",
							blockId: "blk-3",
							snippet: "hidden dataset snippet",
							confidence: 0.7,
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
								sourceConceptId: "concept-1",
								targetConceptId: "concept-2",
								relationType: "addresses",
								confidence: 0.91,
							},
							{
								id: "edge-hidden",
								sourceConceptId: "concept-1",
								targetConceptId: "concept-hidden",
								relationType: "uses",
								confidence: 0.7,
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
							confidence: 0.91,
						},
						{
							edgeId: "edge-hidden",
							blockId: "blk-3",
							snippet: "hidden edge evidence",
							confidence: 0.7,
						},
					],
				}),
			})

		const { wikiRoutes } = await import("./wiki")
		const app = new Hono()
		app.route("/", wikiRoutes)

		const response = await app.request("/workspaces/ws-1/papers/paper-1/concept-graph")

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			workspaceId: "ws-1",
			paperId: "paper-1",
			sourcePage: {
				id: "page-1",
				displayName: "A Paper",
				status: "done",
				error: null,
				generatedAt: "2026-05-01T12:00:00.000Z",
				modelName: "claude-sonnet-4-6",
				promptVersion: "paper-compile-hierarchical-v1",
				referenceBlockIds: ["blk-2"],
			},
			visibility: {
				defaultNodeKinds: ["concept", "method", "task", "metric"],
				supportingNodeKinds: ["dataset", "person", "organization"],
			},
			graph: {
				nodeCount: 2,
				edgeCount: 1,
				relationCounts: { addresses: 1 },
				nodes: [
					{
						id: "concept-1",
						conceptId: "concept-1",
						label: "Transformer",
						kind: "method",
						canonicalName: "transformer",
						status: "done",
						salienceScore: 0.8,
						highlightCount: 2,
						noteCitationCount: 1,
						degree: 1,
						evidenceBlockIds: ["blk-1"],
					},
					{
						id: "concept-2",
						conceptId: "concept-2",
						label: "Machine Translation",
						kind: "task",
						canonicalName: "machine translation",
						status: "done",
						salienceScore: 0.4,
						highlightCount: 0,
						noteCitationCount: 0,
						degree: 1,
						evidenceBlockIds: ["blk-2"],
					},
				],
				edges: [
					{
						id: "edge-1",
						source: "concept-1",
						target: "concept-2",
						sourceConceptId: "concept-1",
						targetConceptId: "concept-2",
						relationType: "addresses",
						confidence: 0.91,
						evidenceBlockIds: ["blk-2"],
						evidence: [
							{
								blockId: "blk-2",
								snippet: "edge evidence snippet",
								confidence: 0.91,
							},
						],
					},
				],
			},
		})
		})

	it("returns block-level concept lens payload with semantic suggestions", async () => {
		selectMock
			.mockReturnValueOnce({
				from: () => ({
					innerJoin: () => ({
						leftJoin: () => ({
							leftJoin: () => ({
								where: () => ({
									orderBy: async () => [
										{
											conceptId: "concept-1",
											kind: "method",
											canonicalName: "sparse autoencoder",
											displayName: "Sparse Autoencoder",
											status: "done",
											salienceScore: 0.91,
											highlightCount: 1,
											noteCitationCount: 0,
											sourceLevelDescription:
												"This paper uses sparse autoencoders to learn interpretable latent features.",
											sourceLevelDescriptionStatus: "done",
											readerSignalSummary: "Reader highlighted this concept.",
											evidenceSnippet: "SAE evidence",
											evidenceConfidence: 0.88,
											clusterId: "cluster-1",
											clusterDisplayName: "Sparse Autoencoder",
											clusterCanonicalName: "sparse autoencoder",
											clusterKind: "method",
											clusterMemberCount: 2,
											clusterPaperCount: 2,
										},
										{
											conceptId: "hidden-dataset",
											kind: "dataset",
											canonicalName: "imagenet",
											displayName: "ImageNet",
											status: "done",
											salienceScore: 0,
											highlightCount: 0,
											noteCitationCount: 0,
											sourceLevelDescription: "Dataset description.",
											sourceLevelDescriptionStatus: "done",
											readerSignalSummary: null,
											evidenceSnippet: "dataset evidence",
											evidenceConfidence: 0.6,
											clusterId: "cluster-hidden",
											clusterDisplayName: "ImageNet",
											clusterCanonicalName: "imagenet",
											clusterKind: "dataset",
											clusterMemberCount: 1,
											clusterPaperCount: 1,
										},
									],
								}),
							}),
						}),
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						orderBy: async () => [
							{
								id: "candidate-1",
								sourceLocalConceptId: "concept-1",
								targetLocalConceptId: "concept-2",
								sourceClusterId: "cluster-1",
								targetClusterId: "cluster-2",
								kind: "method",
								matchMethod: "embedding",
								similarityScore: 0.79,
								llmDecision: "related",
								decisionStatus: "needs_review",
								rationale: "llm=related; confidence=0.8; variant relationship",
							},
						],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: async () => [
						{
							id: "cluster-1",
							kind: "method",
							displayName: "Sparse Autoencoder",
							canonicalName: "sparse autoencoder",
							memberCount: 2,
							paperCount: 2,
						},
						{
							id: "cluster-2",
							kind: "method",
							displayName: "Top-K SAE",
							canonicalName: "top-k sae",
							memberCount: 1,
							paperCount: 1,
						},
					],
				}),
			})

		const { wikiRoutes } = await import("./wiki")
		const app = new Hono()
		app.route("/", wikiRoutes)

		const response = await app.request("/workspaces/ws-1/papers/paper-1/blocks/blk-1/concepts")

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			workspaceId: "ws-1",
			paperId: "paper-1",
			blockId: "blk-1",
			concepts: [
				{
					id: "concept-1",
					kind: "method",
					canonicalName: "sparse autoencoder",
					displayName: "Sparse Autoencoder",
					status: "done",
					salienceScore: 0.91,
					highlightCount: 1,
					noteCitationCount: 0,
					sourceLevelDescription:
						"This paper uses sparse autoencoders to learn interpretable latent features.",
					sourceLevelDescriptionStatus: "done",
					readerSignalSummary: "Reader highlighted this concept.",
					evidence: {
						blockId: "blk-1",
						snippet: "SAE evidence",
						confidence: 0.88,
					},
					cluster: {
						id: "cluster-1",
						displayName: "Sparse Autoencoder",
						canonicalName: "sparse autoencoder",
						kind: "method",
						memberCount: 2,
						paperCount: 2,
					},
				},
			],
			semanticCandidates: [
				{
					id: "candidate-1",
					sourceClusterId: "cluster-1",
					targetClusterId: "cluster-2",
					sourceLocalConceptId: "concept-1",
					targetLocalConceptId: "concept-2",
					kind: "method",
					matchMethod: "embedding",
					similarityScore: 0.79,
					llmDecision: "related",
					decisionStatus: "needs_review",
					rationale: "llm=related; confidence=0.8; variant relationship",
					relatedCluster: {
						id: "cluster-2",
						displayName: "Top-K SAE",
						canonicalName: "top-k sae",
						kind: "method",
						memberCount: 1,
						paperCount: 1,
					},
				},
			],
		})
	})

	it("returns a pending payload when the source page does not exist yet", async () => {
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

		expect(response.status).toBe(202)
		expect(await response.json()).toEqual({
			page: {
				id: "pending:paper-1",
				type: "source",
				canonicalName: "paper:paper-1",
				displayName: "Paper wiki is compiling",
				body: null,
				status: "pending",
				error: null,
				generatedAt: null,
				modelName: null,
				promptVersion: null,
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
