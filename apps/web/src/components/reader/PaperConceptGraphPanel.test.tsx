import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PaperConceptGraphPanel } from "./PaperConceptGraphPanel"

const usePaperConceptGraphMock = vi.fn()
type TapEvent = { target: { data: (key: string) => unknown } }
type TapHandler = (event: TapEvent) => void

const { cytoscapeMock, handlers } = vi.hoisted(() => ({
	cytoscapeMock: vi.fn(() => ({
		destroy: vi.fn(),
		on: vi.fn((eventName: string, selectorOrHandler: unknown, maybeHandler?: unknown) => {
			if (eventName !== "tap") return
			if (selectorOrHandler === "node" && typeof maybeHandler === "function") {
				handlers.node = maybeHandler as TapHandler
			}
			if (selectorOrHandler === "edge" && typeof maybeHandler === "function") {
				handlers.edge = maybeHandler as TapHandler
			}
		}),
	})),
	handlers: {
		node: undefined as TapHandler | undefined,
		edge: undefined as TapHandler | undefined,
	},
}))

vi.mock("cytoscape", () => ({
	default: cytoscapeMock,
}))

vi.mock("@/api/hooks/papers", () => ({
	usePaperConceptGraph: (...args: Array<unknown>) => usePaperConceptGraphMock(...args),
}))

describe("PaperConceptGraphPanel", () => {
	beforeEach(() => {
		usePaperConceptGraphMock.mockReset()
		cytoscapeMock.mockClear()
		handlers.node = undefined
		handlers.edge = undefined
	})

	it("renders the graph and lets evidence jump back to a source block", async () => {
		const user = userEvent.setup()
		const onOpenBlock = vi.fn()
		usePaperConceptGraphMock.mockReturnValue({
			data: {
				workspaceId: "workspace-1",
				paperId: "paper-1",
				sourcePage: {
					id: "page-1",
					displayName: "A Paper",
					status: "done",
					error: null,
					generatedAt: "2026-05-01T12:00:00.000Z",
					modelName: "gpt-5",
					promptVersion: "paper-compile-hierarchical-v1",
					referenceBlockIds: ["block-1"],
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
							highlightCount: 1,
							noteCitationCount: 0,
							degree: 1,
							evidenceBlockIds: ["block-1"],
						},
						{
							id: "concept-2",
							conceptId: "concept-2",
							label: "Machine Translation",
							kind: "task",
							canonicalName: "machine translation",
							status: "done",
							salienceScore: 0.5,
							highlightCount: 0,
							noteCitationCount: 0,
							degree: 1,
							evidenceBlockIds: ["block-2"],
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
							evidenceBlockIds: ["block-3"],
							evidence: [],
						},
					],
				},
			},
			error: null,
			isLoading: false,
		})

		render(
			<PaperConceptGraphPanel
				onOpenBlock={onOpenBlock}
				paperId="paper-1"
				workspaceId="workspace-1"
			/>,
		)

		expect(screen.getByText("2 concepts · 1 links")).toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "Show" }))

		expect(screen.getByLabelText("Paper concept graph")).toBeInTheDocument()
		expect(cytoscapeMock).toHaveBeenCalledOnce()
		expect(screen.getByText("Top Concepts")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /Transformer/ })).toBeInTheDocument()

		await act(async () => {
			handlers.node?.({ target: { data: () => "concept-1" } })
		})

		expect(screen.getByText("Transformer")).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "block-1" }))
		expect(onOpenBlock).toHaveBeenCalledWith("block-1")
	})

	it("filters concepts by kind and relations by edge type", async () => {
		const user = userEvent.setup()
		usePaperConceptGraphMock.mockReturnValue({
			data: {
				workspaceId: "workspace-1",
				paperId: "paper-1",
				sourcePage: {
					id: "page-1",
					displayName: "A Paper",
					status: "done",
					error: null,
					generatedAt: "2026-05-01T12:00:00.000Z",
					modelName: "gpt-5",
					promptVersion: "paper-compile-hierarchical-v1",
					referenceBlockIds: [],
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
							highlightCount: 1,
							noteCitationCount: 0,
							degree: 1,
							evidenceBlockIds: ["block-1"],
						},
						{
							id: "concept-2",
							conceptId: "concept-2",
							label: "Machine Translation",
							kind: "task",
							canonicalName: "machine translation",
							status: "done",
							salienceScore: 0.5,
							highlightCount: 0,
							noteCitationCount: 0,
							degree: 1,
							evidenceBlockIds: ["block-2"],
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
							evidenceBlockIds: ["block-3"],
							evidence: [],
						},
					],
				},
			},
			error: null,
			isLoading: false,
		})

		render(
			<PaperConceptGraphPanel onOpenBlock={vi.fn()} paperId="paper-1" workspaceId="workspace-1" />,
		)

		await user.click(screen.getByRole("button", { name: "Show" }))
		expect(screen.getByText("Transformer")).toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "method" }))
		expect(screen.queryByText("Transformer")).not.toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "method" }))
		expect(screen.getByText("Transformer")).toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "addresses" }))
		expect(screen.getByText("2 concepts · 0 links")).toBeInTheDocument()
	})
})
