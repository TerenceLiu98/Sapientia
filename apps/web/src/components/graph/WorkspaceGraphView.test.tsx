import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PaperGraphPayload } from "@/api/hooks/graph"
import { WorkspaceGraphView } from "./WorkspaceGraphView"

const useWorkspaceGraphMock = vi.fn()
type ForceGraphProps = {
	graphData?: {
		nodes: Array<Record<string, unknown>>
		links: Array<Record<string, unknown>>
	}
	nodeVal?: (node: Record<string, unknown>) => number
	nodeColor?: (node: Record<string, unknown>) => string
	linkColor?: (link: Record<string, unknown>) => string
	linkWidth?: (link: Record<string, unknown>) => number
	onNodeClick?: (node: Record<string, unknown>) => void
	onLinkClick?: (link: Record<string, unknown>) => void
	onBackgroundClick?: () => void
}

const { forceGraphProps, zoomToFitMock, d3ForceMock, d3ReheatSimulationMock } = vi.hoisted(
	() => ({
		forceGraphProps: { current: null as ForceGraphProps | null },
		zoomToFitMock: vi.fn(),
		d3ForceMock: vi.fn(() => ({
			distance: vi.fn(),
			strength: vi.fn(),
		})),
		d3ReheatSimulationMock: vi.fn(),
	}),
)

vi.mock("react-force-graph-3d", async () => {
	const React = await vi.importActual<typeof import("react")>("react")
	return {
		default: React.forwardRef(function ForceGraph3DMock(props: ForceGraphProps, ref) {
			forceGraphProps.current = props
			const methods = {
				zoomToFit: zoomToFitMock,
				d3Force: d3ForceMock,
				d3ReheatSimulation: d3ReheatSimulationMock,
			}
			if (typeof ref === "function") ref(methods)
			else if (ref) ref.current = methods
			return React.createElement("div", {
				"aria-label": "3D graph canvas",
				"data-testid": "force-graph-3d",
			})
		}),
	}
})

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
	useWorkspaceGraph: (...args: Array<unknown>) => useWorkspaceGraphMock(...args),
}))

describe("WorkspaceGraphView", () => {
	beforeEach(() => {
		useWorkspaceGraphMock.mockReset()
		forceGraphProps.current = null
		zoomToFitMock.mockReset()
		d3ForceMock.mockClear()
		d3ReheatSimulationMock.mockClear()
	})

	it("renders the 3D graph as the primary surface", () => {
		useWorkspaceGraphMock.mockReturnValue(makeGraphQuery())

		render(<WorkspaceGraphView workspace={workspaceFixture} />)

		expect(useWorkspaceGraphMock).toHaveBeenCalledWith("workspace-1", "papers")
		expect(screen.queryByRole("heading", { name: "Paper Map" })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: /fit/i })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: /clear/i })).not.toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Search papers" })).toBeInTheDocument()
		expect(screen.queryByPlaceholderText("Search")).not.toBeInTheDocument()
		expect(screen.getByLabelText("Workspace graph")).toBeInTheDocument()
		expect(screen.getByText("Node size")).toBeInTheDocument()
		expect(screen.getByTestId("force-graph-3d")).toBeInTheDocument()
		expect(forceGraphProps.current?.graphData?.nodes).toHaveLength(3)
		expect(forceGraphProps.current?.graphData?.links).toHaveLength(3)
		expect(
			forceGraphProps.current?.nodeVal?.(forceGraphProps.current.graphData?.nodes[0] ?? {}),
		).toBeGreaterThan(0)
	})

	it("shows search results on the canvas and clears the query", async () => {
		const user = userEvent.setup()
		useWorkspaceGraphMock.mockReturnValue(makeGraphQuery())
		render(<WorkspaceGraphView workspace={workspaceFixture} />)

		expect(screen.getByRole("button", { name: "Search papers" })).toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "Search papers" }))
		const searchInput = screen.getByPlaceholderText("Search")
		await user.type(searchInput, "Grace")

		expect(screen.getByText("Search")).toBeInTheDocument()
		expect(screen.getByText("1 paper match · 2 connection matches")).toBeInTheDocument()
		expect(
			screen.getAllByRole("button", { name: /Mechanistic Interpretability/ }).length,
		).toBeGreaterThan(0)

		await user.click(screen.getByRole("button", { name: "Close search" }))
		expect(screen.queryByPlaceholderText("Search")).not.toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Search papers" })).toBeInTheDocument()
		expect(screen.queryByText("1 paper match · 2 connection matches")).not.toBeInTheDocument()
	})

	it("opens paper and evidence detail sheets from graph clicks", async () => {
		const user = userEvent.setup()
		useWorkspaceGraphMock.mockReturnValue(makeGraphQuery())
		render(<WorkspaceGraphView workspace={workspaceFixture} />)

		await act(async () => {
			forceGraphProps.current?.onNodeClick?.({
				id: "paper-1",
				paper: graphFixture.graph.nodes[0],
			})
		})

		expect(screen.getByText("Paper")).toBeInTheDocument()
		expect(screen.getAllByText("Sparse Autoencoder Features").length).toBeGreaterThanOrEqual(1)
		expect(screen.getByRole("link", { name: "Open paper" })).toHaveAttribute(
			"href",
			"/papers/paper-1",
		)
		expect(screen.getByText("Connected Papers")).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "Close graph details" }))
		expect(screen.queryByText("Connected Papers")).not.toBeInTheDocument()

		await act(async () => {
			forceGraphProps.current?.onLinkClick?.({
				id: "paper-edge:paper-1:paper-2",
				source: "paper-1",
				target: "paper-2",
				edge: graphFixture.graph.edges[0],
			})
		})

		expect(screen.getByText("Evidence")).toBeInTheDocument()
		expect(
			screen.getByText("mixed evidence · 2 evidence · 1 strong · strength 91%"),
		).toBeInTheDocument()
		expect(screen.getByText(/Shared method/)).toBeInTheDocument()
		expect(screen.getByText(/LLM: related/)).toBeInTheDocument()
		expect(screen.getByText("Uses SAE features as retrieval signals.")).toBeInTheDocument()
		expect(screen.getByText(/SAE features are used as retrieval signals/)).toBeInTheDocument()
		expect(screen.getByText(/Feature retrieval supports downstream analysis/)).toBeInTheDocument()
		expect(screen.getAllByRole("link", { name: "Open source evidence" })[0]).toHaveAttribute(
			"href",
			"/papers/paper-1?blockId=block-source-sae",
		)
		expect(screen.getAllByRole("link", { name: "Open target evidence" })[0]).toHaveAttribute(
			"href",
			"/papers/paper-2?blockId=block-target-sae",
		)
	})

	it("renders loading, error, and empty states", async () => {
		const user = userEvent.setup()
		const refetch = vi.fn()
		useWorkspaceGraphMock.mockReturnValue({
			data: undefined,
			error: null,
			isLoading: true,
			refetch,
		})
		const { rerender } = render(<WorkspaceGraphView workspace={workspaceFixture} />)
		expect(screen.getByText("Loading paper map...")).toBeInTheDocument()

		useWorkspaceGraphMock.mockReturnValue({
			data: undefined,
			error: new Error("offline"),
			isLoading: false,
			refetch,
		})
		rerender(<WorkspaceGraphView workspace={workspaceFixture} />)
		expect(screen.getByText("Paper map failed to load.")).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "Retry" }))
		expect(refetch).toHaveBeenCalled()

		useWorkspaceGraphMock.mockReturnValue(
			makeGraphQuery({ nodeCount: 1, nodes: [graphFixture.graph.nodes[0]], edges: [] }),
		)
		rerender(<WorkspaceGraphView workspace={workspaceFixture} />)
		expect(screen.getByText("Your paper map is still forming.")).toBeInTheDocument()

		useWorkspaceGraphMock.mockReturnValue(makeGraphQuery({ edgeCount: 0, edges: [] }))
		rerender(<WorkspaceGraphView workspace={workspaceFixture} />)
		expect(
			screen.getByText("Papers are ready, but links are not strong enough yet."),
		).toBeInTheDocument()
	})
})

const workspaceFixture = {
	id: "workspace-1",
	name: "Lab",
	type: "personal",
	role: "owner",
	createdAt: "2026-05-01T12:00:00.000Z",
} as const

const graphFixture: PaperGraphPayload = {
	workspaceId: "workspace-1",
	view: "papers",
	graph: {
		nodeCount: 3,
		edgeCount: 3,
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
				degree: 2,
				topConcepts: [{ id: "concept-1", displayName: "Sparse Autoencoders", kind: "method" }],
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
				degree: 2,
				topConcepts: [
					{ id: "concept-2", displayName: "Mechanistic Interpretability", kind: "task" },
				],
			},
			{
				id: "paper-3",
				paperId: "paper-3",
				label: "Scaling Laws",
				title: "Scaling Laws",
				authors: ["Katherine"],
				year: 2024,
				venue: "NeurIPS",
				summaryStatus: "completed",
				conceptCount: 7,
				degree: 2,
				topConcepts: [{ id: "concept-5", displayName: "Scaling Laws", kind: "metric" }],
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
						llmConfidence: null,
						rationale: "Shared method: Sparse Autoencoders",
						sourceDescription: "Uses SAE features as retrieval signals.",
						targetDescription: "Uses SAE features to explain model behavior.",
						sourceEvidenceBlockIds: ["block-source-sae"],
						sourceEvidenceSnippets: [
							{
								blockId: "block-source-sae",
								snippet: "SAE features are used as retrieval signals.",
							},
						],
						sourcePaperId: "paper-1",
						targetEvidenceBlockIds: ["block-target-sae"],
						targetEvidenceSnippets: [
							{ blockId: "block-target-sae", snippet: "SAE features explain model behavior." },
						],
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
						llmConfidence: 0.88,
						rationale: "Both concepts connect feature evidence to paper interpretation.",
						sourceDescription: "Retrieves features for downstream analysis.",
						targetDescription: "Explains model internals.",
						sourceEvidenceBlockIds: ["block-source-task"],
						sourceEvidenceSnippets: [
							{
								blockId: "block-source-task",
								snippet: "Feature retrieval supports downstream analysis.",
							},
						],
						sourcePaperId: "paper-1",
						targetEvidenceBlockIds: ["block-target-task"],
						targetEvidenceSnippets: [
							{
								blockId: "block-target-task",
								snippet: "Mechanistic interpretability explains internals.",
							},
						],
						targetPaperId: "paper-2",
					},
				],
			},
			{
				id: "paper-edge:paper-2:paper-3",
				source: "paper-2",
				target: "paper-3",
				edgeKind: "same_task",
				weight: 0.72,
				evidenceCount: 1,
				strongEvidenceCount: 1,
				maxSimilarity: 0.72,
				avgSimilarity: 0.72,
				kinds: ["task"],
				topEvidence: [
					{
						kind: "task",
						sourceConceptId: "concept-2",
						targetConceptId: "concept-6",
						sourceConceptName: "Mechanistic Interpretability",
						targetConceptName: "Scaling Analysis",
						matchMethod: "llm",
						similarityScore: 0.72,
						llmDecision: "related",
						llmConfidence: 0.7,
						rationale: "Both papers evaluate model behavior.",
						sourceDescription: "Explains model internals.",
						targetDescription: "Evaluates model behavior at scale.",
						sourceEvidenceBlockIds: ["block-source-mi"],
						sourceEvidenceSnippets: [
							{ blockId: "block-source-mi", snippet: "Explains internals." },
						],
						sourcePaperId: "paper-2",
						targetEvidenceBlockIds: ["block-target-scaling"],
						targetEvidenceSnippets: [
							{ blockId: "block-target-scaling", snippet: "Evaluates at scale." },
						],
						targetPaperId: "paper-3",
					},
				],
			},
			{
				id: "paper-edge:paper-1:paper-3",
				source: "paper-1",
				target: "paper-3",
				edgeKind: "similar_methods",
				weight: 0.68,
				evidenceCount: 1,
				strongEvidenceCount: 0,
				maxSimilarity: 0.68,
				avgSimilarity: 0.68,
				kinds: ["method"],
				topEvidence: [
					{
						kind: "method",
						sourceConceptId: "concept-1",
						targetConceptId: "concept-5",
						sourceConceptName: "Sparse Autoencoders",
						targetConceptName: "Scaling Laws",
						matchMethod: "embedding",
						similarityScore: 0.68,
						llmDecision: "uncertain",
						llmConfidence: 0.51,
						rationale: "Weak method overlap.",
						sourceDescription: "Uses SAE features.",
						targetDescription: "Studies scaling.",
						sourceEvidenceBlockIds: ["block-source-weak"],
						sourceEvidenceSnippets: [
							{ blockId: "block-source-weak", snippet: "Uses SAE features." },
						],
						sourcePaperId: "paper-1",
						targetEvidenceBlockIds: ["block-target-weak"],
						targetEvidenceSnippets: [{ blockId: "block-target-weak", snippet: "Studies scaling." }],
						targetPaperId: "paper-3",
					},
				],
			},
		],
	},
}

function makeGraphQuery(overrides: Partial<PaperGraphPayload["graph"]> = {}) {
	return {
		data: {
			...graphFixture,
			graph: {
				...graphFixture.graph,
				...overrides,
			},
		},
		error: null,
		isLoading: false,
		refetch: vi.fn(),
	}
}
