import {
	memo,
	type MouseEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import { Document, Page } from "react-pdf"
import type { Block } from "@/api/hooks/blocks"
import type { ReaderAnnotation } from "@/api/hooks/reader-annotations"
import { usePaperPdfUrl } from "@/api/hooks/papers"
import { copyTextToClipboard } from "@/lib/clipboard"
import { type PaletteEntry, paletteVisualTokens } from "@/lib/highlight-palette"
import {
	clampUnit as clampAnnotationUnit,
	normalizeAnnotationRects,
} from "@/lib/reader-annotations"
import { BlockHighlightPicker } from "./BlockHighlightPicker"
import {
	ReaderAnnotationActionsPopover,
	ReaderAnnotationSelectionOutline,
	ReaderAnnotationShape,
} from "./ReaderAnnotationLayer"
import {
	type ReaderSelectionContext,
	deriveBlockIdsFromSelectionRects,
	getActionableSelection,
	selectionIntersectsElement,
} from "./reader-selection"
import { SelectedBlockPreview } from "./SelectedBlockPreview"

const MIN_SCALE = 0.5
const MAX_SCALE = 3
const FIT_WIDTH_GUTTER_PX = 32
const BBOX_EPSILON = 0.02
const VIRTUAL_WINDOW_RADIUS = 2
const DEFAULT_PAGE_ASPECT_RATIO = 11 / 8.5
const DARK_MODE_CANVAS_FILTER = "var(--pdf-dark-display-filter)"
const DARK_MODE_CANVAS_OPACITY = "var(--pdf-dark-display-opacity)"

// Module-level cache of figure/table image URLs we've already warmed in
// the browser image cache. See the preload effect in PdfPageWithOverlay.
const preloadedPreviewImageUrls = new Set<string>()

export interface PdfRailLayout {
	pageMetrics: Map<number, { top: number; height: number }>
	scrollHeight: number
	scrollTop: number
	viewportHeight: number
	viewportAnchorTop: number
}

interface PdfViewerProps {
	paperId: string
	requestedPage?: number
	requestedBlockY?: number
	requestedPageNonce?: number
	onInteract?: () => void
	onPageChange?: (page: number) => void
	onViewportAnchorChange?: (page: number, yRatio: number) => void
	onRailLayoutChange?: (layout: PdfRailLayout | null) => void
	blocks?: Block[]
	colorByBlock?: Map<string, string>
	palette?: PaletteEntry[]
	selectedBlockId?: string | null
	onSelectBlock?: (block: Block) => void
	onClearSelectedBlock?: () => void
	onSetHighlight?: (blockId: string, color: string) => Promise<void> | void
	onClearHighlight?: (blockId: string) => Promise<void> | void
	readerAnnotations?: ReaderAnnotation[]
	onDeleteReaderAnnotation?: (annotationId: string) => Promise<unknown> | unknown
	onUpdateReaderAnnotationColor?: (
		annotationId: string,
		color: string,
	) => Promise<unknown> | unknown
	onRestoreReaderAnnotation?: (annotationId: string) => Promise<unknown> | unknown
	renderAnnotationActions?: (annotation: ReaderAnnotation) => React.ReactNode
	// Mirrors BlocksPanel's renderActions slot — caller emits the
	// cite/add-note button so the PDF toolbar matches the parsed-blocks pane.
	renderActions?: (block: Block) => React.ReactNode
	// When set, the matching annotation pulses briefly on the page so the
	// reader can see what a citation chip just jumped them to.
	flashedAnnotationId?: string | null
	// When a marginalia note anchored to a highlight/underline becomes
	// active, keep the matching markup visibly selected in the PDF.
	previewedAnnotationId?: string | null
	// When a marginalia note opens, softly preview its anchor block so the
	// reader immediately sees the structural source without needing a
	// second click inside the note.
	previewedBlockId?: string | null
	// While a note is open and anchored to a block, suppress the
	// image/table preview popup for that block. The note panel and the
	// zoom popup compete for the same screen real estate; note creation
	// wins.
	previewSuppressedBlockId?: string | null
	onSelectedTextChange?: (selection: ReaderSelectionContext | undefined) => void
}

interface PdfDocumentLike {
	getDestination?: (dest: string) => Promise<unknown>
	numPages?: number
}

function PdfViewerInner({
	paperId,
	requestedPage,
	requestedBlockY,
	requestedPageNonce,
	onInteract,
	onPageChange,
	onViewportAnchorChange,
	onRailLayoutChange,
	blocks,
	colorByBlock,
	palette,
	selectedBlockId,
	onSelectBlock,
	onClearSelectedBlock,
	onSetHighlight,
	onClearHighlight,
	readerAnnotations,
	onRestoreReaderAnnotation,
	onDeleteReaderAnnotation,
	onUpdateReaderAnnotationColor,
	renderAnnotationActions,
	renderActions,
	flashedAnnotationId,
	previewedBlockId,
	previewedAnnotationId,
	previewSuppressedBlockId,
	onSelectedTextChange,
}: PdfViewerProps) {
	const { data, isLoading, isError, refetch } = usePaperPdfUrl(paperId)
	const [documentTheme, setDocumentTheme] = useState<"light" | "dark">(() => getDocumentTheme())
	const [numPages, setNumPages] = useState<number | null>(null)
	const [currentPage, setCurrentPage] = useState(1)
	const [scale, setScale] = useState(1.0)
	const [scaleMode, setScaleMode] = useState<"fit" | "manual">("fit")
	const [showLayoutBoxes, setShowLayoutBoxes] = useState(false)
	const [basePageWidth, setBasePageWidth] = useState<number | null>(null)
	const [pagePointDimsByPage, setPagePointDimsByPage] = useState<Map<number, { w: number; h: number }>>(
		() => new Map(),
	)
	const [renderError, setRenderError] = useState<string | null>(null)
	const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null)
	const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null)
	const [pageRefsVersion, setPageRefsVersion] = useState(0)
	const [pageCanvasVersion, setPageCanvasVersion] = useState(0)
	const [internalRequestedPage, setInternalRequestedPage] = useState<number | null>(null)
	const [internalRequestedDest, setInternalRequestedDest] = useState<unknown[] | null>(null)
	const [internalRequestedPageNonce, setInternalRequestedPageNonce] = useState(0)
	const scrollContainerRef = useRef<HTMLDivElement>(null)
	const pdfDocumentRef = useRef<PdfDocumentLike | null>(null)
	const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())
	const intersectionRatiosRef = useRef<Map<number, number>>(new Map())
	const activePageRef = useRef(1)
	const intersectionObserverRef = useRef<IntersectionObserver | null>(null)
	const scrollRafRef = useRef<number | null>(null)
	// Separate handled-key trackers for the two jump origins. Sharing a
	// single ref was a bug: the external (citation / cross-view) jump
	// keys live in `${nonce}:P:Y` namespace while internal PDF-link jumps
	// use `internal:N:P:Y`. Once an internal link fires, the shared ref
	// holds an `internal:` key — which never matches the external
	// effect's key, so the *next* time the external effect re-runs (e.g.
	// renderedPages re-derives during scroll) it sees "different" and
	// re-scrolls to the old requestedPage, fighting the user.
	const handledExternalJumpRequestRef = useRef<string | null>(null)
	const handledInternalJumpRequestRef = useRef<string | null>(null)

	useEffect(() => {
		if (typeof document === "undefined") return
		const root = document.documentElement
		const updateTheme = () => setDocumentTheme(getDocumentTheme())
		updateTheme()
		if (typeof MutationObserver === "undefined") return
		const observer = new MutationObserver(updateTheme)
		observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] })
		return () => observer.disconnect()
	}, [])

	useEffect(() => {
		void paperId
		setNumPages(null)
		setCurrentPage(1)
		setScale(1)
		setScaleMode("fit")
		setShowLayoutBoxes(false)
		setBasePageWidth(null)
		setPagePointDimsByPage(new Map())
		setRenderError(null)
		setSelectedAnnotationId(null)
		setHoveredBlockId(null)
		setPageRefsVersion(0)
		setPageCanvasVersion(0)
		setInternalRequestedPage(null)
		setInternalRequestedDest(null)
		setInternalRequestedPageNonce(0)
		pdfDocumentRef.current = null
		pageRefs.current.clear()
		intersectionRatiosRef.current.clear()
		activePageRef.current = 1
		handledExternalJumpRequestRef.current = null
		handledInternalJumpRequestRef.current = null
		onSelectedTextChange?.(undefined)
		onRailLayoutChange?.(null)
	}, [onRailLayoutChange, onSelectedTextChange, paperId])

	const blocksByPage = useMemo(() => {
		const map = new Map<number, Block[]>()
		for (const block of blocks ?? []) {
			if (!isRenderableBbox(block.bbox)) continue
			const list = map.get(block.page) ?? []
			list.push(block)
			map.set(block.page, list)
		}
		return map
	}, [blocks])

	const selectedBlock = useMemo(
		() =>
			selectedBlockId
				? (blocks ?? []).find((block) => block.blockId === selectedBlockId) ?? null
				: null,
		[blocks, selectedBlockId],
	)

	const annotationsByPage = useMemo(() => {
		const map = new Map<number, ReaderAnnotation[]>()
		for (const annotation of readerAnnotations ?? []) {
			const list = map.get(annotation.page) ?? []
			list.push(annotation)
			map.set(annotation.page, list)
		}
		return map
	}, [readerAnnotations])

	const averagePageAspectRatio = useMemo(() => {
		const ratios = Array.from(pagePointDimsByPage.values())
			.map((dims) => dims.h / dims.w)
			.filter((ratio) => Number.isFinite(ratio) && ratio > 0)
		if (ratios.length === 0) return DEFAULT_PAGE_ASPECT_RATIO
		return ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length
	}, [pagePointDimsByPage])

	const pageWidthEstimate = useMemo(() => {
		if (basePageWidth) return basePageWidth * scale
		const containerWidth = scrollContainerRef.current?.clientWidth
		if (containerWidth && containerWidth > FIT_WIDTH_GUTTER_PX) {
			return clamp((containerWidth - FIT_WIDTH_GUTTER_PX) / 600) * 600
		}
		return null
	}, [basePageWidth, scale])
	const pageColors = undefined
	const useDarkModeCanvasFilter = documentTheme === "dark"

	const renderCenterPages = useMemo(() => {
		const centers = new Set<number>()
		centers.add(currentPage)
		if (requestedPage != null) centers.add(requestedPage)
		if (internalRequestedPage != null) centers.add(internalRequestedPage)
		if (selectedBlock?.page != null) centers.add(selectedBlock.page)
		return Array.from(centers)
	}, [currentPage, internalRequestedPage, requestedPage, selectedBlock])

	const renderedPages = useMemo(() => {
		if (numPages == null) return new Set<number>()
		const next = new Set<number>()
		for (let page = 1; page <= numPages; page += 1) {
			if (renderCenterPages.some((center) => Math.abs(center - page) <= VIRTUAL_WINDOW_RADIUS)) {
				next.add(page)
			}
		}
		return next
	}, [numPages, renderCenterPages])

	const pageAspectRatioFor = useCallback(
		(page: number) => {
			const dims = pagePointDimsByPage.get(page)
			return dims ? dims.h / dims.w : averagePageAspectRatio
		},
		[averagePageAspectRatio, pagePointDimsByPage],
	)

	const scrollToPage = useCallback((page: number, blockYRatio?: number) => {
		const el = pageRefs.current.get(page)
		const container = scrollContainerRef.current
		if (!el || !container) return false
		if (typeof blockYRatio === "number") {
			const canvas = findDisplayCanvas(el)
			if (!(canvas instanceof HTMLCanvasElement)) return false
			const elRect = canvas.getBoundingClientRect()
			const containerRect = container.getBoundingClientRect()
			const pageTopInContent = elRect.top - containerRect.top + container.scrollTop
			const blockTopInContent = pageTopInContent + blockYRatio * elRect.height
			const desired = blockTopInContent - container.clientHeight * 0.25
			const target = Math.max(pageTopInContent, desired)
			const max = container.scrollHeight - container.clientHeight
			container.scrollTo({
				top: Math.max(0, Math.min(max, target)),
				behavior: "smooth",
			})
			return true
		}
		el.scrollIntoView({ behavior: "smooth", block: "start" })
		return true
	}, [])

	const computeTopmostVisiblePage = useCallback(() => {
		const container = scrollContainerRef.current
		if (!container) return activePageRef.current
		const containerRect = container.getBoundingClientRect()
		const pages = Array.from(pageRefs.current.entries()).sort(([a], [b]) => a - b)
		for (const [page, el] of pages) {
			const rect = el.getBoundingClientRect()
			if (rect.bottom <= containerRect.top) continue
			if (rect.top >= containerRect.bottom) continue
			return page
		}
		return activePageRef.current
	}, [])

	const fitToWidth = useCallback(() => {
		if (!scrollContainerRef.current || !basePageWidth) return
		const availableWidth = scrollContainerRef.current.clientWidth - FIT_WIDTH_GUTTER_PX
		if (availableWidth <= 0) return
		setScale(clamp(availableWidth / basePageWidth))
	}, [basePageWidth])

	const emitRailLayout = useCallback(() => {
		if (!onRailLayoutChange) return
		const container = scrollContainerRef.current
		if (!container) {
			onRailLayoutChange(null)
			return
		}
		const containerRect = container.getBoundingClientRect()
		const pageMetrics = new Map<number, { top: number; height: number }>()
		for (const [page, el] of pageRefs.current.entries()) {
			const canvas = findDisplayCanvas(el)
			const target = canvas instanceof HTMLCanvasElement ? canvas : el
			const rect = target.getBoundingClientRect()
			if (rect.height <= 0) continue
			pageMetrics.set(page, {
				top: rect.top - containerRect.top + container.scrollTop,
				height: rect.height,
			})
		}
		onRailLayoutChange({
			pageMetrics,
			scrollHeight: container.scrollHeight,
			scrollTop: container.scrollTop,
			viewportHeight: container.clientHeight,
			viewportAnchorTop: container.scrollTop + container.clientHeight / 2,
		})
	}, [onRailLayoutChange])

	useEffect(() => {
		onPageChange?.(currentPage)
	}, [currentPage, onPageChange])

	useEffect(() => {
		activePageRef.current = currentPage
	}, [currentPage])

	useEffect(() => {
		if (requestedPage == null) return
		if (numPages == null) return
		if (!renderedPages.has(requestedPage)) return
		const requestKey = `${requestedPageNonce ?? "default"}:${requestedPage}:${requestedBlockY ?? "none"}`
		if (handledExternalJumpRequestRef.current === requestKey) return
		// Always scroll on a focus request. Self-pane bbox clicks no longer
		// emit one (the block is visible by definition), so the only callers
		// here are cross-view toggles and citation chip jumps — both want to
		// re-center the target even if it's currently in viewport.
		if (!scrollToPage(requestedPage, requestedBlockY)) return
		handledExternalJumpRequestRef.current = requestKey
	}, [numPages, pageCanvasVersion, pageRefsVersion, renderedPages, requestedPageNonce, requestedPage, requestedBlockY, scrollToPage])

	useEffect(() => {
		if (internalRequestedPage == null) return
		if (numPages == null) return
		if (!renderedPages.has(internalRequestedPage)) return
		if (internalRequestedDest && !pagePointDimsByPage.has(internalRequestedPage)) return
		const internalRequestedBlockY = getInternalDestinationTopRatio(
			internalRequestedDest,
			pagePointDimsByPage.get(internalRequestedPage),
		)
		const requestKey = `internal:${internalRequestedPageNonce}:${internalRequestedPage}:${internalRequestedBlockY ?? "none"}`
		if (handledInternalJumpRequestRef.current === requestKey) return
		if (!scrollToPage(internalRequestedPage, internalRequestedBlockY)) return
		handledInternalJumpRequestRef.current = requestKey
	}, [
		internalRequestedDest,
		internalRequestedPage,
		internalRequestedPageNonce,
		numPages,
		pageCanvasVersion,
		pagePointDimsByPage,
		pageRefsVersion,
		renderedPages,
		scrollToPage,
	])

	useEffect(() => {
		const container = scrollContainerRef.current
		if (!container || numPages == null) return
		const measureActivePageAnchor = () => {
			const nextActivePage = computeTopmostVisiblePage()
			if (nextActivePage !== activePageRef.current) {
				activePageRef.current = nextActivePage
				setCurrentPage(nextActivePage)
			}
			const activePage = activePageRef.current
			const el = pageRefs.current.get(activePage)
			if (!el) return
			const containerRect = container.getBoundingClientRect()
			const rect = el.getBoundingClientRect()
			if (rect.height <= 0) return
			const viewportMidY = containerRect.top + container.clientHeight / 2
			const yRatio = clampUnit((viewportMidY - rect.top) / rect.height)
			onViewportAnchorChange?.(activePage, yRatio)
			emitRailLayout()
		}

		if (typeof IntersectionObserver !== "undefined") {
			const observer = new IntersectionObserver(
				(entries) => {
					for (const entry of entries) {
						const page = Number((entry.target as HTMLElement).dataset.pageNumber ?? "0")
						if (!page) continue
						intersectionRatiosRef.current.set(page, entry.isIntersecting ? entry.intersectionRatio : 0)
					}
					measureActivePageAnchor()
				},
				{
					root: container,
					threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
				},
			)
			intersectionObserverRef.current = observer
			for (const el of pageRefs.current.values()) observer.observe(el)
			measureActivePageAnchor()
			return () => {
				intersectionObserverRef.current = null
				observer.disconnect()
			}
		}

		const fallbackHandleScroll = () => {
			measureActivePageAnchor()
		}

		fallbackHandleScroll()
		container.addEventListener("scroll", fallbackHandleScroll, { passive: true })
		return () => container.removeEventListener("scroll", fallbackHandleScroll)
	}, [computeTopmostVisiblePage, emitRailLayout, numPages, onViewportAnchorChange])

	useEffect(() => {
		const container = scrollContainerRef.current
		if (!container) return
		const handleScroll = () => {
			if (scrollRafRef.current != null) return
			scrollRafRef.current = window.requestAnimationFrame(() => {
				scrollRafRef.current = null
				const nextActivePage = computeTopmostVisiblePage()
				if (nextActivePage !== activePageRef.current) {
					activePageRef.current = nextActivePage
					setCurrentPage(nextActivePage)
				}
				const activePage = activePageRef.current
				const el = pageRefs.current.get(activePage)
				if (!el) return
				const containerRect = container.getBoundingClientRect()
				const rect = el.getBoundingClientRect()
				if (rect.height <= 0) return
				const viewportMidY = containerRect.top + container.clientHeight / 2
				const yRatio = clampUnit((viewportMidY - rect.top) / rect.height)
				onViewportAnchorChange?.(activePage, yRatio)
				emitRailLayout()
			})
		}
		container.addEventListener("scroll", handleScroll, { passive: true })
		return () => {
			container.removeEventListener("scroll", handleScroll)
			if (scrollRafRef.current != null) {
				window.cancelAnimationFrame(scrollRafRef.current)
				scrollRafRef.current = null
			}
		}
	}, [computeTopmostVisiblePage, emitRailLayout, onViewportAnchorChange])

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (isEditableTarget(e.target)) return
			if (e.key === "PageDown" || (e.key === " " && !e.shiftKey)) {
				e.preventDefault()
				scrollToPage(Math.min(currentPage + 1, numPages ?? 1))
			} else if (e.key === "PageUp" || (e.key === " " && e.shiftKey)) {
				e.preventDefault()
				scrollToPage(Math.max(currentPage - 1, 1))
			}
		}
		window.addEventListener("keydown", handler)
		return () => window.removeEventListener("keydown", handler)
	}, [currentPage, numPages, scrollToPage])

	useEffect(() => {
		if (!selectedAnnotationId || !onDeleteReaderAnnotation) return
		const handleKeyDown = (event: KeyboardEvent) => {
			if (isEditableTarget(event.target)) return
			if (event.metaKey || event.ctrlKey || event.altKey) return
			if (event.key !== "Delete" && event.key !== "Backspace") return
			event.preventDefault()
			void onDeleteReaderAnnotation(selectedAnnotationId)
			setSelectedAnnotationId(null)
		}
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [onDeleteReaderAnnotation, selectedAnnotationId])

	useEffect(() => {
		const container = scrollContainerRef.current
		if (!container) return
		const handler = (e: WheelEvent) => {
			if (e.ctrlKey || e.metaKey) {
				e.preventDefault()
				setScaleMode("manual")
				setScale((value) => clamp(value + (e.deltaY < 0 ? 0.1 : -0.1)))
			}
		}
		container.addEventListener("wheel", handler, { passive: false })
		return () => container.removeEventListener("wheel", handler)
	}, [])

	useEffect(() => {
		if (scaleMode !== "fit") return
		fitToWidth()
	}, [fitToWidth, scaleMode])

	useEffect(() => {
		if (scaleMode !== "fit" || !scrollContainerRef.current) return
		if (typeof ResizeObserver === "undefined") return
		// Debounce: sidebars animate over ~200–300ms, firing the observer
		// every frame. Each call sets `scale`, which forces react-pdf to
		// repaint the canvas — without debounce that's a flicker storm.
		// Wait for the resize to settle, then refit once.
		let timeoutId: ReturnType<typeof setTimeout> | null = null
		const observer = new ResizeObserver(() => {
			if (timeoutId) clearTimeout(timeoutId)
			timeoutId = setTimeout(() => fitToWidth(), 120)
		})
		observer.observe(scrollContainerRef.current)
		return () => {
			if (timeoutId) clearTimeout(timeoutId)
			observer.disconnect()
		}
	}, [fitToWidth, scaleMode])

	const registerPageRef = useCallback((page: number, el: HTMLDivElement | null) => {
		const prev = pageRefs.current.get(page)
		if (prev === el) return
		if (prev && prev !== el) {
			intersectionObserverRef.current?.unobserve(prev)
		}
		if (el) {
			pageRefs.current.set(page, el)
			intersectionObserverRef.current?.observe(el)
			setPageRefsVersion((value) => value + 1)
			return
		}
		if (!prev) return
		intersectionObserverRef.current?.unobserve(prev)
		pageRefs.current.delete(page)
		intersectionRatiosRef.current.delete(page)
		setPageRefsVersion((value) => value + 1)
	}, [])

	const handlePageCanvasReady = useCallback((_page: number) => {
		setPageCanvasVersion((value) => value + 1)
	}, [])

	const handlePageDims = useCallback((page: number, dims: { w: number; h: number }) => {
		setBasePageWidth((current) => current ?? dims.w)
		setPagePointDimsByPage((current) => {
			const previous = current.get(page)
			if (previous && previous.w === dims.w && previous.h === dims.h) return current
			const next = new Map(current)
			next.set(page, dims)
			return next
		})
	}, [])

	useEffect(() => {
		emitRailLayout()
	}, [emitRailLayout, numPages, pageCanvasVersion, pageRefsVersion, scale])

	const emitSelectedText = useCallback(() => {
		if (!onSelectedTextChange || typeof window === "undefined") return
		const selection = window.getSelection()
		const container = scrollContainerRef.current
		const actionable = getActionableSelection(selection)
		if (!container || !actionable || !selectionIntersectsElement(selection, container)) {
			onSelectedTextChange(undefined)
			return
		}
		const textLayers = container.querySelectorAll(".react-pdf__Page__textContent")
		const isPdfTextSelection = Array.from(textLayers).some((layer) =>
			selectionIntersectsElement(selection, layer),
		)
		if (!isPdfTextSelection) {
			onSelectedTextChange(undefined)
			return
		}
		const annotationTarget = derivePdfSelectionAnnotationTarget({
			container,
			range: actionable.range,
			selectedText: actionable.selectedText,
		})
		onSelectedTextChange({
			anchorRect: actionable.anchorRect,
			annotationTarget,
			blockIds: deriveBlockIdsFromSelectionRects(actionable.range, container),
			mode: "pdf",
			selectedText: actionable.selectedText,
		})
	}, [onSelectedTextChange])

	useEffect(() => {
		if (!onSelectedTextChange) return
		const handleSelectionChange = () => {
			emitSelectedText()
		}
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onSelectedTextChange(undefined)
		}
		document.addEventListener("selectionchange", handleSelectionChange)
		document.addEventListener("keydown", handleKeyDown)
		return () => {
			document.removeEventListener("selectionchange", handleSelectionChange)
			document.removeEventListener("keydown", handleKeyDown)
			onSelectedTextChange(undefined)
		}
	}, [emitSelectedText, onSelectedTextChange])

	const handleMainPointerDown = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			if (!shouldCollapseNotesOnMainClick(event.target)) return
			onClearSelectedBlock?.()
			onInteract?.()
		},
		[onClearSelectedBlock, onInteract],
	)

	const handleDocumentItemClick = useCallback(
		async ({ dest, pageNumber }: { dest?: unknown; pageNumber: number }) => {
			const explicitDest = await resolveExplicitDestination(dest, pdfDocumentRef.current)
			setInternalRequestedPage(pageNumber)
			setInternalRequestedDest(explicitDest)
			setInternalRequestedPageNonce((value) => value + 1)
		},
		[],
	)

	if (isLoading) {
		return <div className="p-8 text-text-tertiary">Loading PDF…</div>
	}

	if (isError || !data) {
		return (
			<div className="p-8">
				<div className="mb-3 text-text-error">Failed to load PDF.</div>
				<button
					className="h-9 rounded-md border border-border-default px-4 text-sm transition-colors hover:bg-surface-hover"
					onClick={() => void refetch()}
					type="button"
				>
					Retry
				</button>
			</div>
		)
	}

	return (
		<div className="relative flex h-full flex-col bg-[var(--color-reading-bg)]">
			<div className="flex h-[var(--shell-toolbar-height)] shrink-0 items-center justify-between border-b border-border-subtle bg-bg-primary px-4">
				<div className="text-sm text-text-secondary">
					Page{" "}
					<input
						className="w-12 rounded-md border border-border-default px-1 text-center text-text-primary"
						type="number"
						min={1}
						max={numPages ?? 1}
						value={currentPage}
						onChange={(e) => {
							const page = Number(e.target.value)
							if (!Number.isNaN(page) && page >= 1) scrollToPage(page)
						}}
					/>{" "}
					of {numPages ?? "—"}
				</div>
				<div className="-mr-1 flex items-center gap-0.5">
						<button
							aria-pressed={showLayoutBoxes}
							className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
								showLayoutBoxes
									? "bg-accent-600 text-[var(--color-neutral-50)] hover:bg-accent-700"
									: "text-text-secondary hover:bg-surface-hover"
							}`}
						onClick={() => setShowLayoutBoxes((value) => !value)}
						title={showLayoutBoxes ? "Hide layout boxes" : "Show layout boxes"}
						type="button"
					>
						<LayoutBoxesIcon />
					</button>
				</div>
			</div>

			<div
				className="scrollbar-none flex-1 overflow-auto"
				onMouseDown={handleMainPointerDown}
				ref={scrollContainerRef}
			>
				<Document
					className="flex flex-col items-center gap-4 py-4"
					file={data.url}
					loading={<div className="p-8 text-text-tertiary">Rendering PDF…</div>}
					error={
						<div className="p-8 text-text-error">{renderError ?? "Failed to render PDF."}</div>
					}
					onLoadSuccess={(loadedDocument) => {
						pdfDocumentRef.current = loadedDocument
						setNumPages(loadedDocument.numPages)
						setRenderError(null)
					}}
					onItemClick={(args) => {
						void handleDocumentItemClick(args)
					}}
					onLoadError={(err) => setRenderError(err.message)}
				>
						{numPages != null
							? Array.from({ length: numPages }, (_, index) => index + 1).map((page) => (
									<PdfPageWithOverlay
										annotations={annotationsByPage.get(page)}
										blocks={blocksByPage.get(page)}
										colorByBlock={colorByBlock}
										estimatedAspectRatio={pageAspectRatioFor(page)}
										estimatedWidth={pageWidthEstimate}
										flashedAnnotationId={flashedAnnotationId}
										hoveredBlockId={hoveredBlockId}
										isPageRendered={renderedPages.has(page)}
										key={page}
										onClearHighlight={onClearHighlight}
										onClearSelectedBlock={onClearSelectedBlock}
										onDeleteReaderAnnotation={onDeleteReaderAnnotation}
										onRestoreReaderAnnotation={onRestoreReaderAnnotation}
										onHoverBlock={setHoveredBlockId}
										onPageCanvasReady={handlePageCanvasReady}
										onPageDims={handlePageDims}
										onPageRef={registerPageRef}
										onSelectAnnotation={setSelectedAnnotationId}
										onSelectBlock={onSelectBlock}
										onSetHighlight={onSetHighlight}
										onUpdateReaderAnnotationColor={onUpdateReaderAnnotationColor}
										page={page}
										pageColors={pageColors}
										palette={palette}
										previewedBlockId={previewedBlockId}
										previewedAnnotationId={previewedAnnotationId}
										renderAnnotationActions={renderAnnotationActions}
										renderActions={renderActions}
										scale={scale}
										selectedAnnotationId={selectedAnnotationId}
										selectedBlockId={selectedBlockId}
										showLayoutBoxes={showLayoutBoxes}
										useDarkModeCanvasFilter={useDarkModeCanvasFilter}
									/>
								))
						: null}
				</Document>
			</div>
			{selectedBlock &&
			isPreviewableBlock(selectedBlock) &&
			previewSuppressedBlockId !== "__all__" &&
			selectedBlock.blockId !== previewSuppressedBlockId ? (
				<SelectedBlockPreview
					block={selectedBlock}
					key={selectedBlock.blockId}
					onDismiss={onClearSelectedBlock}
				/>
			) : null}
		</div>
	)
}

export const PdfViewer = memo(PdfViewerInner)
PdfViewer.displayName = "PdfViewer"

function applyCanvasDisplayTreatment(
	canvas: HTMLCanvasElement,
	useDarkModeCanvasFilter: boolean | undefined,
) {
	canvas.style.filter = useDarkModeCanvasFilter ? DARK_MODE_CANVAS_FILTER : ""
	canvas.style.mixBlendMode = ""
	canvas.style.opacity = useDarkModeCanvasFilter ? DARK_MODE_CANVAS_OPACITY : ""
}

function findDisplayCanvas(root: ParentNode | null) {
	if (!root) return null
	const canvases = Array.from(root.querySelectorAll("canvas"))
	if (canvases.length === 0) return null
	const visibleCanvas =
		canvases.find(
			(canvas) =>
				canvas instanceof HTMLCanvasElement &&
				!canvas.classList.contains("hiddenCanvasElement"),
		) ?? canvases[0]
	return visibleCanvas instanceof HTMLCanvasElement ? visibleCanvas : null
}

function clamp(scale: number) {
	return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))
}

function getDocumentTheme(): "light" | "dark" {
	if (typeof document === "undefined") return "light"
	return document.documentElement.dataset.theme === "dark" ? "dark" : "light"
}

async function resolveExplicitDestination(
	dest: unknown,
	pdfDocument: PdfDocumentLike | null,
): Promise<unknown[] | null> {
	const resolvedDest = isPromiseLike(dest) ? await dest : dest
	if (Array.isArray(resolvedDest)) return resolvedDest
	if (typeof resolvedDest === "string") {
		const namedDestination = await pdfDocument?.getDestination?.(resolvedDest)
		return Array.isArray(namedDestination) ? namedDestination : null
	}
	return null
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return typeof value === "object" && value !== null && "then" in value
}

function getInternalDestinationTopRatio(
	destArray: unknown[] | null,
	pageDims: { w: number; h: number } | undefined,
) {
	if (!destArray) return undefined
	const destinationName = getDestinationName(destArray)
	if (!destinationName) return undefined
	if (destinationName === "Fit" || destinationName === "FitB" || destinationName === "FitV" || destinationName === "FitBV") {
		return 0
	}
	if (!pageDims || !Number.isFinite(pageDims.h) || pageDims.h <= 0) return undefined
	switch (destinationName) {
		case "XYZ":
			return clampPdfTopToRatio(getNullableNumber(destArray[3]) ?? pageDims.h, pageDims.h)
		case "FitH":
		case "FitBH":
			return clampPdfTopToRatio(getNullableNumber(destArray[2]) ?? pageDims.h, pageDims.h)
		case "FitR": {
			const top = getNullableNumber(destArray[5])
			if (top == null) return undefined
			return clampPdfTopToRatio(top, pageDims.h)
		}
		default:
			return undefined
	}
}

function getDestinationName(destArray: unknown[]) {
	const destination = destArray[1]
	if (typeof destination !== "object" || destination === null || !("name" in destination)) return null
	return typeof destination.name === "string" ? destination.name : null
}

function getNullableNumber(value: unknown) {
	return typeof value === "number" && Number.isFinite(value) ? value : null
}

function clampPdfTopToRatio(pdfTop: number, pageHeight: number) {
	return clampUnit(1 - pdfTop / pageHeight)
}

function clampUnit(value: number) {
	return Math.max(0, Math.min(1, value))
}

function shouldCollapseNotesOnMainClick(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return false
	return !target.closest("button, a, input, textarea, select, [contenteditable='true']")
}

function isEditableTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return false
	const tagName = target.tagName.toLowerCase()
	return (
		target.isContentEditable ||
		tagName === "input" ||
		tagName === "textarea" ||
		tagName === "select"
	)
}

function shouldIgnoreAnnotationHitTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return false
	return Boolean(target.closest("button, a, input, textarea, select, [contenteditable='true']"))
}

function isPreviewableBlock(block: Block) {
	return (block.type === "figure" || block.type === "table") && Boolean(block.imageUrl)
}

function findAnnotationAtPoint(
	annotations: ReaderAnnotation[],
	x: number,
	y: number,
	pageHeightPx: number,
) {
	const lineTolerance = pageHeightPx > 0 ? 6 / pageHeightPx : 0.008
	for (const annotation of [...annotations].reverse()) {
		for (const rect of annotation.body.rects) {
			if (annotation.kind === "highlight") {
				if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) {
					return annotation
				}
				continue
			}
			const underlineY = rect.y + rect.h * 0.9
			if (
				x >= rect.x &&
				x <= rect.x + rect.w &&
				Math.abs(y - underlineY) <= Math.max(lineTolerance, rect.h * 0.45)
			) {
				return annotation
			}
		}
	}
	return null
}

function isRenderableBbox(
	bbox: Block["bbox"] | null | undefined,
): bbox is NonNullable<Block["bbox"]> {
	if (!bbox) return false
	if (!Number.isFinite(bbox.x) || !Number.isFinite(bbox.y)) return false
	if (!Number.isFinite(bbox.w) || !Number.isFinite(bbox.h)) return false
	if (bbox.x < 0 || bbox.y < 0 || bbox.w <= 0 || bbox.h <= 0) return false
	if (bbox.x > 1 + BBOX_EPSILON || bbox.y > 1 + BBOX_EPSILON) return false
	if (bbox.x + bbox.w > 1 + BBOX_EPSILON) return false
	if (bbox.y + bbox.h > 1 + BBOX_EPSILON) return false
	return true
}

const PdfPageWithOverlay = memo(function PdfPageWithOverlay({
	annotations,
	blocks,
	colorByBlock,
	estimatedAspectRatio,
	estimatedWidth,
	flashedAnnotationId,
	hoveredBlockId,
	isPageRendered,
	onClearHighlight,
	onClearSelectedBlock,
	onDeleteReaderAnnotation,
	onRestoreReaderAnnotation,
	onHoverBlock,
	onPageCanvasReady,
	onPageDims,
	pageColors,
	onPageRef,
	onSelectAnnotation,
	onSelectBlock,
	onSetHighlight,
	onUpdateReaderAnnotationColor,
	page,
	palette,
	previewedBlockId,
	previewedAnnotationId,
	renderAnnotationActions,
	renderActions,
	scale,
	selectedAnnotationId,
	selectedBlockId,
	showLayoutBoxes,
	useDarkModeCanvasFilter,
}: {
	annotations: ReaderAnnotation[] | undefined
	blocks: Block[] | undefined
	colorByBlock?: Map<string, string>
	estimatedAspectRatio: number
	estimatedWidth: number | null
	flashedAnnotationId?: string | null
	hoveredBlockId?: string | null
	isPageRendered: boolean
	onClearHighlight?: (blockId: string) => Promise<void> | void
	onClearSelectedBlock?: () => void
	onDeleteReaderAnnotation?: (annotationId: string) => Promise<unknown> | unknown
	onRestoreReaderAnnotation?: (annotationId: string) => Promise<unknown> | unknown
	onHoverBlock?: (blockId: string | null) => void
	onPageCanvasReady?: (page: number) => void
	onPageDims?: (page: number, dims: { w: number; h: number }) => void
	pageColors?: { background: string; foreground: string }
	onPageRef?: (page: number, el: HTMLDivElement | null) => void
	onSelectAnnotation?: (annotationId: string | null) => void
	onSelectBlock?: (block: Block) => void
	onSetHighlight?: (blockId: string, color: string) => Promise<void> | void
	onUpdateReaderAnnotationColor?: (
		annotationId: string,
		color: string,
	) => Promise<unknown> | unknown
	page: number
	palette?: PaletteEntry[]
	previewedBlockId?: string | null
	previewedAnnotationId?: string | null
	renderAnnotationActions?: (annotation: ReaderAnnotation) => React.ReactNode
	renderActions?: (block: Block) => React.ReactNode
	scale: number
	selectedAnnotationId?: string | null
	selectedBlockId?: string | null
	showLayoutBoxes: boolean
	useDarkModeCanvasFilter?: boolean
}) {
	const wrapRef = useRef<HTMLDivElement | null>(null)
	const pageSurfaceStyle = useMemo(
		() => ({
			backgroundColor: pageColors?.background ?? "var(--color-reading-bg)",
		}),
		[pageColors],
	)

	const syncCanvasPresentation = useCallback(() => {
		const canvas = findDisplayCanvas(wrapRef.current)
		if (!(canvas instanceof HTMLCanvasElement)) return null
		applyCanvasDisplayTreatment(canvas, useDarkModeCanvasFilter)
		return canvas
	}, [useDarkModeCanvasFilter])

	// Warm the browser image cache for previewable figures/tables on this
	// page as soon as it's been rendered. The selected-block popup uses
	// `block.imageUrl` (a presigned MinIO URL); without this preload the
	// image only starts fetching when the user clicks, which surfaced as a
	// 100–500 ms gap between click and visible figure. Per-URL idempotent
	// via the module-level cache so repeated remounts (e.g. on view-mode
	// toggle) don't re-fetch.
	useEffect(() => {
		if (!isPageRendered || !blocks || typeof Image === "undefined") return
		for (const block of blocks) {
			if (!isPreviewableBlock(block) || !block.imageUrl) continue
			if (preloadedPreviewImageUrls.has(block.imageUrl)) continue
			preloadedPreviewImageUrls.add(block.imageUrl)
			const img = new Image()
			img.src = block.imageUrl
		}
	}, [blocks, isPageRendered])

	const [pointDims, setPointDims] = useState<{ w: number; h: number } | null>(null)
	// Real, measured CSS dimensions of the rendered canvas. We use these
	// for the SVG and viewBox so coordinates are in screen pixels and
	// strokes don't get distorted by viewBox stretching.
	const [canvasSize, setCanvasSize] = useState<{ w: number; h: number } | null>(null)
	// Tracks whether react-pdf is in the middle of an async canvas render
	// for the current scale. While true the overlay is hidden so the user
	// doesn't see SVG/blocks floating over a blanked canvas.
	const [isRendering, setIsRendering] = useState(false)
	const lastRenderedScaleRef = useRef<number | null>(null)

	// Mark the page as actively re-rendering when the scale changes;
	// onRenderSuccess clears it. Skips the very first mount.
	useEffect(() => {
		if (lastRenderedScaleRef.current === null) return
		if (lastRenderedScaleRef.current === scale) return
		setIsRendering(true)
	}, [scale])

	// Track the real rendered canvas dimensions. ResizeObserver picks up
	// zoom changes and react-pdf swapping the canvas element. We feed
	// these into the SVG's viewBox so 1 SVG unit == 1 CSS pixel and
	// strokes never get distorted by non-uniform viewBox stretching.
	useEffect(() => {
		const wrap = wrapRef.current
		if (!wrap || typeof ResizeObserver === "undefined") return
		let observedCanvas: HTMLCanvasElement | null = null
		const update = () => {
			const canvas = syncCanvasPresentation()
			if (!canvas) return
			if (observedCanvas !== canvas) {
				if (observedCanvas) resizeObserver.unobserve(observedCanvas)
				observedCanvas = canvas
				resizeObserver.observe(canvas)
			}
			const r = canvas.getBoundingClientRect()
			if (r.width <= 0 || r.height <= 0) return
			setCanvasSize((prev) =>
				prev && prev.w === r.width && prev.h === r.height ? prev : { w: r.width, h: r.height },
			)
		}
		const resizeObserver = new ResizeObserver(update)
		update()
		resizeObserver.observe(wrap)
		const mutationObserver =
			typeof MutationObserver === "undefined"
				? null
				: new MutationObserver(() => {
						update()
					})
		mutationObserver?.observe(wrap, { childList: true, subtree: true })
		return () => {
			mutationObserver?.disconnect()
			resizeObserver.disconnect()
		}
		// scale + pointDims drive canvas size, so re-bind when they change
		// (the canvas element itself may be swapped out by react-pdf).
	}, [pointDims, scale, syncCanvasPresentation])

	// Use measured canvas size when available; fall back to pointDims*scale
	// for the first frame before the ResizeObserver has reported.
	const displayW = canvasSize?.w ?? (pointDims ? pointDims.w * scale : 0)
	const displayH = canvasSize?.h ?? (pointDims ? pointDims.h * scale : 0)
	const placeholderWidth = displayW > 0 ? displayW : estimatedWidth ?? 720
	const placeholderHeight =
		displayH > 0 ? displayH : Math.max(placeholderWidth * estimatedAspectRatio, 480)

	// Persisted annotations and the parsed-blocks layer are independent of
	// live selection updates. Memoize so they don't re-render on every
	// selection tick (otherwise large pages stutter while hovering and
	// selecting around the document). Note
	// that selection state no longer affects shape props — the outline is
	// painted as a separate sibling so the shape itself never repaints on
	// select/deselect (matches pdf.js's editor pattern).
	const annotationNodes = useMemo(
		() =>
			(annotations ?? []).map((annotation) => (
				<ReaderAnnotationShape
					annotation={annotation}
					flashed={annotation.id === flashedAnnotationId}
					H={displayH}
					key={annotation.id}
					selected={annotation.id === (previewedAnnotationId ?? selectedAnnotationId)}
					W={displayW}
				/>
			)),
		[
			annotations,
			displayH,
			displayW,
			flashedAnnotationId,
			onSelectAnnotation,
			previewedAnnotationId,
			selectedAnnotationId,
		],
	)

	const selectedAnnotation = useMemo(
		() =>
			previewedAnnotationId ?? selectedAnnotationId
				? (annotations ?? []).find(
						(a) => a.id === (previewedAnnotationId ?? selectedAnnotationId),
					) ?? null
				: null,
		[annotations, previewedAnnotationId, selectedAnnotationId],
	)

	const blocksLayer = useMemo(
		() =>
			blocks?.map((block) => {
				if (!isRenderableBbox(block.bbox)) return null
				const isSelected = selectedBlockId === block.blockId
				const isHovered =
					hoveredBlockId === block.blockId || previewedBlockId === block.blockId
				const highlightColor = colorByBlock?.get(block.blockId) ?? null
				const showBoxChrome =
					showLayoutBoxes || isSelected || isHovered || highlightColor !== null
				const fill = highlightColor ? paletteVisualTokens(palette ?? [], highlightColor) : null
				const hasToolbar = Boolean(
					renderActions || (palette && (onSetHighlight || onClearHighlight)),
				)
				const blockLabel = `block ${block.blockIndex + 1}`
				const showToolbar = hasToolbar && isSelected

				return (
						<div
							className="group pointer-events-none absolute"
							data-block-id={block.blockId}
							data-block-type={block.type}
							key={block.blockId}
						style={{
							left: `${block.bbox.x * 100}%`,
							top: `${block.bbox.y * 100}%`,
							width: `${block.bbox.w * 100}%`,
							height: `${block.bbox.h * 100}%`,
						}}
					>
							<div
								className={`absolute inset-0 rounded-[2px] border transition-colors ${
									!showBoxChrome
										? "border-transparent bg-transparent"
										: isSelected
											? "border-transparent bg-accent-600/12"
											: isHovered
												? "border-transparent bg-accent-600/7"
												: showLayoutBoxes
													? "border-accent-600/35 bg-accent-600/3"
													: "border-transparent bg-transparent"
								}`}
							style={
								fill
									? {
											background: fill.fillWash,
										}
									: undefined
							}
						/>
						<button
							aria-label={`Focus ${blockLabel}`}
							className={`pointer-events-auto absolute left-0 top-0 z-[2] h-full rounded-l-[2px] transition-colors ${
								fill
									? "hover:brightness-110"
									: isSelected || isHovered || showLayoutBoxes
										? "bg-accent-600/22 hover:bg-accent-600/30"
										: "bg-accent-600/10 hover:bg-accent-600/20"
							}`}
							style={{
								width: "6px",
								...(fill ? { backgroundColor: fill.fillBg } : {}),
							}}
							onClick={(e) => {
								e.stopPropagation()
								if (selectedBlockId === block.blockId) {
									onClearSelectedBlock?.()
									return
								}
								onSelectBlock?.(block)
							}}
							onMouseEnter={() => onHoverBlock?.(block.blockId)}
							onMouseLeave={() => onHoverBlock?.(null)}
							title={(block.caption ?? block.text ?? `[${block.type}]`).slice(0, 120)}
							type="button"
						/>
						{showBoxChrome ? (
								<button
									aria-label={`Focus ${blockLabel}`}
									className={`pointer-events-auto absolute -top-[14px] left-0 z-[2] inline-flex select-none rounded-t-md rounded-br-md px-1.5 py-0.5 font-medium text-[10px] leading-none shadow-[0_1px_2px_rgba(15,23,42,0.18)] transition-opacity ${
										fill ? "" : ""
									}`}
								onClick={(e) => {
									e.stopPropagation()
									if (selectedBlockId === block.blockId) {
										onClearSelectedBlock?.()
										return
									}
									onSelectBlock?.(block)
								}}
								onMouseEnter={() => onHoverBlock?.(block.blockId)}
								onMouseLeave={() => onHoverBlock?.(null)}
									style={
										fill
											? {
													backgroundColor: "var(--color-reader-tag-bg)",
													color: "var(--color-reader-tag-text)",
													boxShadow:
														"inset 0 0 0 1px var(--color-reader-tag-border), 0 1px 2px rgba(15,23,42,0.18)",
													opacity: isSelected || isHovered ? 1 : 0.95,
												}
											: {
													backgroundColor: "var(--color-reader-tag-bg)",
													color: "var(--color-reader-tag-text)",
													boxShadow:
														"inset 0 0 0 1px var(--color-reader-tag-border), 0 1px 2px rgba(15,23,42,0.18)",
												}
									}
								type="button"
							>
								{blockLabel}
							</button>
						) : null}
						{hasToolbar ? (
							// biome-ignore lint/a11y/noStaticElementInteractions: presentational toolbar wrapper; handlers only stop propagation so chip clicks don't reselect the bbox underneath
							<div
								className={`absolute right-full top-0 z-[3] mr-2 flex flex-col items-center gap-1 rounded-md border border-border-subtle bg-bg-overlay/95 px-1 py-1 shadow-[var(--shadow-popover)] backdrop-blur transition-opacity ${
									showToolbar
										? "pointer-events-auto opacity-100"
										: "pointer-events-none opacity-0"
								}`}
								onClick={(e) => e.stopPropagation()}
								onKeyDown={(e) => e.stopPropagation()}
								onMouseDown={(e) => e.stopPropagation()}
							>
								{palette && (onSetHighlight || onClearHighlight) ? (
									<>
										<BlockHighlightPicker
											currentColor={highlightColor ?? undefined}
											onClear={() => void onClearHighlight?.(block.blockId)}
											onPick={(color) => void onSetHighlight?.(block.blockId, color)}
											orientation="vertical"
											palette={palette}
											shape="round"
											size="xs"
										/>
										<div className="my-0.5 h-px w-4 bg-border-subtle" />
									</>
								) : null}
								<button
									aria-label="Copy block text"
									className="flex h-7 w-7 items-center justify-center rounded-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
									onClick={(e) => {
										e.stopPropagation()
										const text = (block.caption ?? block.text ?? "").trim()
										if (text) void copyTextToClipboard(text)
									}}
									title="Copy"
									type="button"
								>
									<CopyIcon />
								</button>
								{renderActions ? renderActions(block) : null}
							</div>
						) : null}
					</div>
				)
			}),
			[
				blocks,
				colorByBlock,
				hoveredBlockId,
				onClearHighlight,
				onHoverBlock,
				onSelectBlock,
				onSetHighlight,
				palette,
				previewedBlockId,
				renderActions,
				selectedBlockId,
				showLayoutBoxes,
			],
	)

	const handleWrapRef = useCallback(
		(el: HTMLDivElement | null) => {
			wrapRef.current = el
			onPageRef?.(page, el)
		},
		[onPageRef, page],
	)

	const handlePageClick = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			if (!onSelectAnnotation) return
			if (shouldIgnoreAnnotationHitTarget(event.target)) return
			const selection = window.getSelection()
			if (selection && selection.toString().trim()) return
			const wrap = wrapRef.current
			if (!wrap || displayW <= 0 || displayH <= 0) return
			const rect = wrap.getBoundingClientRect()
			if (rect.width <= 0 || rect.height <= 0) return
			const x = clampUnit((event.clientX - rect.left) / rect.width)
			const y = clampUnit((event.clientY - rect.top) / rect.height)
			const hit = findAnnotationAtPoint(annotations ?? [], x, y, displayH)
			if (hit) {
				event.stopPropagation()
				onSelectAnnotation(hit.id)
				return
			}
			if (selectedAnnotationId) onSelectAnnotation(null)
		},
		[annotations, displayH, displayW, onSelectAnnotation, selectedAnnotationId],
	)

	return (
		<div
			className="relative shadow-md"
			onClick={handlePageClick}
			ref={handleWrapRef}
			data-page-number={page}
			style={{
				...pageSurfaceStyle,
				isolation: "isolate",
				minHeight: `${placeholderHeight}px`,
				width: `${placeholderWidth}px`,
			}}
		>
			{isPageRendered ? (
					<Page
						onLoadSuccess={(loadedPage) => {
						const view = (loadedPage as { view?: number[] }).view
						if (view && view.length === 4) {
							const dims = { w: view[2] - view[0], h: view[3] - view[1] }
							setPointDims(dims)
							onPageDims?.(page, dims)
						}
					}}
						onRenderSuccess={() => {
							syncCanvasPresentation()
							lastRenderedScaleRef.current = scale
							setIsRendering(false)
							onPageCanvasReady?.(page)
						}}
					pageColors={pageColors}
					pageNumber={page}
					renderAnnotationLayer
					renderTextLayer
					scale={scale}
				/>
			) : (
				<div
					aria-hidden="true"
					className="h-full w-full rounded-[inherit]"
					style={pageSurfaceStyle}
				/>
			)}
			{isPageRendered && pointDims && displayW > 0 && displayH > 0 && !isRendering ? (
				// Overlay sized to the real measured canvas dimensions
				// (canvasSize) so the SVG always covers exactly the canvas
				// — no underflow at the page bottom, no overflow.
				<div
					className="pointer-events-none absolute left-0 top-0 z-[3]"
					style={{ width: `${displayW}px`, height: `${displayH}px` }}
				>
					<svg
						aria-label={`Reader annotations page ${page}`}
						className="pointer-events-none absolute inset-0 z-[1]"
						height={displayH}
						viewBox={`0 0 ${displayW} ${displayH}`}
						width={displayW}
					>
						{annotationNodes}
						{selectedAnnotation ? (
							<ReaderAnnotationSelectionOutline
								annotation={selectedAnnotation}
								H={displayH}
								W={displayW}
							/>
						) : null}
					</svg>
					<div className="pointer-events-none absolute inset-0 z-[2]">{blocksLayer}</div>
					{selectedAnnotation ? (
						<ReaderAnnotationActionsPopover
							annotation={selectedAnnotation}
							extraActions={renderAnnotationActions?.(selectedAnnotation)}
							H={displayH}
							onChangeColor={(color: string) => {
								void onUpdateReaderAnnotationColor?.(selectedAnnotation.id, color)
							}}
							onDelete={() => {
								void onDeleteReaderAnnotation?.(selectedAnnotation.id)
								onSelectAnnotation?.(null)
							}}
							onRestore={
								onRestoreReaderAnnotation
									? () => {
											void onRestoreReaderAnnotation(selectedAnnotation.id)
											onSelectAnnotation?.(null)
										}
									: undefined
							}
							W={displayW}
						/>
					) : null}
				</div>
			) : null}
		</div>
	)
})

PdfPageWithOverlay.displayName = "PdfPageWithOverlay"

function derivePdfSelectionAnnotationTarget({
	container,
	range,
	selectedText,
}: {
	container: HTMLElement
	range: Range
	selectedText: string
}) {
	const pageMetrics = Array.from(container.querySelectorAll<HTMLElement>("[data-page-number]"))
		.map((pageElement) => {
			const page = Number(pageElement.dataset.pageNumber ?? "0")
			const target = findDisplayCanvas(pageElement) ?? pageElement
			const rect = target.getBoundingClientRect()
			if (!page || rect.width <= 0 || rect.height <= 0) return null
			return { page, rect }
		})
		.filter((entry): entry is { page: number; rect: DOMRect } => entry != null)

	if (pageMetrics.length === 0) return undefined

	const rectsByPage = new Map<number, Array<{ x: number; y: number; w: number; h: number }>>()
	for (const clientRect of Array.from(range.getClientRects())) {
		if (clientRect.width <= 0 || clientRect.height <= 0) continue
		const pageMetric = pageMetrics.find(({ rect }) => rectIntersectionArea(clientRect, rect) > 0)
		if (!pageMetric) continue
		const rects = rectsByPage.get(pageMetric.page) ?? []
		rects.push({
			x: clampAnnotationUnit((clientRect.left - pageMetric.rect.left) / pageMetric.rect.width),
			y: clampAnnotationUnit((clientRect.top - pageMetric.rect.top) / pageMetric.rect.height),
			w: clientRect.width / pageMetric.rect.width,
			h: clientRect.height / pageMetric.rect.height,
		})
		rectsByPage.set(pageMetric.page, rects)
	}

	if (rectsByPage.size !== 1) return undefined
	const [page, rawRects] = rectsByPage.entries().next().value ?? []
	if (typeof page !== "number" || !rawRects) return undefined
	const rects = normalizeAnnotationRects(rawRects)
	if (rects.length === 0) return undefined
	return {
		page,
		body: {
			quote: selectedText,
			rects,
		},
	}
}

function rectIntersectionArea(
	a: Pick<DOMRectReadOnly, "left" | "top" | "right" | "bottom">,
	b: Pick<DOMRectReadOnly, "left" | "top" | "right" | "bottom">,
) {
	const width = Math.min(a.right, b.right) - Math.max(a.left, b.left)
	if (width <= 0) return 0
	const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
	if (height <= 0) return 0
	return width * height
}

function CopyIcon() {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="14"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.6"
			viewBox="0 0 24 24"
			width="14"
		>
			<rect height="13" rx="2" width="13" x="9" y="9" />
			<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
		</svg>
	)
}

function LayoutBoxesIcon() {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="16"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.7"
			viewBox="0 0 24 24"
			width="16"
		>
			<rect height="14" rx="2" width="10" x="3" y="5" />
			<path d="M16 7h5M16 12h5M16 17h5" />
			<path d="M8 5v14" />
		</svg>
	)
}
