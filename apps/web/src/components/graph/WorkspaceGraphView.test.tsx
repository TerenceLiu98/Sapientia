import { act, render, screen } from "@testing-library/react"
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
		search,
		to,
		...props
	}: {
		children: ReactNode
		params?: { paperId?: string }
		search?: { blockId?: string }
		to: string
	}) => {
		const href = to.replace("$paperId", params?.paperId ?? "")
		const searchString = search?.blockId ? `?blockId=${search.blockId}` : ""
		return (
			<a href={`${href}${searchString}`} {...props}>
				{children}
			</a>
		)
	},
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

	it("renders the paper graph and opens paper connection evidence", async () => {
		useWorkspaceGraphMock.mockReturnValue({
			data: {
				workspaceId: "workspace-1",
				view: "papers",
				graph: {
					nodeCount: 2,
					edgeCount: 1,
					nodes: [
						{
							id: "paper-1",
							paperId: "paper-1",
							label: "Sparse Autoencoder Features",
							title: "Sparse Autoencoder Features",
							authors: ["Ada"],
							year: 2026,
							venue: "arXiv",
							summaryStatus: "completed",
							conceptCount: 14,
							degree: 1,
							topConcepts: [
								{
									id: "concept-1",
									displayName: "Sparse Autoencoders",
									kind: "method",
								},
							],
						},
						{
							id: "paper-2",
							paperId: "paper-2",
							label: "Mechanistic Interpretability",
							title: "Mechanistic Interpretability",
							authors: ["Grace"],
							year: 2025,
							venue: "ICLR",
							summaryStatus: "completed",
							conceptCount: 9,
							degree: 1,
							topConcepts: [
								{
									displayName: "Mechanistic Interpretability",
									id: "concept-2",
									kind: "task",
								},
							],
						},
					],
					edges: [
						{
							id: "paper-edge:paper-1:paper-2",
							source: "paper-1",
							target: "paper-2",
							edgeKind: "mixed",
							weight: 0.91,
							evidenceCount: 2,
							strongEvidenceCount: 1,
							maxSimilarity: 1,
							avgSimilarity: 0.92,
							kinds: ["method", "task"],
							topEvidence: [
								{
									kind: "method",
									sourceConceptId: "concept-1",
									targetConceptId: "concept-3",
									sourceConceptName: "Sparse Autoencoders",
									targetConceptName: "Sparse Autoencoders",
									matchMethod: "exact_cluster",
									similarityScore: 1,
									llmDecision: null,
									rationale: "Shared method: Sparse Autoencoders",
									sourceDescription: "Uses SAE features as retrieval signals.",
									targetDescription: "Uses SAE features to explain model behavior.",
									sourceEvidenceBlockIds: ["block-source-sae"],
									sourcePaperId: "paper-1",
									targetEvidenceBlockIds: ["block-target-sae"],
									targetPaperId: "paper-2",
								},
								{
									kind: "task",
									sourceConceptId: "concept-4",
									targetConceptId: "concept-2",
									sourceConceptName: "Feature Retrieval",
									targetConceptName: "Mechanistic Interpretability",
									matchMethod: "lexical_source_description",
									similarityScore: 0.84,
									llmDecision: "related",
									rationale: "Both concepts connect feature evidence to paper interpretation.",
									sourceDescription: "Retrieves features for downstream analysis.",
									targetDescription: "Explains model internals.",
									sourceEvidenceBlockIds: ["block-source-task"],
									sourcePaperId: "paper-1",
									targetEvidenceBlockIds: ["block-target-task"],
									targetPaperId: "paper-2",
								},
							],
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

		expect(useWorkspaceGraphMock).toHaveBeenCalledWith("workspace-1", "papers")
		expect(screen.getByText("2 papers · 1 links")).toBeInTheDocument()
		expect(screen.getByLabelText("Workspace graph")).toBeInTheDocument()
		expect(sigmaMock).toHaveBeenCalledOnce()

		await act(async () => {
			handlers.node?.({ node: "paper-1" })
		})

		expect(screen.getAllByText("Sparse Autoencoder Features").length).toBeGreaterThanOrEqual(1)
		expect(screen.getByRole("link", { name: "Open paper" })).toHaveAttribute(
			"href",
			"/papers/paper-1",
		)

		await act(async () => {
			handlers.edge?.({ edge: "paper-edge:paper-1:paper-2" })
		})

		expect(screen.getByText("mixed evidence · 2 evidence · 1 strong")).toBeInTheDocument()
		expect(screen.getByText(/Shared method/)).toBeInTheDocument()
		expect(screen.getByText(/LLM: related/)).toBeInTheDocument()
		expect(screen.getAllByRole("link", { name: "Open source evidence" })[0]).toHaveAttribute(
			"href",
			"/papers/paper-1?blockId=block-source-sae",
		)
		expect(screen.getAllByRole("link", { name: "Open target evidence" })[0]).toHaveAttribute(
			"href",
			"/papers/paper-2?blockId=block-target-sae",
		)
	})
})
