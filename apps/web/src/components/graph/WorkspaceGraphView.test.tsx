import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { WorkspaceGraphView } from "./WorkspaceGraphView"

const useWorkspaceGraphMock = vi.fn()
const reviewSemanticCandidateMock = vi.fn()
type GraphEventPayload = { node?: string; edge?: string }
type GraphHandler = (event: GraphEventPayload) => void

const { sigmaMock, handlers } = vi.hoisted(() => ({
	sigmaMock: vi.fn(function SigmaMock() {
		return {
			kill: vi.fn(),
			refresh: vi.fn(),
			on: vi.fn((eventName: string, handler: unknown) => {
				if (eventName === "clickNode" && typeof handler === "function") {
					handlers.node = handler as GraphHandler
				}
				if (eventName === "clickEdge" && typeof handler === "function") {
					handlers.edge = handler as GraphHandler
				}
				if (eventName === "clickStage" && typeof handler === "function") {
					handlers.stage = handler as GraphHandler
				}
				return undefined
			}),
		}
	}),
	handlers: {
		node: undefined as GraphHandler | undefined,
		edge: undefined as GraphHandler | undefined,
		stage: undefined as GraphHandler | undefined,
	},
}))

vi.mock("sigma", () => ({
	default: sigmaMock,
}))

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		params,
		to,
		...props
	}: {
		children: ReactNode
		params?: { paperId?: string }
		to: string
	}) => (
		<a href={to.replace("$paperId", params?.paperId ?? "")} {...props}>
			{children}
		</a>
	),
}))

vi.mock("@/api/hooks/graph", () => ({
	useReviewSemanticCandidate: () => ({
		isPending: false,
		mutate: reviewSemanticCandidateMock,
	}),
	useWorkspaceGraph: (...args: Array<unknown>) => useWorkspaceGraphMock(...args),
}))

describe("WorkspaceGraphView", () => {
	beforeEach(() => {
			useWorkspaceGraphMock.mockReset()
			reviewSemanticCandidateMock.mockReset()
		sigmaMock.mockClear()
		handlers.node = undefined
		handlers.edge = undefined
		handlers.stage = undefined
	})

	it("renders the workspace graph and opens the selected concept paper", async () => {
		const user = userEvent.setup()
		useWorkspaceGraphMock.mockReturnValue({
			data: {
				workspaceId: "workspace-1",
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
							id: "cluster-1",
							clusterId: "cluster-1",
							conceptId: "cluster-1",
							label: "Sparse Autoencoder Features",
							kind: "concept",
							canonicalName: "sparse autoencoder features",
							status: "done",
							memberCount: 2,
							paperCount: 2,
							salienceScore: 0.92,
							confidence: 1,
							updatedAt: "2026-05-01T12:00:00.000Z",
							degree: 1,
							evidenceBlockIds: ["block-1"],
							members: [
								{
									localConceptId: "concept-1a",
									paperId: "paper-1",
									paperTitle: "Feature Circuits",
									displayName: "Sparse Autoencoder Features",
									canonicalName: "sparse autoencoder features",
									salienceScore: 0.92,
									sourceLevelDescription:
										"SAE features are treated as interpretable latent units in this paper.",
									sourceLevelDescriptionStatus: "done",
									readerSignalSummary: "Reader signal: highlighted on 1 evidence block(s): 1 important.",
									evidenceBlockIds: ["block-1"],
								},
								{
									localConceptId: "concept-1b",
									paperId: "paper-2",
									paperTitle: "SAE Survey",
									displayName: "SAE Features",
									canonicalName: "sparse autoencoder features",
									salienceScore: 0.4,
									sourceLevelDescription: null,
									sourceLevelDescriptionStatus: "pending",
									readerSignalSummary: null,
									evidenceBlockIds: ["block-9"],
								},
							],
						},
						{
							id: "cluster-2",
							clusterId: "cluster-2",
							conceptId: "cluster-2",
							label: "Mechanistic Interpretability",
							kind: "task",
							canonicalName: "mechanistic interpretability",
							status: "done",
							memberCount: 1,
							paperCount: 1,
							salienceScore: 0.71,
							confidence: 1,
							updatedAt: "2026-05-01T12:00:00.000Z",
							degree: 1,
							evidenceBlockIds: ["block-2"],
							members: [
								{
									localConceptId: "concept-2",
									paperId: "paper-3",
									paperTitle: "Interpreting Transformers",
									displayName: "Mechanistic Interpretability",
									canonicalName: "mechanistic interpretability",
									salienceScore: 0.71,
									sourceLevelDescription:
										"The paper frames mechanistic interpretability as a task for explaining model internals.",
									sourceLevelDescriptionStatus: "done",
									readerSignalSummary: null,
									evidenceBlockIds: ["block-2"],
								},
							],
						},
					],
					edges: [
						{
							id: "edge-1",
							source: "cluster-1",
							target: "cluster-2",
							sourceConceptId: "cluster-1",
							targetConceptId: "cluster-2",
							relationType: "supports",
							confidence: 0.81,
							evidenceBlockIds: ["block-3"],
							localEdgeCount: 1,
						},
						{
							id: "edge-2",
							source: "cluster-1",
							target: "cluster-2",
							sourceConceptId: "cluster-1",
							targetConceptId: "cluster-2",
							relationType: "contrasts",
							confidence: 0.67,
							evidenceBlockIds: ["block-4"],
							localEdgeCount: 1,
						},
						],
						semanticCandidateCounts: {
							total: 3,
							needsReview: 1,
							userAccepted: 1,
							userRejected: 1,
						},
						semanticCandidates: [
						{
							id: "candidate-1",
							source: "cluster-1",
							target: "cluster-2",
							sourceConceptId: "cluster-1",
							targetConceptId: "cluster-2",
							sourceLocalConceptId: "concept-1a",
							targetLocalConceptId: "concept-2",
							kind: "concept",
								matchMethod: "lexical_source_description",
								similarityScore: 0.74,
								llmDecision: "related",
								decisionStatus: "needs_review",
								rationale: "name=0.42; description=0.81; containment=0.5",
						},
					],
				},
			},
			error: null,
			isLoading: false,
		})

		render(
			<WorkspaceGraphView
				workspace={{
					id: "workspace-1",
					name: "Lab",
					type: "personal",
					role: "owner",
					createdAt: "2026-05-01T12:00:00.000Z",
				}}
			/>,
		)

		expect(screen.getByText("2 concepts · 1 links")).toBeInTheDocument()
		expect(screen.getByLabelText("Workspace concept graph")).toBeInTheDocument()
		expect(sigmaMock).toHaveBeenCalledOnce()

		await act(async () => {
			handlers.node?.({ node: "cluster-1" })
		})

		expect(screen.getAllByText("Sparse Autoencoder Features").length).toBeGreaterThanOrEqual(2)
		expect(screen.getByRole("link", { name: /Feature Circuits/ })).toHaveAttribute(
			"href",
			"/papers/paper-1",
		)
		expect(screen.getByRole("link", { name: /SAE Survey/ })).toHaveAttribute(
			"href",
			"/papers/paper-2",
		)
		expect(screen.getByText(/interpretable latent units/)).toBeInTheDocument()
			expect(screen.getByText("Similar Concepts to Review")).toBeInTheDocument()
			expect(screen.getByText("1 to review · 1 accepted · 1 rejected")).toBeInTheDocument()
			expect(screen.getByText("LLM: related")).toBeInTheDocument()
		const mechanisticButtons = screen.getAllByRole("button", {
			name: /Mechanistic Interpretability/,
		})
			expect(mechanisticButtons[0]).toHaveTextContent(
				"74%",
			)
			await user.click(screen.getByRole("button", { name: "Accept" }))
			expect(reviewSemanticCandidateMock).toHaveBeenCalledWith({
				candidateId: "candidate-1",
				decisionStatus: "user_accepted",
			})

			await user.click(mechanisticButtons[0])
		expect(screen.getAllByText(/Interpreting Transformers/).length).toBeGreaterThanOrEqual(1)
		expect(screen.getByRole("link", { name: /Interpreting Transformers/ })).toHaveAttribute(
			"href",
			"/papers/paper-3",
		)
	})
})
