import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Block } from "@/api/hooks/blocks"

const refetchMock = vi.fn()
const usePaperPdfUrlMock = vi.fn()
const pdfDocumentGetDestinationMock = vi.fn()
const originalGetSelection = window.getSelection
let documentItemClickArgs:
	| {
			dest?: unknown
			pageIndex: number
			pageNumber: number
	  }
	| null = null

vi.mock("@/api/hooks/papers", () => ({
	usePaperPdfUrl: (...args: Array<unknown>) => usePaperPdfUrlMock(...args),
}))

vi.mock("react-pdf", () => ({
	Document: ({
		children,
		onLoadSuccess,
		onItemClick,
	}: {
		children?: ReactNode
		onLoadSuccess?: (info: { getDestination: typeof pdfDocumentGetDestinationMock; numPages: number }) => void
		onItemClick?: (args: { dest?: unknown; pageIndex: number; pageNumber: number }) => void
	}) => {
		// Trigger numPages discovery synchronously so the page list renders.
		queueMicrotask(() =>
			onLoadSuccess?.({
				getDestination: pdfDocumentGetDestinationMock,
				numPages: 3,
			}),
		)
		return (
			<div data-testid="pdf-document">
				<button
					data-testid="pdf-internal-link"
					onClick={() => {
						if (documentItemClickArgs) onItemClick?.(documentItemClickArgs)
					}}
					type="button"
				>
					Jump
				</button>
				{children}
			</div>
		)
	},
	Page: ({
		pageNumber,
		pageColors,
		scale,
		renderTextLayer,
		onLoadSuccess,
		onRenderSuccess,
	}: {
		pageNumber: number
		pageColors?: { background: string; foreground: string }
		scale: number
		renderTextLayer?: boolean
		onLoadSuccess?: (page: { view: number[] }) => void
		onRenderSuccess?: () => void
	}) => {
		queueMicrotask(() => onLoadSuccess?.({ view: [0, 0, 600, 800] }))
		queueMicrotask(() => onRenderSuccess?.())
		return (
			<div
				data-page-colors={pageColors ? JSON.stringify(pageColors) : ""}
				data-testid={`pdf-page-${pageNumber}`}
				data-scale={scale}
			>
				<canvas data-testid={`pdf-canvas-${pageNumber}`} />
				{renderTextLayer ? (
					<div className="react-pdf__Page__textContent">
						<span>{`Selected page ${pageNumber} text`}</span>
					</div>
				) : null}
				page {pageNumber}
			</div>
		)
	},
}))

function makeWrapper() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	)
}

beforeEach(async () => {
	refetchMock.mockReset()
	usePaperPdfUrlMock.mockReset()
	pdfDocumentGetDestinationMock.mockReset()
	documentItemClickArgs = null
	Object.defineProperty(HTMLElement.prototype, "clientWidth", {
		configurable: true,
		get() {
			return 872
		},
	})
	// Pointer-capture API isn't implemented for SVG nodes in JSDOM. The
	// drawing surface is a <rect> (SVGRectElement) and the parent <svg>
	// is SVGSVGElement — stub both prototypes.
	for (const proto of [SVGSVGElement.prototype, SVGElement.prototype]) {
		if (!(proto as { setPointerCapture?: unknown }).setPointerCapture) {
			;(proto as { setPointerCapture: (id: number) => void }).setPointerCapture = vi.fn()
		}
		if (!(proto as { releasePointerCapture?: unknown }).releasePointerCapture) {
			;(proto as { releasePointerCapture: (id: number) => void }).releasePointerCapture = vi.fn()
		}
	}
})

afterEach(() => {
	vi.clearAllMocks()
	delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
	delete document.documentElement.dataset.theme
	Object.defineProperty(window, "getSelection", {
		configurable: true,
		value: originalGetSelection,
	})
})

async function importPdfViewer() {
	const mod = await import("./PdfViewer")
	return mod.PdfViewer
}

describe("PdfViewer", () => {
	it("renders the loading state while the URL hook is pending", async () => {
		usePaperPdfUrlMock.mockReturnValue({
			data: undefined,
			isLoading: true,
			isError: false,
			refetch: refetchMock,
		})
		const PdfViewer = await importPdfViewer()
		const Wrapper = makeWrapper()

		render(
			<Wrapper>
				<PdfViewer paperId="paper-1" />
			</Wrapper>,
		)

		expect(screen.getByText(/loading pdf/i)).toBeInTheDocument()
	})

	it("renders an error with retry when the URL hook fails", async () => {
		usePaperPdfUrlMock.mockReturnValue({
			data: undefined,
			isLoading: false,
			isError: true,
			refetch: refetchMock,
		})
		const PdfViewer = await importPdfViewer()
		const Wrapper = makeWrapper()
		const user = userEvent.setup()

		render(
			<Wrapper>
				<PdfViewer paperId="paper-1" />
			</Wrapper>,
		)

		expect(screen.getByText(/failed to load pdf/i)).toBeInTheDocument()
		const retry = screen.getByRole("button", { name: /retry/i })
		await user.click(retry)
		expect(refetchMock).toHaveBeenCalledTimes(1)
	})

	it("renders the document when URL is available", async () => {
		usePaperPdfUrlMock.mockReturnValue({
			data: { url: "http://test/pdf", expiresInSeconds: 3600 },
			isLoading: false,
			isError: false,
			refetch: refetchMock,
		})
		const PdfViewer = await importPdfViewer()
		const Wrapper = makeWrapper()

		render(
			<Wrapper>
				<PdfViewer paperId="paper-1" />
			</Wrapper>,
		)

		expect(screen.getByTestId("pdf-document")).toBeInTheDocument()
	})

	it("applies a dark-mode filter to rendered PDF canvases", async () => {
		document.documentElement.dataset.theme = "dark"
		usePaperPdfUrlMock.mockReturnValue({
			data: { url: "http://test/pdf", expiresInSeconds: 3600 },
			isLoading: false,
			isError: false,
			refetch: refetchMock,
		})
		const PdfViewer = await importPdfViewer()
		const Wrapper = makeWrapper()

		render(
			<Wrapper>
				<PdfViewer paperId="paper-1" />
			</Wrapper>,
		)

		const canvas = await screen.findByTestId("pdf-canvas-1")
		expect((canvas as HTMLCanvasElement).style.filter).toBe("var(--pdf-dark-display-filter)")
		expect((canvas as HTMLCanvasElement).style.opacity).toBe("var(--pdf-dark-display-opacity)")
	})

	it("reapplies the dark-mode filter when react-pdf swaps the canvas element", async () => {
		document.documentElement.dataset.theme = "dark"
		usePaperPdfUrlMock.mockReturnValue({
			data: { url: "http://test/pdf", expiresInSeconds: 3600 },
			isLoading: false,
			isError: false,
			refetch: refetchMock,
		})
		const PdfViewer = await importPdfViewer()
		const Wrapper = makeWrapper()

		render(
			<Wrapper>
				<PdfViewer paperId="paper-1" />
			</Wrapper>,
		)

		const originalCanvas = await screen.findByTestId("pdf-canvas-1")
		expect((originalCanvas as HTMLCanvasElement).style.filter).toBe(
			"var(--pdf-dark-display-filter)",
		)

		const page = screen.getByTestId("pdf-page-1")
		const replacementCanvas = document.createElement("canvas")
		replacementCanvas.dataset.testid = "pdf-canvas-1-replacement"
		originalCanvas.remove()
		page.prepend(replacementCanvas)

		await waitFor(() => {
			expect(replacementCanvas.style.filter).toBe("var(--pdf-dark-display-filter)")
			expect(replacementCanvas.style.opacity).toBe("var(--pdf-dark-display-opacity)")
		})
	})

	it("targets the visible page canvas instead of a hidden measurement canvas", async () => {
		document.documentElement.dataset.theme = "dark"
		usePaperPdfUrlMock.mockReturnValue({
			data: { url: "http://test/pdf", expiresInSeconds: 3600 },
			isLoading: false,
			isError: false,
			refetch: refetchMock,
		})
		const PdfViewer = await importPdfViewer()
		const Wrapper = makeWrapper()

		render(
			<Wrapper>
				<PdfViewer paperId="paper-1" />
			</Wrapper>,
		)

		const page = await screen.findByTestId("pdf-page-1")
		const visibleCanvas = screen.getByTestId("pdf-canvas-1") as HTMLCanvasElement
		const hiddenCanvas = document.createElement("canvas")
		hiddenCanvas.className = "hiddenCanvasElement"
		page.prepend(hiddenCanvas)

		fireEvent(document, new Event("selectionchange"))

		await waitFor(() => {
			expect(visibleCanvas.style.filter).toBe("var(--pdf-dark-display-filter)")
			expect(visibleCanvas.style.opacity).toBe("var(--pdf-dark-display-opacity)")
		})
		expect(hiddenCanvas.style.filter).toBe("")
	})

	it("emits selected-text context for PDF text-layer selections", async () => {
		usePaperPdfUrlMock.mockReturnValue({
			data: { url: "http://test/pdf", expiresInSeconds: 3600 },
			isLoading: false,
			isError: false,
			refetch: refetchMock,
		})
		const onSelectedTextChange = vi.fn()
		const PdfViewer = await importPdfViewer()
		const Wrapper = makeWrapper()
		const blocks: Block[] = [
			{
				paperId: "paper-1",
				blockId: "block-1",
				blockIndex: 0,
				page: 1,
				type: "text",
				text: "Selected page 1 text",
				headingLevel: null,
				caption: null,
				imageObjectKey: null,
				imageUrl: null,
				metadata: null,
				bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
			},
		]

		render(
			<Wrapper>
				<PdfViewer
					blocks={blocks}
					onSelectedTextChange={onSelectedTextChange}
					paperId="paper-1"
				/>
			</Wrapper>,
		)

		const rail = await screen.findByTitle("Selected page 1 text")
		const blockShell = rail.closest("[data-block-id]") as HTMLElement | null
		expect(blockShell).not.toBeNull()
		vi.spyOn(blockShell as HTMLElement, "getBoundingClientRect").mockReturnValue({
			x: 100,
			y: 120,
			top: 120,
			left: 100,
			right: 260,
			bottom: 180,
			width: 160,
			height: 60,
			toJSON: () => ({}),
		} as DOMRect)

		const textLayer = rail
			.closest("[data-page-number]")
			?.querySelector(".react-pdf__Page__textContent") as HTMLElement | null
		expect(textLayer).not.toBeNull()
		const canvas = rail.closest("[data-page-number]")?.querySelector("canvas") as HTMLCanvasElement | null
		expect(canvas).not.toBeNull()
		vi.spyOn(canvas as HTMLCanvasElement, "getBoundingClientRect").mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 600,
			bottom: 800,
			width: 600,
			height: 800,
			toJSON: () => ({}),
		} as DOMRect)

		const selection = {
			getRangeAt: vi.fn(() => ({
				commonAncestorContainer: textLayer,
				getBoundingClientRect: () => ({
					left: 110,
					top: 130,
					width: 120,
					height: 18,
				}),
				getClientRects: () => [
					{
						left: 110,
						top: 130,
						right: 230,
						bottom: 148,
						width: 120,
						height: 18,
					},
				],
				intersectsNode: (node: Node) => node === textLayer,
			})),
			isCollapsed: false,
			rangeCount: 1,
			toString: () => "Selected page 1 text",
		}

		Object.defineProperty(window, "getSelection", {
			configurable: true,
			value: vi.fn(() => selection),
		})

		document.dispatchEvent(new Event("selectionchange"))

		await waitFor(() => {
			expect(onSelectedTextChange).toHaveBeenCalledWith({
				anchorRect: {
					left: 110,
					top: 130,
					width: 120,
					height: 18,
				},
				annotationTarget: {
					body: {
						quote: "Selected page 1 text",
						rects: [{ x: 110 / 600, y: 130 / 800, w: 120 / 600, h: 18 / 800 }],
					},
					page: 1,
				},
				blockIds: ["block-1"],
				mode: "pdf",
				selectedText: "Selected page 1 text",
			})
		})
	})

	it("skips malformed bbox overlays instead of rendering page-covering hit targets", async () => {
		usePaperPdfUrlMock.mockReturnValue({
			data: { url: "http://test/pdf", expiresInSeconds: 3600 },
			isLoading: false,
			isError: false,
			refetch: refetchMock,
		})
		const PdfViewer = await importPdfViewer()
		const Wrapper = makeWrapper()
		const blocks: Block[] = [
			{
				paperId: "paper-1",
				blockId: "good",
				blockIndex: 0,
				page: 1,
				type: "text",
				text: "Good block",
				headingLevel: null,
				caption: null,
				imageObjectKey: null,
				imageUrl: null,
				metadata: null,
				bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
			},
			{
				paperId: "paper-1",
				blockId: "bad",
				blockIndex: 1,
				page: 1,
				type: "text",
				text: "Bad block",
				headingLevel: null,
				caption: null,
				imageObjectKey: null,
				imageUrl: null,
				metadata: null,
				bbox: { x: 1.23, y: 0.2, w: 1.15, h: 0.2 },
			},
		]

		render(
			<Wrapper>
				<PdfViewer blocks={blocks} paperId="paper-1" />
			</Wrapper>,
		)

		expect(await screen.findByTestId("pdf-document")).toBeInTheDocument()
		expect(await screen.findByTitle("Good block")).toBeInTheDocument()
		expect(screen.queryByTitle("Bad block")).not.toBeInTheDocument()
	})

	it("collapses notes when the user clicks back into the PDF surface", async () => {
		usePaperPdfUrlMock.mockReturnValue({
			data: { url: "http://test/pdf", expiresInSeconds: 3600 },
			isLoading: false,
			isError: false,
			refetch: refetchMock,
		})
		const onInteract = vi.fn()
		const PdfViewer = await importPdfViewer()
		const Wrapper = makeWrapper()
		const user = userEvent.setup()

		render(
			<Wrapper>
				<PdfViewer onInteract={onInteract} paperId="paper-1" />
			</Wrapper>,
		)

		await user.click(await screen.findByTestId("pdf-page-1"))

		expect(onInteract).toHaveBeenCalledTimes(1)
	})

	it("clicking the already-selected block clears the PDF overlay selection", async () => {
		usePaperPdfUrlMock.mockReturnValue({
			data: { url: "http://test/pdf", expiresInSeconds: 3600 },
			isLoading: false,
			isError: false,
			refetch: refetchMock,
		})
		const onClearSelectedBlock = vi.fn()
		const PdfViewer = await importPdfViewer()
		const Wrapper = makeWrapper()
		const user = userEvent.setup()
		const blocks: Block[] = [
			{
				paperId: "paper-1",
				blockId: "selected",
				blockIndex: 0,
				page: 1,
				type: "text",
				text: "Selected block",
				headingLevel: null,
				caption: null,
				imageObjectKey: null,
				imageUrl: null,
				metadata: null,
				bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
			},
		]

		render(
			<Wrapper>
				<PdfViewer
					blocks={blocks}
					onClearSelectedBlock={onClearSelectedBlock}
					paperId="paper-1"
					selectedBlockId="selected"
				/>
			</Wrapper>,
		)

		await user.click(await screen.findByTitle("Selected block"))
		expect(onClearSelectedBlock).toHaveBeenCalledTimes(1)
	})

	it("shows a draggable media preview for a selected figure block", async () => {
		usePaperPdfUrlMock.mockReturnValue({
			data: { url: "http://test/pdf", expiresInSeconds: 3600 },
			isLoading: false,
			isError: false,
			refetch: refetchMock,
		})
		const PdfViewer = await importPdfViewer()
		const Wrapper = makeWrapper()
		const blocks: Block[] = [
			{
				paperId: "paper-1",
				blockId: "figure-1",
				blockIndex: 0,
				page: 2,
				type: "figure",
				text: "",
				headingLevel: null,
				caption: "A magnified chart",
				imageObjectKey: "figures/1",
				imageUrl: "http://test/image.png",
				metadata: null,
				bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
			},
		]

		render(
			<Wrapper>
				<PdfViewer blocks={blocks} paperId="paper-1" selectedBlockId="figure-1" />
			</Wrapper>,
		)

		expect(await screen.findByAltText("A magnified chart")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /rotate preview/i })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /^resize focused preview$/i })).toBeInTheDocument()
		expect(screen.queryByText(/focused figure/i)).not.toBeInTheDocument()
	})

	it("does not show the floating preview for selected text blocks", async () => {
		usePaperPdfUrlMock.mockReturnValue({
			data: { url: "http://test/pdf", expiresInSeconds: 3600 },
			isLoading: false,
			isError: false,
			refetch: refetchMock,
		})
		const PdfViewer = await importPdfViewer()
		const Wrapper = makeWrapper()
		const blocks: Block[] = [
			{
				paperId: "paper-1",
				blockId: "text-1",
				blockIndex: 0,
				page: 1,
				type: "text",
				text: "Some paragraph",
				headingLevel: null,
				caption: null,
				imageObjectKey: null,
				imageUrl: null,
				metadata: null,
				bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
			},
		]

		render(
			<Wrapper>
				<PdfViewer blocks={blocks} paperId="paper-1" selectedBlockId="text-1" />
			</Wrapper>,
		)

		await screen.findByTestId("pdf-document")
		expect(screen.queryByText(/focused block/i)).not.toBeInTheDocument()
	})

	it("dismisses the focused preview via backdrop click", async () => {
		usePaperPdfUrlMock.mockReturnValue({
			data: { url: "http://test/pdf", expiresInSeconds: 3600 },
			isLoading: false,
			isError: false,
			refetch: refetchMock,
		})
		const onClearSelectedBlock = vi.fn()
		const PdfViewer = await importPdfViewer()
		const Wrapper = makeWrapper()
		const blocks: Block[] = [
			{
				paperId: "paper-1",
				blockId: "figure-1",
				blockIndex: 0,
				page: 2,
				type: "figure",
				text: "",
				headingLevel: null,
				caption: "A magnified chart",
				imageObjectKey: "figures/1",
				imageUrl: "http://test/image.png",
				metadata: null,
				bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
			},
		]
		const user = userEvent.setup()

		render(
			<Wrapper>
				<PdfViewer
					blocks={blocks}
					onClearSelectedBlock={onClearSelectedBlock}
					paperId="paper-1"
					selectedBlockId="figure-1"
				/>
			</Wrapper>,
		)

		await user.click(await screen.findByRole("button", { name: /close focused preview/i }))
		expect(onClearSelectedBlock).toHaveBeenCalledTimes(1)
	})

	it("dismisses the focused preview via Escape", async () => {
		usePaperPdfUrlMock.mockReturnValue({
			data: { url: "http://test/pdf", expiresInSeconds: 3600 },
			isLoading: false,
			isError: false,
			refetch: refetchMock,
		})
		const onClearSelectedBlock = vi.fn()
		const PdfViewer = await importPdfViewer()
		const Wrapper = makeWrapper()
		const blocks: Block[] = [
			{
				paperId: "paper-1",
				blockId: "figure-1",
				blockIndex: 0,
				page: 2,
				type: "figure",
				text: "",
				headingLevel: null,
				caption: "A magnified chart",
				imageObjectKey: "figures/1",
				imageUrl: "http://test/image.png",
				metadata: null,
				bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
			},
		]

		render(
			<Wrapper>
				<PdfViewer
					blocks={blocks}
					onClearSelectedBlock={onClearSelectedBlock}
					paperId="paper-1"
					selectedBlockId="figure-1"
				/>
			</Wrapper>,
		)

		await screen.findByAltText("A magnified chart")
		fireEvent.keyDown(window, { key: "Escape" })
		expect(onClearSelectedBlock).toHaveBeenCalledTimes(1)
	})

	it("renders persisted reader annotations as a separate overlay layer", async () => {
		usePaperPdfUrlMock.mockReturnValue({
			data: { url: "http://test/pdf", expiresInSeconds: 3600 },
			isLoading: false,
			isError: false,
			refetch: refetchMock,
		})
		const PdfViewer = await importPdfViewer()
		const Wrapper = makeWrapper()

		render(
			<Wrapper>
				<PdfViewer
					paperId="paper-1"
					readerAnnotations={[
						{
							id: "annotation-1",
							paperId: "paper-1",
							workspaceId: "workspace-1",
							userId: "user-1",
							page: 1,
							kind: "highlight",
							color: "#f4c84f",
							body: {
								quote: "Selected page 1 text",
								rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.1 }],
							},
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
							deletedAt: null,
						},
					]}
				/>
			</Wrapper>,
		)

		const layer = await screen.findByLabelText("Reader annotations page 1")
		expect(layer.querySelector("rect")).not.toBeNull()
	})

	it("fires extra annotation actions from the selection popover", async () => {
		usePaperPdfUrlMock.mockReturnValue({
			data: { url: "http://test/pdf", expiresInSeconds: 3600 },
			isLoading: false,
			isError: false,
			refetch: refetchMock,
		})
		const onExtraAction = vi.fn()
		const PdfViewer = await importPdfViewer()
		const Wrapper = makeWrapper()
		const user = userEvent.setup()

		render(
			<Wrapper>
				<PdfViewer
					paperId="paper-1"
					readerAnnotations={[
						{
							id: "annotation-1",
							paperId: "paper-1",
							workspaceId: "workspace-1",
							userId: "user-1",
							page: 1,
							kind: "highlight",
							color: "#f4c84f",
							body: {
								quote: "Selected page 1 text",
								rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.1 }],
							},
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
							deletedAt: null,
						},
					]}
					renderAnnotationActions={() => (
						<button aria-label="Add annotation note" onClick={onExtraAction} type="button">
							Add note
						</button>
					)}
				/>
			</Wrapper>,
		)

		const layer = await screen.findByLabelText("Reader annotations page 1")
		expect(layer).toHaveClass("pointer-events-none")
		const pageWrap = document.querySelector("[data-page-number='1']") as HTMLElement | null
		expect(pageWrap).not.toBeNull()
		vi.spyOn(pageWrap as HTMLElement, "getBoundingClientRect").mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 600,
			bottom: 800,
			width: 600,
			height: 800,
			toJSON: () => ({}),
		} as DOMRect)
		fireEvent.click(pageWrap as Element, { clientX: 120, clientY: 180 })

		await user.click(await screen.findByRole("button", { name: "Add annotation note" }))
		expect(onExtraAction).toHaveBeenCalledTimes(1)
	})

	it("deletes a selected annotation with Delete", async () => {
		usePaperPdfUrlMock.mockReturnValue({
			data: { url: "http://test/pdf", expiresInSeconds: 3600 },
			isLoading: false,
			isError: false,
			refetch: refetchMock,
		})
		const onDeleteReaderAnnotation = vi.fn()
		const PdfViewer = await importPdfViewer()
		const Wrapper = makeWrapper()

		render(
			<Wrapper>
				<PdfViewer
					onDeleteReaderAnnotation={onDeleteReaderAnnotation}
					paperId="paper-1"
					readerAnnotations={[
						{
							id: "annotation-1",
							paperId: "paper-1",
							workspaceId: "workspace-1",
							userId: "user-1",
							page: 1,
							kind: "highlight",
							color: "#f4c84f",
							body: {
								quote: "Selected page 1 text",
								rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.1 }],
							},
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
							deletedAt: null,
						},
					]}
				/>
			</Wrapper>,
		)

		await screen.findByLabelText("Reader annotations page 1")
		const pageWrap = document.querySelector("[data-page-number='1']") as HTMLElement | null
		expect(pageWrap).not.toBeNull()
		vi.spyOn(pageWrap as HTMLElement, "getBoundingClientRect").mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 600,
			bottom: 800,
			width: 600,
			height: 800,
			toJSON: () => ({}),
		} as DOMRect)
		fireEvent.click(pageWrap as Element, { clientX: 120, clientY: 180 })

		fireEvent.keyDown(window, { key: "Delete" })
		expect(onDeleteReaderAnnotation).toHaveBeenCalledWith("annotation-1")
	})

	it("does not delete a selected annotation from inside an input", async () => {
		usePaperPdfUrlMock.mockReturnValue({
			data: { url: "http://test/pdf", expiresInSeconds: 3600 },
			isLoading: false,
			isError: false,
			refetch: refetchMock,
		})
		const onDeleteReaderAnnotation = vi.fn()
		const PdfViewer = await importPdfViewer()
		const Wrapper = makeWrapper()

		render(
			<Wrapper>
				<div>
					<input aria-label="test-input" />
					<PdfViewer
						onDeleteReaderAnnotation={onDeleteReaderAnnotation}
						paperId="paper-1"
						readerAnnotations={[
							{
								id: "annotation-1",
								paperId: "paper-1",
								workspaceId: "workspace-1",
								userId: "user-1",
								page: 1,
								kind: "highlight",
								color: "#f4c84f",
								body: {
									quote: "Selected page 1 text",
									rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.1 }],
								},
								createdAt: new Date().toISOString(),
								updatedAt: new Date().toISOString(),
								deletedAt: null,
							},
						]}
					/>
				</div>
			</Wrapper>,
		)

		await screen.findByLabelText("Reader annotations page 1")
		const pageWrap = document.querySelector("[data-page-number='1']") as HTMLElement | null
		expect(pageWrap).not.toBeNull()
		vi.spyOn(pageWrap as HTMLElement, "getBoundingClientRect").mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 600,
			bottom: 800,
			width: 600,
			height: 800,
			toJSON: () => ({}),
		} as DOMRect)
		fireEvent.click(pageWrap as Element, { clientX: 120, clientY: 180 })

		const input = screen.getByLabelText("test-input")
		input.focus()
		fireEvent.keyDown(input, { key: "Backspace" })
		expect(onDeleteReaderAnnotation).not.toHaveBeenCalled()
	})

	it("uses internal destination coordinates to jump to the target position within a page", async () => {
		usePaperPdfUrlMock.mockReturnValue({
			data: { url: "http://test/pdf", expiresInSeconds: 3600 },
			isLoading: false,
			isError: false,
			refetch: refetchMock,
		})
		documentItemClickArgs = {
			dest: [null, { name: "XYZ" }, 0, 600, null],
			pageIndex: 2,
			pageNumber: 3,
		}
		const PdfViewer = await importPdfViewer()
		const Wrapper = makeWrapper()
		const user = userEvent.setup()
		const scrollToMock = vi.fn()

		const { container } = render(
			<Wrapper>
				<PdfViewer paperId="paper-1" />
			</Wrapper>,
		)

		await screen.findByTestId("pdf-page-3")

		const scrollContainer = container.querySelector(".scrollbar-none")
		expect(scrollContainer).not.toBeNull()
		Object.defineProperty(scrollContainer!, "clientHeight", {
			configurable: true,
			value: 400,
		})
		Object.defineProperty(scrollContainer!, "scrollHeight", {
			configurable: true,
			value: 2600,
		})
		Object.defineProperty(scrollContainer!, "scrollTop", {
			configurable: true,
			value: 500,
			writable: true,
		})
		scrollContainer!.scrollTo = scrollToMock
		vi.spyOn(scrollContainer!, "getBoundingClientRect").mockReturnValue({
			x: 0,
			y: 100,
			top: 100,
			left: 0,
			right: 900,
			bottom: 900,
			width: 900,
			height: 800,
			toJSON: () => ({}),
		} as DOMRect)

		const pageWrap = container.querySelector("[data-page-number='3']")
		const pageCanvas = await screen.findByTestId("pdf-canvas-3")
		expect(pageWrap).not.toBeNull()
		vi.spyOn(pageWrap!, "getBoundingClientRect").mockReturnValue({
			x: 0,
			y: 900,
			top: 900,
			left: 0,
			right: 600,
			bottom: 1700,
			width: 600,
			height: 800,
			toJSON: () => ({}),
		} as DOMRect)
		vi.spyOn(pageCanvas, "getBoundingClientRect").mockReturnValue({
			x: 0,
			y: 900,
			top: 900,
			left: 0,
			right: 600,
			bottom: 1700,
			width: 600,
			height: 800,
			toJSON: () => ({}),
		} as DOMRect)

		await user.click(screen.getByTestId("pdf-internal-link"))

		expect(scrollToMock).toHaveBeenCalledWith({
			top: 1400,
			behavior: "smooth",
		})
	})

	it("resolves named internal destinations before scrolling", async () => {
		usePaperPdfUrlMock.mockReturnValue({
			data: { url: "http://test/pdf", expiresInSeconds: 3600 },
			isLoading: false,
			isError: false,
			refetch: refetchMock,
		})
		pdfDocumentGetDestinationMock.mockResolvedValue([null, { name: "FitH" }, 640])
		documentItemClickArgs = {
			dest: "appendix-e",
			pageIndex: 2,
			pageNumber: 3,
		}
		const PdfViewer = await importPdfViewer()
		const Wrapper = makeWrapper()
		const user = userEvent.setup()
		const scrollToMock = vi.fn()

		const { container } = render(
			<Wrapper>
				<PdfViewer paperId="paper-1" />
			</Wrapper>,
		)

		await screen.findByTestId("pdf-page-3")

		const scrollContainer = container.querySelector(".scrollbar-none")
		expect(scrollContainer).not.toBeNull()
		Object.defineProperty(scrollContainer!, "clientHeight", {
			configurable: true,
			value: 400,
		})
		Object.defineProperty(scrollContainer!, "scrollHeight", {
			configurable: true,
			value: 2600,
		})
		Object.defineProperty(scrollContainer!, "scrollTop", {
			configurable: true,
			value: 500,
			writable: true,
		})
		scrollContainer!.scrollTo = scrollToMock
		vi.spyOn(scrollContainer!, "getBoundingClientRect").mockReturnValue({
			x: 0,
			y: 100,
			top: 100,
			left: 0,
			right: 900,
			bottom: 900,
			width: 900,
			height: 800,
			toJSON: () => ({}),
		} as DOMRect)

		const pageWrap = container.querySelector("[data-page-number='3']")
		const pageCanvas = await screen.findByTestId("pdf-canvas-3")
		expect(pageWrap).not.toBeNull()
		vi.spyOn(pageWrap!, "getBoundingClientRect").mockReturnValue({
			x: 0,
			y: 900,
			top: 900,
			left: 0,
			right: 600,
			bottom: 1700,
			width: 600,
			height: 800,
			toJSON: () => ({}),
		} as DOMRect)
		vi.spyOn(pageCanvas, "getBoundingClientRect").mockReturnValue({
			x: 0,
			y: 900,
			top: 900,
			left: 0,
			right: 600,
			bottom: 1700,
			width: 600,
			height: 800,
			toJSON: () => ({}),
		} as DOMRect)

		await user.click(screen.getByTestId("pdf-internal-link"))

		expect(pdfDocumentGetDestinationMock).toHaveBeenCalledWith("appendix-e")
		expect(scrollToMock).toHaveBeenCalledWith({
			top: 1360,
			behavior: "smooth",
		})
	})
})
