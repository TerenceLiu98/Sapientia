import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Block } from "@/api/hooks/blocks"
import { BUILTIN_PALETTE } from "@/lib/highlight-palette"

const useBlocksMock = vi.fn()
const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
let scrollTopValue = 100
let scrollToMock: ReturnType<typeof vi.fn>

vi.mock("@/api/hooks/blocks", () => ({
	useBlocks: (...args: Array<unknown>) => useBlocksMock(...args),
}))

async function importBlocksPanel() {
	const mod = await import("./BlocksPanel")
	return mod.BlocksPanel
}

beforeEach(() => {
	useBlocksMock.mockReset()
	scrollTopValue = 100
	scrollToMock = vi.fn(({ top }: { top: number }) => {
		scrollTopValue = top
	})
	Object.defineProperty(HTMLElement.prototype, "clientHeight", {
		configurable: true,
		get() {
			return 400
		},
	})
	Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
		configurable: true,
		get() {
			return 1200
		},
	})
	Object.defineProperty(HTMLElement.prototype, "scrollTop", {
		configurable: true,
		get() {
			return scrollTopValue
		},
		set(value: number) {
			scrollTopValue = value
		},
	})
	Object.defineProperty(HTMLElement.prototype, "scrollTo", {
		configurable: true,
		value: scrollToMock,
	})
})

afterEach(() => {
	HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect
	delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
	delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight
	delete (HTMLElement.prototype as { scrollTop?: number }).scrollTop
	delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo
})

describe("BlocksPanel", () => {
	it("paints the block-level highlight fill on a card", async () => {
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
		const colorByBlock = new Map([["block-1", "important"]])

		useBlocksMock.mockReturnValue({ data: blocks, isLoading: false, error: null })

		const BlocksPanel = await importBlocksPanel()
		render(
			<BlocksPanel
				colorByBlock={colorByBlock}
				currentPage={1}
				palette={BUILTIN_PALETTE}
				paperId="paper-1"
			/>,
		)

		expect(screen.getByText("Alpha text")).toBeInTheDocument()
		// The block row carries the highlight via inline `background-color`.
		const row = screen.getByRole("button", { name: /alpha text/i })
		expect(row.style.backgroundColor).toMatch(/var\(--note-important-bg\)/)
	})

	it("reports the active page and anchor ratio from parsed-view scrolling", async () => {
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
			{
				paperId: "paper-1",
				blockId: "block-2",
				blockIndex: 1,
				type: "text",
				page: 2,
				bbox: { x: 0.1, y: 0.3, w: 0.4, h: 0.2 },
				text: "Beta text",
				headingLevel: null,
				caption: null,
				imageObjectKey: null,
				imageUrl: null,
				metadata: null,
			},
		]
		const onViewportAnchorChange = vi.fn()

		useBlocksMock.mockReturnValue({ data: blocks, isLoading: false, error: null })
		HTMLElement.prototype.getBoundingClientRect = function () {
			const text = this.textContent ?? ""
			if (this.className.includes("overflow-y-auto")) {
				return {
					top: 0,
					bottom: 400,
					height: 400,
					left: 0,
					right: 300,
					width: 300,
					x: 0,
					y: 0,
					toJSON() {},
				}
			}
			if (text.includes("Page 1") && text.includes("Alpha text")) {
				return {
					top: -220,
					bottom: 20,
					height: 240,
					left: 0,
					right: 300,
					width: 300,
					x: 0,
					y: -220,
					toJSON() {},
				}
			}
			if (text.includes("Page 2") && text.includes("Beta text")) {
				return {
					top: 20,
					bottom: 280,
					height: 260,
					left: 0,
					right: 300,
					width: 300,
					x: 0,
					y: 20,
					toJSON() {},
				}
			}
			if (text.includes("Alpha text")) {
				return {
					top: -140,
					bottom: -60,
					height: 80,
					left: 0,
					right: 300,
					width: 300,
					x: 0,
					y: -140,
					toJSON() {},
				}
			}
			if (text.includes("Beta text")) {
				return {
					top: 120,
					bottom: 200,
					height: 80,
					left: 0,
					right: 300,
					width: 300,
					x: 0,
					y: 120,
					toJSON() {},
				}
			}
			return { top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON() {} }
		}

		const BlocksPanel = await importBlocksPanel()
		const { container } = render(
			<BlocksPanel paperId="paper-1" onViewportAnchorChange={onViewportAnchorChange} />,
		)

		fireEvent.scroll(container.querySelector(".overflow-y-auto") as HTMLElement)

		await waitFor(() => {
			expect(onViewportAnchorChange).toHaveBeenCalled()
		})
		expect(onViewportAnchorChange).toHaveBeenLastCalledWith(2, 0.4)
	})

	it("scrolls to a requested page anchor in parsed-only mode", async () => {
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
			{
				paperId: "paper-1",
				blockId: "block-2",
				blockIndex: 1,
				type: "text",
				page: 2,
				bbox: { x: 0.1, y: 0.3, w: 0.4, h: 0.2 },
				text: "Beta text",
				headingLevel: null,
				caption: null,
				imageObjectKey: null,
				imageUrl: null,
				metadata: null,
			},
		]

		useBlocksMock.mockReturnValue({ data: blocks, isLoading: false, error: null })
		HTMLElement.prototype.getBoundingClientRect = function () {
			const text = this.textContent ?? ""
			if (this.className.includes("overflow-y-auto")) {
				return {
					top: 0,
					bottom: 400,
					height: 400,
					left: 0,
					right: 300,
					width: 300,
					x: 0,
					y: 0,
					toJSON() {},
				}
			}
			if (text.includes("Page 2") && text.includes("Beta text")) {
				return {
					top: 20,
					bottom: 280,
					height: 260,
					left: 0,
					right: 300,
					width: 300,
					x: 0,
					y: 20,
					toJSON() {},
				}
			}
			if (text.includes("Beta text")) {
				return {
					top: 120,
					bottom: 200,
					height: 80,
					left: 0,
					right: 300,
					width: 300,
					x: 0,
					y: 120,
					toJSON() {},
				}
			}
			return {
				top: 0,
				bottom: 0,
				height: 0,
				left: 0,
				right: 0,
				width: 0,
				x: 0,
				y: 0,
				toJSON() {},
			}
		}

		const BlocksPanel = await importBlocksPanel()
		render(
			<BlocksPanel
				paperId="paper-1"
				requestedAnchorYRatio={0.38}
				requestedPage={2}
				requestedPageNonce={1}
			/>,
		)

		await waitFor(() => {
			expect(scrollToMock).toHaveBeenCalled()
		})
		expect(scrollToMock).toHaveBeenCalledWith({ top: 212, behavior: "smooth" })
	})

	it("notifies the workspace when the user clicks back into the parsed article", async () => {
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
		const onInteract = vi.fn()
		const user = userEvent.setup()

		useBlocksMock.mockReturnValue({ data: blocks, isLoading: false, error: null })

		const BlocksPanel = await importBlocksPanel()
		render(<BlocksPanel onInteract={onInteract} paperId="paper-1" />)

		await user.click(screen.getByRole("button", { name: /alpha text/i }))

		expect(onInteract).toHaveBeenCalledTimes(1)
	})
})
