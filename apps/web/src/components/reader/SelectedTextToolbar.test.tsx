import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { SelectedTextToolbar } from "./SelectedTextToolbar"
import type { ReaderSelectionContext } from "./reader-selection"

const pdfSelection: ReaderSelectionContext = {
	selectedText: "Selected page 1 text",
	blockIds: ["block-1"],
	anchorRect: {
		left: 120,
		top: 140,
		width: 100,
		height: 20,
	},
	mode: "pdf",
	annotationTarget: {
		page: 1,
		body: {
			quote: "Selected page 1 text",
			rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.1 }],
		},
	},
}

describe("SelectedTextToolbar", () => {
	it("renders color swatches plus icon actions for PDF text markup", async () => {
		const user = userEvent.setup()
		const onHighlight = vi.fn()
		const onUnderline = vi.fn()
		const onChangeAnnotationColor = vi.fn()

		render(
			<SelectedTextToolbar
				annotationColor="#f4c84f"
				onAskAgent={vi.fn()}
				onChangeAnnotationColor={onChangeAnnotationColor}
				onCopy={vi.fn()}
				onDismiss={vi.fn()}
				onHighlight={onHighlight}
				onUnderline={onUnderline}
				selection={pdfSelection}
			/>,
		)

		await user.click(screen.getByRole("button", { name: "Use Red annotation color" }))
		expect(onChangeAnnotationColor).toHaveBeenCalledWith("#ff6b6b")

		await user.click(screen.getByRole("button", { name: "Highlight selected text" }))
		expect(onHighlight).toHaveBeenCalledWith(pdfSelection)

		await user.click(screen.getByRole("button", { name: "Underline selected text" }))
		expect(onUnderline).toHaveBeenCalledWith(pdfSelection)
	})

	it("hides annotation actions for markdown selections", () => {
		render(
			<SelectedTextToolbar
				onAskAgent={vi.fn()}
				onCopy={vi.fn()}
				onDismiss={vi.fn()}
				onHighlight={vi.fn()}
				onUnderline={vi.fn()}
				selection={{
					...pdfSelection,
					mode: "markdown",
					annotationTarget: undefined,
				}}
			/>,
		)

		expect(screen.queryByRole("button", { name: "Highlight selected text" })).toBeNull()
		expect(screen.queryByRole("button", { name: "Underline selected text" })).toBeNull()
	})

	it("calls onAskAgent with the current selection", async () => {
		const user = userEvent.setup()
		const onAskAgent = vi.fn()

		render(
			<SelectedTextToolbar
				onAskAgent={onAskAgent}
				onCopy={vi.fn()}
				onDismiss={vi.fn()}
				onHighlight={vi.fn()}
				onUnderline={vi.fn()}
				selection={pdfSelection}
			/>,
		)

		await user.click(screen.getByRole("button", { name: "Ask AI in a note about this selected text" }))
		expect(onAskAgent).toHaveBeenCalledWith(pdfSelection)
	})
})
