import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Block } from "@/api/hooks/blocks"

const refetchMock = vi.fn()
const usePaperPdfUrlMock = vi.fn()

vi.mock("@/api/hooks/papers", () => ({
	usePaperPdfUrl: (...args: Array<unknown>) => usePaperPdfUrlMock(...args),
}))

vi.mock("react-pdf", () => ({
	Document: ({
		children,
		onLoadSuccess,
	}: {
		children?: ReactNode
		onLoadSuccess?: (info: { numPages: number }) => void
	}) => {
		// Trigger numPages discovery synchronously so the page list renders.
		queueMicrotask(() => onLoadSuccess?.({ numPages: 3 }))
		return <div data-testid="pdf-document">{children}</div>
	},
	Page: ({
		pageNumber,
		scale,
		onLoadSuccess,
	}: {
		pageNumber: number
		scale: number
		onLoadSuccess?: (page: { view: number[] }) => void
	}) => {
		queueMicrotask(() => onLoadSuccess?.({ view: [0, 0, 600, 800] }))
		return (
			<div data-testid={`pdf-page-${pageNumber}`} data-scale={scale}>
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

	it("creates a reader annotation in dedicated markup mode without relying on block ids", async () => {
		usePaperPdfUrlMock.mockReturnValue({
			data: { url: "http://test/pdf", expiresInSeconds: 3600 },
			isLoading: false,
			isError: false,
			refetch: refetchMock,
		})
		const onCreateReaderAnnotation = vi.fn().mockResolvedValue(undefined)
		const PdfViewer = await importPdfViewer()
		const Wrapper = makeWrapper()
		const user = userEvent.setup()

		render(
			<Wrapper>
				<PdfViewer
					onCreateReaderAnnotation={onCreateReaderAnnotation}
					paperId="paper-1"
					readerAnnotations={[]}
				/>
			</Wrapper>,
		)

		await screen.findByTestId("pdf-page-1")
		await user.click(screen.getByRole("button", { name: /markup/i }))
		const layer = await screen.findByLabelText("Reader annotations page 1")
		// Coordinate math reads the SVG's bounding rect via the ref, so
		// keep mocking that, even though pointer events now fire on the
		// backdrop rect inside the SVG.
		vi.spyOn(layer, "getBoundingClientRect").mockReturnValue({
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
		const canvas = await screen.findByLabelText("Reader annotations canvas page 1")

		fireEvent.pointerDown(canvas, { button: 0, clientX: 60, clientY: 80, pointerId: 1 })
		fireEvent.pointerMove(canvas, { clientX: 240, clientY: 200, pointerId: 1 })
		fireEvent.pointerUp(canvas, { clientX: 240, clientY: 200, pointerId: 1 })

		expect(onCreateReaderAnnotation).toHaveBeenCalledTimes(1)
		expect(onCreateReaderAnnotation.mock.calls[0]?.[0]).toMatchObject({
			page: 1,
			kind: "highlight",
			color: "#f4c84f",
			body: {
				rect: { x: 0.1, y: 0.1, h: 0.15 },
			},
		})
		expect(onCreateReaderAnnotation.mock.calls[0]?.[0]?.body.rect.w).toBeCloseTo(0.3)
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
							body: { rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } },
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
						},
					]}
				/>
			</Wrapper>,
		)

		const layer = await screen.findByLabelText("Reader annotations page 1")
		expect(layer.querySelector("rect")).not.toBeNull()
	})
})
