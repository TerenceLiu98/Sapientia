import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { BlockConceptLensPanel } from "./BlockConceptLensPanel"

const usePaperConceptLensMock = vi.fn()

vi.mock("@/api/hooks/papers", async () => {
	const actual = await vi.importActual<typeof import("@/api/hooks/papers")>("@/api/hooks/papers")
	return {
		...actual,
		usePaperConceptLens: (...args: Array<unknown>) => usePaperConceptLensMock(...args),
	}
})

describe("BlockConceptLensPanel", () => {
	beforeEach(() => {
		usePaperConceptLensMock.mockReset()
	})

	it("does not render until a block is selected", () => {
		usePaperConceptLensMock.mockReturnValue({ data: undefined, isLoading: false, isError: false })

		const { container } = render(
			<BlockConceptLensPanel blockId={null} paperId="paper-1" workspaceId="workspace-1" />,
		)

		expect(container).toBeEmptyDOMElement()
	})

	it("can anchor the lens to an open note", async () => {
		const user = userEvent.setup()
		usePaperConceptLensMock.mockReturnValue({
			data: undefined,
			isLoading: false,
			isError: false,
		})

		render(
			<BlockConceptLensPanel
				blockId={null}
				noteId="note-1"
				paperId="paper-1"
				variant="marginalia"
				workspaceId="workspace-1"
			/>,
		)

		await user.click(screen.getByRole("button", { name: "Open Concept Lens" }))

		expect(screen.getByText("Open note")).toBeInTheDocument()
		expect(usePaperConceptLensMock).toHaveBeenCalledWith("workspace-1", "paper-1", {
			noteId: "note-1",
		})
	})

	it("renders grounded concepts and related semantic hints without creating a review task", () => {
		usePaperConceptLensMock.mockReturnValue({
			isLoading: false,
			isError: false,
			data: {
				workspaceId: "workspace-1",
				paperId: "paper-1",
				blockId: "block-1",
				concepts: [
					{
						id: "concept-1",
						kind: "method",
						canonicalName: "contrastive activation steering",
						displayName: "Contrastive Activation Steering",
						status: "done",
						salienceScore: 0.82,
						highlightCount: 1,
						noteCitationCount: 2,
						sourceLevelDescription:
							"A steering method grounded in contrastive activation differences in this paper.",
						sourceLevelDescriptionStatus: "done",
						readerSignalSummary: "Highlighted once and cited twice.",
						evidence: {
							blockId: "block-1",
							snippet: "We steer activations contrastively.",
							confidence: 0.91,
						},
						cluster: {
							id: "cluster-1",
							displayName: "Activation Steering",
							canonicalName: "activation steering",
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
						similarityScore: 0.88,
						llmDecision: "related",
						decisionStatus: "candidate",
						rationale: "Both describe intervention methods, but with different objectives.",
						relatedCluster: {
							id: "cluster-2",
							displayName: "Representation Steering",
							canonicalName: "representation steering",
							kind: "method",
							memberCount: 3,
							paperCount: 2,
						},
					},
				],
				relatedPapers: [
					{
						id: "edge-1",
						edgeKind: "shared_concepts",
						weight: 0.81,
						status: "active",
						isRetained: false,
						hasReaderNoteEvidence: true,
						paper: {
							id: "paper-node-2",
							paperId: "paper-2",
							title: "A Related Paper",
							authors: ["Ada Lovelace"],
							year: 2026,
							venue: "arXiv",
						},
						strongestEvidence: {
							sourceConceptId: "concept-1",
							targetConceptId: "concept-2",
							sourceConceptName: "Contrastive Activation Steering",
							targetConceptName: "Representation Steering",
							rationale: "Both papers discuss activation-level interventions.",
							sourceEvidenceBlockIds: ["block-1"],
							targetEvidenceBlockIds: ["block-9"],
							currentEvidenceBlockIds: ["block-1"],
							otherEvidenceBlockIds: ["block-9"],
							sourceEvidenceSnippets: [
								{ blockId: "block-1", snippet: "We steer activations contrastively." },
							],
							targetEvidenceSnippets: [
								{ blockId: "block-9", snippet: "We alter representations." },
							],
						},
					},
				],
			},
		})

		render(
			<BlockConceptLensPanel
				blockId="block-1"
				blockNumber={7}
				paperId="paper-1"
				workspaceId="workspace-1"
			/>,
		)

		expect(screen.getByText("Concept Lens")).toBeInTheDocument()
		expect(screen.getByText("Block 7")).toBeInTheDocument()
		expect(screen.getAllByText("Contrastive Activation Steering").length).toBeGreaterThan(0)
		expect(screen.getAllByText("Highlighted once and cited twice.").length).toBeGreaterThan(0)
		expect(screen.getByText("In this passage")).toBeInTheDocument()
		expect(screen.getByText("Across papers")).toBeInTheDocument()
		expect(screen.getByText("A Related Paper")).toBeInTheDocument()
		expect(screen.queryByText(/reader note/)).not.toBeInTheDocument()
		expect(screen.getByRole("link", { name: "Open evidence" })).toHaveAttribute(
			"href",
			"/papers/paper-2?blockId=block-9",
		)
		expect(screen.getByText("From your notes")).toBeInTheDocument()
		expect(screen.getByText("Representation Steering")).toBeInTheDocument()
		expect(screen.queryByText(/LLM: related/)).not.toBeInTheDocument()
		expect(screen.queryByText(/shared concepts/)).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument()
	})

	it("shows all concepts after opening the marginalia lens", async () => {
		const user = userEvent.setup()
		usePaperConceptLensMock.mockReturnValue({
			isLoading: false,
			isError: false,
			data: {
				workspaceId: "workspace-1",
				paperId: "paper-1",
				blockId: "block-1",
				concepts: Array.from({ length: 5 }, (_, index) => ({
					id: `concept-${index + 1}`,
					kind: "concept",
					canonicalName: `concept ${index + 1}`,
					displayName: `Concept ${index + 1}`,
					status: "done",
					salienceScore: 0.7,
					highlightCount: 0,
					noteCitationCount: 0,
					sourceLevelDescription: `Description ${index + 1}`,
					sourceLevelDescriptionStatus: "done",
					readerSignalSummary: null,
					evidence: {
						blockId: "block-1",
						snippet: `Evidence ${index + 1}`,
						confidence: 0.8,
					},
					cluster: null,
				})),
				semanticCandidates: [],
			},
		})

		render(
			<BlockConceptLensPanel
				blockId="block-1"
				blockNumber={7}
				paperId="paper-1"
				variant="marginalia"
				workspaceId="workspace-1"
			/>,
		)

		await user.click(screen.getByRole("button", { name: "Open Concept Lens" }))

		expect(screen.getAllByText("Concept 1").length).toBeGreaterThan(0)
		expect(screen.getByText("Concept 5")).toBeInTheDocument()
		expect(screen.queryByText(/more concepts grounded here/)).not.toBeInTheDocument()
	})

	it("preserves marginalia expand state across selected block changes", async () => {
		const user = userEvent.setup()
		usePaperConceptLensMock.mockReturnValue({
			isLoading: false,
			isError: false,
			data: {
				workspaceId: "workspace-1",
				paperId: "paper-1",
				blockId: "block-1",
				concepts: [
					{
						id: "concept-1",
						kind: "concept",
						canonicalName: "concept 1",
						displayName: "Concept 1",
						status: "done",
						salienceScore: 0.7,
						highlightCount: 0,
						noteCitationCount: 0,
						sourceLevelDescription: "Description 1",
						sourceLevelDescriptionStatus: "done",
						readerSignalSummary: null,
						evidence: {
							blockId: "block-1",
							snippet: "Evidence 1",
							confidence: 0.8,
						},
						cluster: null,
					},
				],
				semanticCandidates: [],
			},
		})

		const { rerender } = render(
			<BlockConceptLensPanel
				blockId="block-1"
				blockNumber={1}
				paperId="paper-1"
				variant="marginalia"
				workspaceId="workspace-1"
			/>,
		)

		await user.click(screen.getByRole("button", { name: "Open Concept Lens" }))
		expect(screen.getByText("Block 1")).toBeInTheDocument()

		rerender(
			<BlockConceptLensPanel
				blockId="block-2"
				blockNumber={2}
				paperId="paper-1"
				variant="marginalia"
				workspaceId="workspace-1"
			/>,
		)

		expect(screen.getByText("Block 2")).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Open Concept Lens" })).not.toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "Close" }))
		rerender(
			<BlockConceptLensPanel
				blockId="block-3"
				blockNumber={3}
				paperId="paper-1"
				variant="marginalia"
				workspaceId="workspace-1"
			/>,
		)

		expect(screen.getByRole("button", { name: "Open Concept Lens" })).toBeInTheDocument()
		expect(screen.queryByText("Block 3")).not.toBeInTheDocument()
	})
})
