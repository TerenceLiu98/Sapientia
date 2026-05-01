import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/api/client"
import { PaperWikiDebugPanel } from "./PaperWikiDebugPanel"

const usePaperWikiMock = vi.fn()
const useCompilePaperWikiMock = vi.fn()

vi.mock("@/api/hooks/papers", () => ({
	usePaperWiki: (...args: Array<unknown>) => usePaperWikiMock(...args),
	useCompilePaperWiki: (...args: Array<unknown>) => useCompilePaperWikiMock(...args),
}))

describe("PaperWikiDebugPanel", () => {
	beforeEach(() => {
		usePaperWikiMock.mockReset()
		useCompilePaperWikiMock.mockReset()
	})

	it("renders the source page and local concepts when expanded", async () => {
		const user = userEvent.setup()
		usePaperWikiMock.mockReturnValue({
			data: {
				page: {
					id: "page-1",
					type: "source",
					canonicalName: "a-new-resampling-method-for-meta-gaussian-distributions",
					displayName: "A new resampling method for meta Gaussian distributions",
					body: "# Source Page\n\n## Central Claim\nMeta Gaussian distributions...",
					status: "done",
					error: null,
					generatedAt: "2026-05-01T12:00:00.000Z",
					modelName: "gpt-5",
					promptVersion: "paper-compile-v1",
					sourcePaperId: "paper-1",
					referenceBlockIds: ["block-1", "block-2"],
				},
				concepts: [
					{
						id: "concept-1",
						kind: "method",
						canonicalName: "mse-rps",
						displayName: "MSE-RPs",
						status: "done",
						error: null,
						salienceScore: 2.4,
						highlightCount: 1,
						weightedHighlightScore: 0.9,
						noteCitationCount: 1,
						lastMarginaliaAt: "2026-05-01T12:05:00.000Z",
						generatedAt: "2026-05-01T12:00:00.000Z",
						modelName: "gpt-5",
						promptVersion: "paper-compile-v1",
						evidence: [
							{
								blockId: "block-1",
								snippet: "We introduce MSE-RPs to construct accurate approximations.",
								confidence: 0.92,
							},
						],
					},
				],
				edges: [
					{
						id: "edge-1",
						sourceConceptId: "concept-1",
						targetConceptId: "concept-1",
						relationType: "related_to",
						confidence: 0.75,
						evidence: [
							{
								blockId: "block-1",
								snippet: "We introduce MSE-RPs to construct accurate approximations.",
								confidence: 0.92,
							},
						],
					},
				],
			},
			error: null,
			isLoading: false,
		})
		useCompilePaperWikiMock.mockReturnValue({
			isPending: false,
			mutateAsync: vi.fn(),
		})

		render(<PaperWikiDebugPanel paperId="paper-1" workspaceId="workspace-1" />)

		expect(screen.getByText("1 concepts · 1 edges · 2 refs")).toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "Show" }))

		expect(
			screen.getByText("A new resampling method for meta Gaussian distributions"),
		).toBeInTheDocument()
		expect(screen.getByText(/# Source Page/)).toBeInTheDocument()
		expect(screen.getByText(/## Central Claim/)).toBeInTheDocument()
		expect(screen.getByText(/Meta Gaussian distributions/)).toBeInTheDocument()
		expect(screen.getByText("MSE-RPs")).toBeInTheDocument()
		expect(screen.getByText("method")).toBeInTheDocument()
		expect(screen.getAllByText("block-1")).toHaveLength(2)
		expect(screen.getByText(/Inner Graph Edges/)).toBeInTheDocument()
	})

	it("shows a not-found summary and can queue a recompile", async () => {
		const user = userEvent.setup()
		const mutateAsync = vi.fn().mockResolvedValue(undefined)
		usePaperWikiMock.mockReturnValue({
			data: undefined,
			error: new ApiError(404, "not found", { error: "source page not found" }),
			isLoading: false,
		})
		useCompilePaperWikiMock.mockReturnValue({
			isPending: false,
			mutateAsync,
		})

		render(<PaperWikiDebugPanel paperId="paper-1" workspaceId="workspace-1" />)

		expect(screen.getByText("No source page yet")).toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "Recompile" }))
		expect(mutateAsync).toHaveBeenCalledOnce()
	})
})
