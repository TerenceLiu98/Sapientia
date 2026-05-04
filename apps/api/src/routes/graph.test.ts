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

	it("returns a paper graph by default from shared and semantic concept evidence", async () => {
		selectMock
			.mockReturnValueOnce({
				from: () => ({
					innerJoin: () => ({
						where: () => ({
							orderBy: async () => [
								{
									id: "paper-1",
									title: "Sparse Autoencoders for Retrieval",
									authors: ["Ada"],
									year: 2026,
									venue: "arXiv",
									summaryStatus: "completed",
									createdAt: new Date("2026-05-02T10:00:00.000Z"),
								},
								{
									id: "paper-2",
									title: "SAE Feature Explanations",
									authors: ["Grace"],
									year: 2026,
									venue: "ICLR",
									summaryStatus: "completed",
									createdAt: new Date("2026-05-02T10:01:00.000Z"),
								},
							],
						}),
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					innerJoin: () => ({
						where: async () => [
							{
								id: "concept-1",
								paperId: "paper-1",
								clusterId: "cluster-sae",
								kind: "method",
								displayName: "Sparse Autoencoders",
								canonicalName: "sparse autoencoders",
								salienceScore: 0.9,
								sourceLevelDescription: "Uses SAE features as retrieval signals.",
							},
							{
								id: "concept-2",
								paperId: "paper-2",
								clusterId: "cluster-sae",
								kind: "method",
								displayName: "Sparse Autoencoders",
								canonicalName: "sparse autoencoders",
								salienceScore: 0.82,
								sourceLevelDescription: "Uses SAE features to explain model behavior.",
							},
							{
								id: "concept-3",
								paperId: "paper-1",
								clusterId: "cluster-retrieval",
								kind: "task",
								displayName: "Feature Retrieval",
								canonicalName: "feature retrieval",
								salienceScore: 0.7,
								sourceLevelDescription: "Retrieves features for downstream analysis.",
							},
							{
								id: "concept-4",
								paperId: "paper-2",
								clusterId: "cluster-interpretability",
								kind: "task",
								displayName: "Feature Interpretability",
								canonicalName: "feature interpretability",
								salienceScore: 0.65,
								sourceLevelDescription: "Interprets features in model activations.",
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
							blockId: "blk-sae-source",
							snippet: "SAE features are used for retrieval.",
						},
						{
							conceptId: "concept-2",
							blockId: "blk-sae-target",
							snippet: "SAE features explain model behavior.",
						},
						{
							conceptId: "concept-3",
							blockId: "blk-retrieval",
							snippet: "Feature retrieval supports downstream analysis.",
						},
						{
							conceptId: "concept-4",
							blockId: "blk-interpretability",
							snippet: "Feature interpretability studies activations.",
						},
					],
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						orderBy: async () => [
							{
								id: "candidate-1",
								sourceLocalConceptId: "concept-3",
								targetLocalConceptId: "concept-4",
								kind: "task",
								matchMethod: "embedding",
								similarityScore: 0.84,
								llmDecision: "related",
								llmConfidence: 0.86,
								decisionStatus: "ai_confirmed",
								rationale: "Both tasks compare feature-level evidence across papers.",
							},
						],
					}),
				}),
			})

		const { graphRoutes } = await import("./graph")
		const app = new Hono()
		app.route("/", graphRoutes)

		const response = await app.request("/workspaces/ws-1/graph")
		const payload = (await response.json()) as {
			workspaceId: string
			view: string
			graph: {
				nodeCount: number
				edgeCount: number
				nodes: unknown[]
				edges: Array<{
					topEvidence: unknown[]
				}>
			}
		}

		expect(response.status).toBe(200)
		expect(payload.workspaceId).toBe("ws-1")
		expect(payload.view).toBe("papers")
		expect(payload.graph.nodeCount).toBe(2)
		expect(payload.graph.edgeCount).toBe(1)
		expect(payload.graph.nodes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "paper-1",
					title: "Sparse Autoencoders for Retrieval",
					conceptCount: 2,
					degree: 1,
				}),
				expect.objectContaining({
					id: "paper-2",
					title: "SAE Feature Explanations",
					conceptCount: 2,
					degree: 1,
				}),
			]),
		)
		expect(payload.graph.edges[0]).toEqual(
			expect.objectContaining({
				id: "paper-edge:paper-1:paper-2",
				source: "paper-1",
				target: "paper-2",
				edgeKind: "mixed",
				evidenceCount: 2,
				strongEvidenceCount: 2,
			}),
		)
		expect(payload.graph.edges[0].topEvidence).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					matchMethod: "exact_cluster",
					sourcePaperId: "paper-1",
					targetPaperId: "paper-2",
					sourceConceptName: "Sparse Autoencoders",
					sourceEvidenceBlockIds: ["blk-sae-source"],
					sourceEvidenceSnippets: [
						{ blockId: "blk-sae-source", snippet: "SAE features are used for retrieval." },
					],
					targetEvidenceBlockIds: ["blk-sae-target"],
					targetEvidenceSnippets: [
						{ blockId: "blk-sae-target", snippet: "SAE features explain model behavior." },
					],
				}),
				expect.objectContaining({
					matchMethod: "embedding",
					sourceConceptName: "Feature Retrieval",
					targetConceptName: "Feature Interpretability",
					sourceEvidenceBlockIds: ["blk-retrieval"],
					sourceEvidenceSnippets: [
						{
							blockId: "blk-retrieval",
							snippet: "Feature retrieval supports downstream analysis.",
						},
					],
					targetEvidenceBlockIds: ["blk-interpretability"],
					targetEvidenceSnippets: [
						{
							blockId: "blk-interpretability",
							snippet: "Feature interpretability studies activations.",
						},
					],
				}),
			]),
		)
	})

	it("surfaces high-signal unreviewed semantic candidates as suggested paper links", async () => {
		selectMock
			.mockReturnValueOnce({
				from: () => ({
					innerJoin: () => ({
						where: () => ({
							orderBy: async () => [
								{
									id: "paper-attention",
									title: "Attention Is All You Need",
									authors: ["Vaswani"],
									year: 2017,
									venue: "NeurIPS",
									summaryStatus: "done",
									createdAt: new Date("2026-05-02T10:00:00.000Z"),
								},
								{
									id: "paper-survey",
									title: "LLMs in Politics and Democracy",
									authors: ["Ada"],
									year: 2026,
									venue: "arXiv",
									summaryStatus: "done",
									createdAt: new Date("2026-05-02T10:01:00.000Z"),
								},
							],
						}),
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					innerJoin: () => ({
						where: async () => [
							{
								id: "concept-transformer",
								paperId: "paper-attention",
								clusterId: "cluster-transformer-attention",
								kind: "method",
								displayName: "Transformer",
								canonicalName: "transformer",
								salienceScore: 0,
								sourceLevelDescription: "The Transformer architecture proposed by the paper.",
							},
							{
								id: "concept-transformer-architecture",
								paperId: "paper-survey",
								clusterId: "cluster-transformer-survey",
								kind: "method",
								displayName: "Transformer architecture",
								canonicalName: "transformer architecture",
								salienceScore: 0,
								sourceLevelDescription: "A family of Transformer-based LLM architectures.",
							},
						],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: async () => [
						{
							conceptId: "concept-transformer",
							blockId: "blk-transformer",
							snippet: "The Transformer relies entirely on attention.",
						},
						{
							conceptId: "concept-transformer-architecture",
							blockId: "blk-survey",
							snippet: "Modern LLMs use Transformer architectures.",
						},
					],
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						orderBy: async () => [
							{
								id: "candidate-transformer",
								sourceLocalConceptId: "concept-transformer-architecture",
								targetLocalConceptId: "concept-transformer",
								kind: "method",
								matchMethod: "embedding",
								similarityScore: 0.717,
								llmDecision: null,
								llmConfidence: null,
								decisionStatus: "candidate",
								rationale: "embedding=0.717",
							},
						],
					}),
				}),
			})

		const { graphRoutes } = await import("./graph")
		const app = new Hono()
		app.route("/", graphRoutes)

		const response = await app.request("/workspaces/ws-1/graph")
		const payload = (await response.json()) as {
			graph: {
				edgeCount: number
				nodes: Array<{ id: string; degree: number }>
				edges: Array<{
					edgeKind: string
					weight: number
					strongEvidenceCount: number
					topEvidence: Array<{
						sourceConceptName: string
						targetConceptName: string
						decisionStatus: string
						llmDecision: string | null
					}>
				}>
			}
		}

		expect(response.status).toBe(200)
		expect(payload.graph.edgeCount).toBe(1)
		expect(payload.graph.nodes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "paper-attention", degree: 1 }),
				expect.objectContaining({ id: "paper-survey", degree: 1 }),
			]),
		)
		expect(payload.graph.edges[0]).toEqual(
			expect.objectContaining({
				edgeKind: "similar_methods",
				weight: 0.807,
				strongEvidenceCount: 0,
			}),
		)
		expect(payload.graph.edges[0].topEvidence).toEqual([
			expect.objectContaining({
				sourceConceptName: "Transformer architecture",
				targetConceptName: "Transformer",
				decisionStatus: "candidate",
				llmDecision: null,
			}),
		])
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
								llmConfidence: 0.81,
								decisionStatus: "candidate",
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
							{ decisionStatus: "candidate", count: 1 },
							{ decisionStatus: "user_accepted", count: 2 },
						],
					}),
				}),
			})

		const { graphRoutes } = await import("./graph")
		const app = new Hono()
		app.route("/", graphRoutes)

		const response = await app.request("/workspaces/ws-1/graph?view=concepts")

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
					generated: 1,
					needsReview: 0,
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
						llmConfidence: 0.81,
						decisionStatus: "candidate",
						rationale: "name=0.5; description=0.82; containment=0.67",
					},
				],
			},
		})
	})

	it("marks semantic candidate hints as explicit user overrides without merging clusters", async () => {
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
