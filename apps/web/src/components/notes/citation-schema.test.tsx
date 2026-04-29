import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { BlockHighlight } from "@/api/hooks/highlights"
import type { ReaderAnnotation } from "@/api/hooks/reader-annotations"
import { BUILTIN_PALETTE } from "@/lib/highlight-palette"

const useHighlightsMock = vi.fn()
const useReaderAnnotationsMock = vi.fn()

vi.mock("@/api/hooks/highlights", () => ({
	useHighlights: (...args: Array<unknown>) => useHighlightsMock(...args),
}))

vi.mock("@/api/hooks/reader-annotations", () => ({
	useReaderAnnotations: (...args: Array<unknown>) => useReaderAnnotationsMock(...args),
}))

vi.mock("@/api/hooks/blocks", () => ({
	useBlocks: () => ({ data: [], isLoading: false, error: null }),
}))

async function importCitationBits() {
	const mod = await import("./citation-schema")
	return {
		AnnotationCitationChip: mod.AnnotationCitationChip,
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

describe("AnnotationCitationChip", () => {
	it("uses the live annotation color and opens the cited annotation", async () => {
		useHighlightsMock.mockReturnValue({ data: [] })
		const annotations: ReaderAnnotation[] = [
			{
				id: "annotation-1",
				paperId: "paper-1",
				workspaceId: "workspace-1",
				userId: "user-1",
				page: 12,
				kind: "highlight",
				color: "#f4c84f",
				body: { rect: { x: 0.1, y: 0.22, w: 0.3, h: 0.08 } },
				createdAt: "2026-04-27T00:00:00.000Z",
				updatedAt: "2026-04-27T00:00:00.000Z",
				deletedAt: null,
			},
		]
		useReaderAnnotationsMock.mockReturnValue({ data: annotations })
		const onOpenAnnotation = vi.fn()

		const { AnnotationCitationChip, NoteCitationThemeProvider } = await importCitationBits()
		render(
			<NoteCitationThemeProvider
				onOpenAnnotation={onOpenAnnotation}
				palette={BUILTIN_PALETTE}
				workspaceId="workspace-1"
			>
				<AnnotationCitationChip
					annotationId="annotation-1"
					annotationKind="highlight"
					color=""
					page={12}
					paperId="paper-1"
					snapshot=""
					yRatio={0.22}
				/>
			</NoteCitationThemeProvider>,
		)

		// New canonical chip label: `highlight p. 12` (no ordinal here
		// because the test doesn't supply `annotationOrdinalById`).
		const chip = screen.getByRole("button", { name: /highlight p\. 12/i })
		expect(chip.style.backgroundColor).toBe("rgba(244, 200, 79, 0.2)")
		fireEvent.click(chip)
		expect(onOpenAnnotation).toHaveBeenCalledWith("paper-1", "annotation-1", 12, 0.22)
	})
})
