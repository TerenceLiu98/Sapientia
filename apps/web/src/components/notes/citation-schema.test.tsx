import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { BlockHighlight } from "@/api/hooks/highlights"
import { BUILTIN_PALETTE } from "@/lib/highlight-palette"

const useHighlightsMock = vi.fn()

vi.mock("@/api/hooks/highlights", () => ({
	useHighlights: (...args: Array<unknown>) => useHighlightsMock(...args),
}))

vi.mock("@/api/hooks/blocks", () => ({
	useBlocks: () => ({ data: [], isLoading: false, error: null }),
}))

async function importCitationBits() {
	const mod = await import("./citation-schema")
	return {
		BlockCitationChip: mod.BlockCitationChip,
		NoteCitationThemeProvider: mod.NoteCitationThemeProvider,
	}
}

describe("BlockCitationChip", () => {
	it("inherits the cited block highlight color", async () => {
		const highlights: BlockHighlight[] = [
			{
				id: "highlight-1",
				paperId: "paper-1",
				blockId: "block-9",
				userId: "user-1",
				workspaceId: "workspace-1",
				color: "important",
				createdAt: "2026-04-27T00:00:00.000Z",
				updatedAt: "2026-04-27T00:00:00.000Z",
			},
		]
		useHighlightsMock.mockReturnValue({ data: highlights })

		const { BlockCitationChip, NoteCitationThemeProvider } = await importCitationBits()
		render(
			<NoteCitationThemeProvider palette={BUILTIN_PALETTE} workspaceId="workspace-1">
				<BlockCitationChip blockId="block-9" blockNumber={9} paperId="paper-1" snapshot="" />
			</NoteCitationThemeProvider>,
		)

		const chip = screen.getByRole("button", { name: /block 9/i })
		expect(chip.style.backgroundColor).toBe("var(--note-important-bg)")
		expect(chip.style.color).toBe("var(--note-important-text)")
	})

	it("opens the cited block in the reader when clicked", async () => {
		useHighlightsMock.mockReturnValue({ data: [] })
		const onOpenBlock = vi.fn()

		const { BlockCitationChip, NoteCitationThemeProvider } = await importCitationBits()
		render(
			<NoteCitationThemeProvider
				onOpenBlock={onOpenBlock}
				palette={BUILTIN_PALETTE}
				workspaceId="workspace-1"
			>
				<BlockCitationChip blockId="block-9" blockNumber={9} paperId="paper-1" snapshot="" />
			</NoteCitationThemeProvider>,
		)

		fireEvent.click(screen.getByRole("button", { name: /block 9/i }))
		expect(onOpenBlock).toHaveBeenCalledWith("paper-1", "block-9")
	})
})
