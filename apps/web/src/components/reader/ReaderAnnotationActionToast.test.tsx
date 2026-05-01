import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import {
	ReaderAnnotationActionToast,
	type ReaderAnnotationRecallState,
} from "./ReaderAnnotationActionToast"

describe("ReaderAnnotationActionToast", () => {
	it("renders created highlight copy and handles undo + dismiss", async () => {
		const user = userEvent.setup()
		const onUndo = vi.fn()
		const onDismiss = vi.fn()
		const onPause = vi.fn()
		const onResume = vi.fn()
		const recall: ReaderAnnotationRecallState = {
			action: "created",
			annotationId: "annotation-1",
			annotation: {
				kind: "highlight",
				color: "#f4c84f",
				body: {
					quote: "Selected page 1 text",
					rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.1 }],
				},
			},
			page: 1,
		}

		render(
			<ReaderAnnotationActionToast
				onDismiss={onDismiss}
				onPause={onPause}
				onResume={onResume}
				onUndo={onUndo}
				recall={recall}
			/>,
		)

		expect(screen.getByLabelText("Highlight added")).toBeInTheDocument()
		expect(screen.getByText("Selected page 1 text")).toBeInTheDocument()
		expect(screen.getByText("Cmd")).toBeInTheDocument()
		expect(screen.getByText("Ctrl")).toBeInTheDocument()
		expect(screen.getByText("Z")).toBeInTheDocument()

		const panel = screen.getByText("Selected page 1 text").closest("div")
		expect(panel).not.toBeNull()
		if (panel) {
			await user.hover(panel)
			expect(onPause).toHaveBeenCalledTimes(1)

			await user.unhover(panel)
			expect(onResume).toHaveBeenCalledTimes(1)
		}

		await user.click(screen.getByRole("button", { name: "Undo recent annotation action" }))
		expect(onUndo).toHaveBeenCalledTimes(1)

		await user.click(screen.getByRole("button", { name: "Dismiss annotation action" }))
		expect(onDismiss).toHaveBeenCalledTimes(1)
	})

	it("renders deleted underline copy", () => {
		const recall: ReaderAnnotationRecallState = {
			action: "deleted",
			annotationId: "annotation-2",
			annotation: {
				kind: "underline",
				color: "#3b82f6",
				body: {
					quote:
						"This is a much longer underline quote that should get truncated in the action recall toast for readability.",
					rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.1 }],
				},
			},
			page: 2,
			softDeleted: false,
		}

		render(
			<ReaderAnnotationActionToast
				onDismiss={vi.fn()}
				onUndo={vi.fn()}
				recall={recall}
			/>,
		)

		expect(screen.getByLabelText("Underline deleted")).toBeInTheDocument()
		expect(screen.getByText(/This is a much longer underline quote/)).toBeInTheDocument()
	})
})
