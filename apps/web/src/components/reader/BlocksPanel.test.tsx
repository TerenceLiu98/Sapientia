import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { Block } from "@/api/hooks/blocks"
import type { BlockHighlight } from "@/api/hooks/highlights"

const useBlocksMock = vi.fn()

vi.mock("@/api/hooks/blocks", () => ({
	useBlocks: (...args: Array<unknown>) => useBlocksMock(...args),
}))

async function importBlocksPanel() {
	const mod = await import("./BlocksPanel")
	return mod.BlocksPanel
}

describe("BlocksPanel", () => {
	it("renders a left-side color band for highlighted blocks", async () => {
		const blocks: Block[] = [
			{
				paperId: "paper-1",
				blockId: "block-1",
				blockIndex: 0,
				type: "text",
				page: 1,
				bbox: { x: 0.1, y: 0.1, w: 0.4, h: 0.2 },
				text: "Alpha text",
				headingLevel: null,
				caption: null,
				imageObjectKey: null,
				imageUrl: null,
				metadata: null,
			},
		]
		const highlights: BlockHighlight[] = [
			{
				id: "h1",
				paperId: "paper-1",
				blockId: "block-1",
				userId: "user-1",
				workspaceId: "workspace-1",
				charStart: 0,
				charEnd: 5,
				selectedText: "Alpha",
				color: "important",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			},
		]
		useBlocksMock.mockReturnValue({
			data: blocks,
			isLoading: false,
			error: null,
		})

		const BlocksPanel = await importBlocksPanel()
		render(<BlocksPanel currentPage={1} highlights={highlights} paperId="paper-1" />)

		expect(screen.getByTestId("highlight-band-block-1")).toBeInTheDocument()
		expect(screen.getByText("Alpha text")).toBeInTheDocument()
	})
})
