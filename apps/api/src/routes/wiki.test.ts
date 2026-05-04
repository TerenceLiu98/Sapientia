import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"

const selectMock = vi.fn()
const { loadBlockConceptLensPayloadMock, loadConceptLensPayloadMock } = vi.hoisted(() => ({
	loadBlockConceptLensPayloadMock: vi.fn(),
	loadConceptLensPayloadMock: vi.fn(),
}))
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

vi.mock("../services/concept-lens", () => ({
	loadBlockConceptLensPayload: (...args: Array<unknown>) =>
		loadBlockConceptLensPayloadMock(...args),
	loadConceptLensPayload: (...args: Array<unknown>) => loadConceptLensPayloadMock(...args),
}))

describe("wiki route", () => {
	beforeEach(() => {
		selectMock.mockReset()
		loadBlockConceptLensPayloadMock.mockReset()
		loadConceptLensPayloadMock.mockReset()
	})

	it("registers the block concept lens route without requiring a prior wiki request", async () => {
		loadBlockConceptLensPayloadMock.mockResolvedValueOnce({
			workspaceId: "ws-1",
			paperId: "paper-1",
			blockId: "blk-1",
			scope: "block",
			context: {
				paper: null,
				block: null,
				note: null,
				annotation: null,
				conceptId: null,
			},
			concepts: [],
			semanticCandidates: [],
			relatedPapers: [],
			freshness: {
				concepts: "empty",
				descriptions: "empty",
				semantic: "empty",
				graph: "empty",
			},
			feedbackActions: [],
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
			scope: "block",
			context: {
				paper: null,
				block: null,
				note: null,
				annotation: null,
				conceptId: null,
			},
			concepts: [],
			semanticCandidates: [],
			relatedPapers: [],
			freshness: {
				concepts: "empty",
				descriptions: "empty",
				semantic: "empty",
				graph: "empty",
			},
			feedbackActions: [],
		})
		expect(loadBlockConceptLensPayloadMock).toHaveBeenCalledWith({
			workspaceId: "ws-1",
			paperId: "paper-1",
			blockId: "blk-1",
			userId: "user-1",
		})
	})

	it("registers the unified concept lens route for anchored reader context", async () => {
		loadConceptLensPayloadMock.mockResolvedValueOnce({
			workspaceId: "ws-1",
			paperId: "paper-1",
			scope: "note",
			blockId: "blk-1",
			context: {
				paper: { id: "paper-1", title: "A Paper" },
				block: null,
				note: { id: "note-1", currentVersion: 2 },
				annotation: null,
				conceptId: null,
			},
			concepts: [],
			semanticCandidates: [],
			relatedPapers: [],
			freshness: {
				concepts: "empty",
				descriptions: "empty",
				semantic: "empty",
				graph: "empty",
			},
			feedbackActions: [],
		})

		const { wikiRoutes } = await import("./wiki")
		const app = new Hono()
		app.route("/", wikiRoutes)

		const response = await app.request("/workspaces/ws-1/papers/paper-1/lens?noteId=note-1")

		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({
			workspaceId: "ws-1",
			paperId: "paper-1",
			scope: "note",
			blockId: "blk-1",
		})
		expect(loadConceptLensPayloadMock).toHaveBeenCalledWith({
			workspaceId: "ws-1",
			paperId: "paper-1",
			userId: "user-1",
			blockId: undefined,
			noteId: "note-1",
			annotationId: undefined,
			conceptId: undefined,
		})
	})

	it("rejects unanchored concept lens requests", async () => {
		const { wikiRoutes } = await import("./wiki")
		const app = new Hono()
		app.route("/", wikiRoutes)

		const response = await app.request("/workspaces/ws-1/papers/paper-1/lens")

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error: "lens requires blockId, noteId, annotationId, or conceptId",
		})
		expect(loadConceptLensPayloadMock).not.toHaveBeenCalled()
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

	it("returns a paper concept graph payload with dataset concepts visible", async () => {
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
				defaultNodeKinds: ["concept", "method", "task", "metric", "dataset"],
				supportingNodeKinds: [],
			},
			graph: {
				nodeCount: 3,
				edgeCount: 2,
				relationCounts: { addresses: 1, uses: 1 },
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
						degree: 2,
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
					{
						id: "concept-hidden",
						conceptId: "concept-hidden",
						label: "WMT 2014",
						kind: "dataset",
						canonicalName: "wmt 2014",
						status: "done",
						salienceScore: 0,
						highlightCount: 0,
						noteCitationCount: 0,
						degree: 1,
						evidenceBlockIds: ["blk-3"],
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
					{
						id: "edge-hidden",
						source: "concept-1",
						target: "concept-hidden",
						sourceConceptId: "concept-1",
						targetConceptId: "concept-hidden",
						relationType: "uses",
						confidence: 0.7,
						evidenceBlockIds: ["blk-3"],
						evidence: [
							{
								blockId: "blk-3",
								snippet: "hidden edge evidence",
								confidence: 0.7,
							},
						],
					},
				],
			},
		})
		})

	it("returns block-level concept lens payload with semantic suggestions", async () => {
		loadBlockConceptLensPayloadMock.mockResolvedValueOnce({
			workspaceId: "ws-1",
			paperId: "paper-1",
			blockId: "blk-1",
			scope: "block",
			context: {
				paper: null,
				block: null,
				note: null,
				annotation: null,
				conceptId: null,
			},
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
			relatedPapers: [],
			freshness: {
				concepts: "done",
				descriptions: "done",
				semantic: "done",
				graph: "empty",
			},
			feedbackActions: [],
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
			scope: "block",
			context: {
				paper: null,
				block: null,
				note: null,
				annotation: null,
				conceptId: null,
			},
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
			relatedPapers: [],
			freshness: {
				concepts: "done",
				descriptions: "done",
				semantic: "done",
				graph: "empty",
			},
			feedbackActions: [],
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
