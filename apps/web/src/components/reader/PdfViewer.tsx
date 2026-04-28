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
import { type PaletteEntry, paletteVisualTokens } from "@/lib/highlight-palette"
import {
	READER_ANNOTATION_COLORS,
	clampUnit as clampAnnotationUnit,
	distanceBetweenPoints,
	rectFromPoints,
	type ReaderAnnotationBody,
	type ReaderAnnotationPoint,
	type ReaderAnnotationTool,
} from "@/lib/reader-annotations"
import { BlockHighlightPicker } from "./BlockHighlightPicker"
import { FloatingMarkupPalette } from "./FloatingMarkupPalette"
import {
	bodyHasNoVisibleExtent,
	padHighlightRect,
	ReaderAnnotationActionsPopover,
	ReaderAnnotationDraft,
	ReaderAnnotationSelectionOutline,
	ReaderAnnotationShape,
} from "./ReaderAnnotationLayer"
import { SelectedBlockPreview } from "./SelectedBlockPreview"

const MIN_SCALE = 0.5
const MAX_SCALE = 3
const FIT_WIDTH_GUTTER_PX = 32
const BBOX_EPSILON = 0.02
const VIRTUAL_WINDOW_RADIUS = 2
const DEFAULT_PAGE_ASPECT_RATIO = 11 / 8.5

// Module-level cache of figure/table image URLs we've already warmed in
// the browser image cache. See the preload effect in PdfPageWithOverlay.
const preloadedPreviewImageUrls = new Set<string>()

interface PdfViewerProps {
	paperId: string
	requestedPage?: number
	requestedBlockY?: number
	requestedPageNonce?: number
	onInteract?: () => void
	onPageChange?: (page: number) => void
	onViewportAnchorChange?: (page: number, yRatio: number) => void
	blocks?: Block[]
	colorByBlock?: Map<string, string>
	palette?: PaletteEntry[]
	selectedBlockId?: string | null
	onSelectBlock?: (block: Block) => void
	onClearSelectedBlock?: () => void
	onSetHighlight?: (blockId: string, color: string) => Promise<void> | void
	onClearHighlight?: (blockId: string) => Promise<void> | void
	readerAnnotations?: ReaderAnnotation[]
	onCreateReaderAnnotation?: (input: {
		page: number
		kind: ReaderAnnotationTool
		color: string
		body: ReaderAnnotationBody
	}) => Promise<unknown> | unknown
	onDeleteReaderAnnotation?: (annotationId: string) => Promise<unknown> | unknown
	onUpdateReaderAnnotationColor?: (
		annotationId: string,
		color: string,
	) => Promise<unknown> | unknown
	// Mirrors BlocksPanel's renderActions slot — caller emits the
	// cite/add-note button so the PDF toolbar matches the parsed-blocks pane.
	renderActions?: (block: Block) => React.ReactNode
}

function PdfViewerInner({
	paperId,
	requestedPage,
	requestedBlockY,
	requestedPageNonce,
	onInteract,
	onPageChange,
	onViewportAnchorChange,
	blocks,
	colorByBlock,
	palette,
	selectedBlockId,
	onSelectBlock,
	onClearSelectedBlock,
	onSetHighlight,
	onClearHighlight,
	readerAnnotations,
	onCreateReaderAnnotation,
	onDeleteReaderAnnotation,
	onUpdateReaderAnnotationColor,
	renderActions,
}: PdfViewerProps) {
	const { data, isLoading, isError, refetch } = usePaperPdfUrl(paperId)
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
	const [annotationMode, setAnnotationMode] = useState(false)
	const [annotationTool, setAnnotationTool] = useState<ReaderAnnotationTool>("highlight")
	const [annotationColor, setAnnotationColor] = useState(READER_ANNOTATION_COLORS[0]?.value ?? "#f4c84f")
	const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null)
	const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null)
	const [pageRefsVersion, setPageRefsVersion] = useState(0)
	const [pageCanvasVersion, setPageCanvasVersion] = useState(0)
	const viewerRef = useRef<HTMLDivElement>(null)
	const scrollContainerRef = useRef<HTMLDivElement>(null)
	const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())
	const intersectionRatiosRef = useRef<Map<number, number>>(new Map())
	const activePageRef = useRef(1)
	const intersectionObserverRef = useRef<IntersectionObserver | null>(null)
	const scrollRafRef = useRef<number | null>(null)
	const handledJumpRequestRef = useRef<string | null>(null)

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
		setAnnotationMode(false)
		setAnnotationTool("highlight")
		setAnnotationColor(READER_ANNOTATION_COLORS[0]?.value ?? "#f4c84f")
		setSelectedAnnotationId(null)
		setHoveredBlockId(null)
		setPageRefsVersion(0)
		setPageCanvasVersion(0)
		pageRefs.current.clear()
		intersectionRatiosRef.current.clear()
		activePageRef.current = 1
		handledJumpRequestRef.current = null
	}, [paperId])

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

	const canAnnotate = Boolean(onCreateReaderAnnotation)

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

	const renderCenterPages = useMemo(() => {
		const centers = new Set<number>()
		centers.add(currentPage)
		if (requestedPage != null) centers.add(requestedPage)
		if (selectedBlock?.page != null) centers.add(selectedBlock.page)
		return Array.from(centers)
	}, [currentPage, requestedPage, selectedBlock])

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
			const canvas = el.querySelector("canvas")
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
		if (handledJumpRequestRef.current === requestKey) return
		// Always scroll on a focus request. Self-pane bbox clicks no longer
		// emit one (the block is visible by definition), so the only callers
		// here are cross-view toggles and citation chip jumps — both want to
		// re-center the target even if it's currently in viewport.
		if (!scrollToPage(requestedPage, requestedBlockY)) return
		handledJumpRequestRef.current = requestKey
	}, [numPages, pageCanvasVersion, pageRefsVersion, renderedPages, requestedPageNonce, requestedPage, requestedBlockY, scrollToPage])

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
	}, [computeTopmostVisiblePage, numPages, onViewportAnchorChange])

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
	}, [computeTopmostVisiblePage, onViewportAnchorChange])

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
			if (e.target instanceof HTMLElement && e.target.isContentEditable) return
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
		if (prev && prev !== el) {
			intersectionObserverRef.current?.unobserve(prev)
		}
		if (el) {
			pageRefs.current.set(page, el)
			intersectionObserverRef.current?.observe(el)
			setPageRefsVersion((value) => value + 1)
			return
		}
		if (prev) {
			intersectionObserverRef.current?.unobserve(prev)
		}
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

	const handleMainPointerDown = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			if (!shouldCollapseNotesOnMainClick(event.target)) return
			onInteract?.()
		},
		[onInteract],
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
		<div className="relative flex h-full flex-col bg-[var(--color-reading-bg)]" ref={viewerRef}>
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
					{canAnnotate ? (
						<button
							aria-pressed={annotationMode}
							className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
								annotationMode
									? "bg-accent-600 text-text-inverse hover:bg-accent-700"
									: "text-text-secondary hover:bg-surface-hover"
							}`}
							onClick={() => {
								setAnnotationMode((value) => !value)
								setSelectedAnnotationId(null)
							}}
							title={annotationMode ? "Exit markup mode" : "Enter markup mode"}
							type="button"
						>
							<MarkupIcon />
						</button>
					) : null}
					<button
						aria-pressed={showLayoutBoxes}
						className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
							showLayoutBoxes
								? "bg-accent-600 text-text-inverse hover:bg-accent-700"
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
					onLoadSuccess={({ numPages: total }) => {
						setNumPages(total)
						setRenderError(null)
					}}
					onLoadError={(err) => setRenderError(err.message)}
				>
						{numPages != null
							? Array.from({ length: numPages }, (_, index) => index + 1).map((page) => (
									<PdfPageWithOverlay
										annotationColor={annotationColor}
										annotationMode={annotationMode}
										annotations={annotationsByPage.get(page)}
										annotationTool={annotationTool}
										blocks={blocksByPage.get(page)}
										colorByBlock={colorByBlock}
										estimatedAspectRatio={pageAspectRatioFor(page)}
										estimatedWidth={pageWidthEstimate}
										hoveredBlockId={hoveredBlockId}
										isPageRendered={renderedPages.has(page)}
										key={page}
										onClearHighlight={onClearHighlight}
										onClearSelectedBlock={onClearSelectedBlock}
										onCreateReaderAnnotation={onCreateReaderAnnotation}
										onDeleteReaderAnnotation={onDeleteReaderAnnotation}
										onHoverBlock={setHoveredBlockId}
										onPageCanvasReady={handlePageCanvasReady}
										onPageDims={handlePageDims}
										onPageRef={registerPageRef}
										onSelectAnnotation={setSelectedAnnotationId}
										onSelectBlock={onSelectBlock}
										onSetHighlight={onSetHighlight}
										onUpdateReaderAnnotationColor={onUpdateReaderAnnotationColor}
										page={page}
										palette={palette}
										renderActions={renderActions}
										scale={scale}
									selectedAnnotationId={selectedAnnotationId}
									selectedBlockId={selectedBlockId}
									showLayoutBoxes={showLayoutBoxes}
								/>
							))
						: null}
				</Document>
			</div>
			{selectedBlock && isPreviewableBlock(selectedBlock) ? (
				<SelectedBlockPreview
					block={selectedBlock}
					key={selectedBlock.blockId}
					onDismiss={onClearSelectedBlock}
				/>
			) : null}
			{canAnnotate && annotationMode ? (
				<FloatingMarkupPalette
					color={annotationColor}
					onChangeColor={setAnnotationColor}
					onChangeTool={setAnnotationTool}
					onClose={() => {
						setAnnotationMode(false)
						setSelectedAnnotationId(null)
					}}
					tool={annotationTool}
				/>
			) : null}
		</div>
	)
}

export const PdfViewer = memo(PdfViewerInner)
PdfViewer.displayName = "PdfViewer"

function clamp(scale: number) {
	return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))
}


function clampUnit(value: number) {
	return Math.max(0, Math.min(1, value))
}

function shouldCollapseNotesOnMainClick(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return false
	return !target.closest("button, a, input, textarea, select, [contenteditable='true']")
}

function isPreviewableBlock(block: Block) {
	return (block.type === "figure" || block.type === "table") && Boolean(block.imageUrl)
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
	annotationColor,
	annotationMode,
	annotations,
	annotationTool,
	blocks,
	colorByBlock,
	estimatedAspectRatio,
	estimatedWidth,
	hoveredBlockId,
	isPageRendered,
	onClearHighlight,
	onClearSelectedBlock,
	onCreateReaderAnnotation,
	onDeleteReaderAnnotation,
	onHoverBlock,
	onPageCanvasReady,
	onPageDims,
	onPageRef,
	onSelectAnnotation,
	onSelectBlock,
	onSetHighlight,
	onUpdateReaderAnnotationColor,
	page,
	palette,
	renderActions,
	scale,
	selectedAnnotationId,
	selectedBlockId,
	showLayoutBoxes,
}: {
	annotationColor: string
	annotationMode: boolean
	annotations: ReaderAnnotation[] | undefined
	annotationTool: ReaderAnnotationTool
	blocks: Block[] | undefined
	colorByBlock?: Map<string, string>
	estimatedAspectRatio: number
	estimatedWidth: number | null
	hoveredBlockId?: string | null
	isPageRendered: boolean
	onClearHighlight?: (blockId: string) => Promise<void> | void
	onClearSelectedBlock?: () => void
	onCreateReaderAnnotation?: (input: {
		page: number
		kind: ReaderAnnotationTool
		color: string
		body: ReaderAnnotationBody
	}) => Promise<unknown> | unknown
	onDeleteReaderAnnotation?: (annotationId: string) => Promise<unknown> | unknown
	onHoverBlock?: (blockId: string | null) => void
	onPageCanvasReady?: (page: number) => void
	onPageDims?: (page: number, dims: { w: number; h: number }) => void
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
	renderActions?: (block: Block) => React.ReactNode
	scale: number
	selectedAnnotationId?: string | null
	selectedBlockId?: string | null
	showLayoutBoxes: boolean
}) {
	const wrapRef = useRef<HTMLDivElement | null>(null)
	const annotationSvgRef = useRef<SVGSVGElement | null>(null)

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
	const [draftBody, setDraftBody] = useState<ReaderAnnotationBody | null>(null)
	// Tracks whether react-pdf is in the middle of an async canvas render
	// for the current scale. While true the overlay is hidden so the user
	// doesn't see SVG/blocks floating over a blanked canvas.
	const [isRendering, setIsRendering] = useState(false)
	const lastRenderedScaleRef = useRef<number | null>(null)
	const draftSessionRef = useRef<
		| {
				pointerId: number
				start: ReaderAnnotationPoint
				current: ReaderAnnotationPoint
				points: ReaderAnnotationPoint[]
		  }
		| null
	>(null)

	const getPagePointFromPointer = useCallback((clientX: number, clientY: number) => {
		const svg = annotationSvgRef.current
		if (!svg) return null
		const rect = svg.getBoundingClientRect()
		if (rect.width <= 0 || rect.height <= 0) return null
		return {
			x: clampAnnotationUnit((clientX - rect.left) / rect.width),
			y: clampAnnotationUnit((clientY - rect.top) / rect.height),
		}
	}, [])

	// While we await the POST + refetch, keep the released shape visible
	// so the user doesn't see a blank gap between "released draft" and
	// "persisted annotation appearing in the list".
	const pendingPersistRef = useRef(false)

	const finishDraft = useCallback(
		async (commit: boolean) => {
			const session = draftSessionRef.current
			draftSessionRef.current = null
			if (!commit || !session || !onCreateReaderAnnotation) {
				setDraftBody(null)
				return
			}

			// Bare clicks (no real drag) shouldn't litter the page with minimum-
			// sized shapes. Require a minimum movement before committing.
			const dragDistance = distanceBetweenPoints(session.start, session.current)
			const inkTotalDistance =
				annotationTool === "ink"
					? session.points.reduce(
							(sum, point, idx) =>
								idx === 0 ? 0 : sum + distanceBetweenPoints(session.points[idx - 1]!, point),
							0,
						)
					: 0
			if (annotationTool === "ink" ? inkTotalDistance < 0.01 : dragDistance < 0.01) {
				setDraftBody(null)
				return
			}

			const body =
				annotationTool === "highlight"
					? { rect: padHighlightRect(rectFromPoints(session.start, session.current)) }
					: annotationTool === "underline"
						? { from: session.start, to: session.current }
						: { points: session.points }

			if (bodyHasNoVisibleExtent(body)) {
				setDraftBody(null)
				return
			}

			// Hold the draft on screen until the persisted annotation lands
			// in the annotations array. The useEffect on `annotations` clears
			// it then, giving a seamless handoff (no flash).
			pendingPersistRef.current = true
			setDraftBody(body)
			try {
				await onCreateReaderAnnotation({
					page,
					kind: annotationTool,
					color: annotationColor,
					body,
				})
			} catch (err) {
				console.error("Failed to persist reader annotation", err)
				pendingPersistRef.current = false
				setDraftBody(null)
			}
		},
		[annotationColor, annotationTool, onCreateReaderAnnotation, page],
	)

	useEffect(() => {
		if (!pendingPersistRef.current) return
		// If a new draw is already in progress, don't clear it.
		if (draftSessionRef.current) return
		pendingPersistRef.current = false
		setDraftBody(null)
	}, [annotations])

	useEffect(() => {
		if (annotationMode) return
		draftSessionRef.current = null
		setDraftBody(null)
	}, [annotationMode])

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
		const update = () => {
			const canvas = wrap.querySelector("canvas")
			if (!canvas) return
			const r = canvas.getBoundingClientRect()
			if (r.width <= 0 || r.height <= 0) return
			setCanvasSize((prev) =>
				prev && prev.w === r.width && prev.h === r.height ? prev : { w: r.width, h: r.height },
			)
		}
		update()
		const observer = new ResizeObserver(update)
		observer.observe(wrap)
		const canvas = wrap.querySelector("canvas")
		if (canvas) observer.observe(canvas)
		return () => observer.disconnect()
		// scale + pointDims drive canvas size, so re-bind when they change
		// (the canvas element itself may be swapped out by react-pdf).
	}, [scale, pointDims])

	// Use measured canvas size when available; fall back to pointDims*scale
	// for the first frame before the ResizeObserver has reported.
	const displayW = canvasSize?.w ?? (pointDims ? pointDims.w * scale : 0)
	const displayH = canvasSize?.h ?? (pointDims ? pointDims.h * scale : 0)
	const placeholderWidth = displayW > 0 ? displayW : estimatedWidth ?? 720
	const placeholderHeight =
		displayH > 0 ? displayH : Math.max(placeholderWidth * estimatedAspectRatio, 480)

	// Persisted annotations and the parsed-blocks layer are independent of
	// draftBody. Memoize so they don't re-render on every pointermove tick
	// (otherwise large pages stutter while drawing ink/underlines). Note
	// that selection state no longer affects shape props — the outline is
	// painted as a separate sibling so the shape itself never repaints on
	// select/deselect (matches pdf.js's editor pattern).
	const annotationNodes = useMemo(
		() =>
			(annotations ?? []).map((annotation) => (
				<ReaderAnnotationShape
					annotation={annotation}
					H={displayH}
					key={annotation.id}
					onSelect={onSelectAnnotation}
					W={displayW}
				/>
			)),
		[annotations, displayH, displayW, onSelectAnnotation],
	)

	const selectedAnnotation = useMemo(
		() =>
			selectedAnnotationId
				? (annotations ?? []).find((a) => a.id === selectedAnnotationId) ?? null
				: null,
		[annotations, selectedAnnotationId],
	)

	const blocksLayer = useMemo(
		() =>
			blocks?.map((block) => {
				if (!isRenderableBbox(block.bbox)) return null
				const isSelected = selectedBlockId === block.blockId
				const isHovered = hoveredBlockId === block.blockId
				const highlightColor = colorByBlock?.get(block.blockId) ?? null
				const showBoxChrome =
					showLayoutBoxes || isSelected || isHovered || highlightColor !== null
				const fill = highlightColor ? paletteVisualTokens(palette ?? [], highlightColor) : null
				const hasToolbar = palette && (onSetHighlight || onClearHighlight || renderActions)

				return (
					// biome-ignore lint/a11y/noStaticElementInteractions: the block shell mirrors hover state and hosts the click-to-select handler
					// biome-ignore lint/a11y/useKeyWithClickEvents: keyboard activation lives in the parsed-blocks pane; here we only need a click target on the bbox
						<div
							className="group absolute cursor-pointer"
							data-block-id={block.blockId}
							data-block-type={block.type}
							key={block.blockId}
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
						style={{
							left: `${block.bbox.x * 100}%`,
							top: `${block.bbox.y * 100}%`,
							width: `${block.bbox.w * 100}%`,
							height: `${block.bbox.h * 100}%`,
						}}
						title={(block.caption ?? block.text ?? `[${block.type}]`).slice(0, 120)}
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
						{showBoxChrome ? (
							<span
								className={`pointer-events-none absolute -top-[14px] left-0 z-[1] inline-flex select-none rounded-t-md rounded-br-md px-1.5 py-0.5 font-medium text-[10px] leading-none shadow-[0_1px_2px_rgba(15,23,42,0.18)] ${
									fill
										? ""
										: `text-text-inverse ${isSelected || isHovered ? "bg-accent-600" : "bg-accent-600/85"}`
								}`}
								style={
									fill
										? {
												background: fill.chipBg,
												color: fill.chipText,
												opacity: isSelected || isHovered ? 1 : 0.95,
											}
										: undefined
								}
							>
								block {block.blockIndex + 1}
							</span>
						) : null}
						{hasToolbar ? (
							// biome-ignore lint/a11y/noStaticElementInteractions: presentational toolbar wrapper; handlers only stop propagation so chip clicks don't reselect the bbox underneath
							<div
								className="-translate-x-1/2 absolute left-1/2 top-full z-[2] flex items-center gap-1 whitespace-nowrap rounded-md border border-border-subtle bg-bg-overlay/95 px-1.5 py-0.5 opacity-0 shadow-[var(--shadow-popover)] backdrop-blur transition-opacity group-hover:opacity-100 focus-within:opacity-100"
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
											palette={palette}
											size="sm"
										/>
										<div className="mx-0.5 h-4 w-px bg-border-subtle" />
									</>
								) : null}
								<button
									aria-label="Copy block text"
									className="flex h-7 w-7 items-center justify-center rounded-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
									onClick={(e) => {
										e.stopPropagation()
										const text = (block.caption ?? block.text ?? "").trim()
										if (text) void navigator.clipboard?.writeText(text)
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
			renderActions,
			selectedBlockId,
			showLayoutBoxes,
		],
	)

	return (
		<div
			className="relative bg-white shadow-md"
			ref={(el) => {
				wrapRef.current = el
				onPageRef?.(page, el)
			}}
			data-page-number={page}
			style={{
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
						lastRenderedScaleRef.current = scale
						setIsRendering(false)
						onPageCanvasReady?.(page)
					}}
					pageNumber={page}
					renderAnnotationLayer={false}
					// Keep this prop stable so toggling markup mode never tears
					// down react-pdf's text layer (which would force the canvas
					// to re-render). We disable text-selection separately via
					// CSS pointer-events on the overlay.
					renderTextLayer={false}
					scale={scale}
				/>
			) : (
				<div
					aria-hidden="true"
					className="h-full w-full rounded-[inherit] bg-white"
				/>
			)}
			{isPageRendered && pointDims && displayW > 0 && displayH > 0 && !isRendering ? (
				// Overlay sized to the real measured canvas dimensions
				// (canvasSize) so the SVG always covers exactly the canvas
				// — no underflow at the page bottom, no overflow.
				<div
					className="absolute left-0 top-0"
					style={{ width: `${displayW}px`, height: `${displayH}px` }}
				>
					<svg
						aria-label={`Reader annotations page ${page}`}
						className={`absolute inset-0 z-[1] ${annotationMode ? "pointer-events-auto" : "pointer-events-none"}`}
						height={displayH}
						ref={annotationSvgRef}
						viewBox={`0 0 ${displayW} ${displayH}`}
						width={displayW}
					>
						{/* pdf.js-style layering: a dedicated transparent backdrop
						    rect at the bottom captures "draw new" pointerdowns.
						    Existing annotation shapes paint above and take hit
						    priority because they sit higher in DOM order — no
						    stopPropagation race. The SVG element itself has no
						    pointer handlers. */}
						{annotationMode && onCreateReaderAnnotation ? (
							<rect
								aria-label={`Reader annotations canvas page ${page}`}
								fill="transparent"
								height={displayH}
								onClick={() => onSelectAnnotation?.(null)}
								onPointerCancel={() => void finishDraft(false)}
								onPointerDown={(event) => {
									if (event.button !== 0) return
									const point = getPagePointFromPointer(event.clientX, event.clientY)
									if (!point) return
									draftSessionRef.current = {
										pointerId: event.pointerId,
										start: point,
										current: point,
										points: [point],
									}
									setDraftBody(
										annotationTool === "highlight"
											? { rect: padHighlightRect(rectFromPoints(point, point)) }
											: annotationTool === "underline"
												? { from: point, to: point }
												: { points: [point] },
									)
									onSelectAnnotation?.(null)
									event.currentTarget.setPointerCapture(event.pointerId)
									event.preventDefault()
								}}
								onPointerMove={(event) => {
									const session = draftSessionRef.current
									if (!session || session.pointerId !== event.pointerId) return
									const point = getPagePointFromPointer(event.clientX, event.clientY)
									if (!point) return
									session.current = point
									if (annotationTool === "highlight") {
										setDraftBody({
											rect: padHighlightRect(rectFromPoints(session.start, point)),
										})
										return
									}
									if (annotationTool === "underline") {
										setDraftBody({ from: session.start, to: point })
										return
									}
									const nextPoints = [...session.points, point]
									session.points = nextPoints
									setDraftBody({ points: nextPoints })
								}}
								onPointerUp={(event) => {
									const session = draftSessionRef.current
									if (!session || session.pointerId !== event.pointerId) return
									event.currentTarget.releasePointerCapture(event.pointerId)
									void finishDraft(true)
								}}
								pointerEvents="all"
								width={displayW}
								x={0}
								y={0}
							/>
						) : null}
						{annotationNodes}
						{selectedAnnotation ? (
							<ReaderAnnotationSelectionOutline
								annotation={selectedAnnotation}
								H={displayH}
								W={displayW}
							/>
						) : null}
						{draftBody ? (
							<ReaderAnnotationDraft
								body={draftBody}
								color={annotationColor}
								H={displayH}
								kind={annotationTool}
								W={displayW}
							/>
						) : null}
					</svg>
					<div className={`absolute inset-0 z-[2] ${annotationMode ? "pointer-events-none" : ""}`}>
						{blocksLayer}
					</div>
					{selectedAnnotation ? (
						<ReaderAnnotationActionsPopover
							annotation={selectedAnnotation}
							H={displayH}
							onChangeColor={(color: string) => {
								void onUpdateReaderAnnotationColor?.(selectedAnnotation.id, color)
							}}
							onDelete={() => {
								void onDeleteReaderAnnotation?.(selectedAnnotation.id)
								onSelectAnnotation?.(null)
							}}
							W={displayW}
						/>
					) : null}
				</div>
			) : null}
		</div>
	)
})

PdfPageWithOverlay.displayName = "PdfPageWithOverlay"

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

function MarkupIcon() {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="14"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.7"
			viewBox="0 0 24 24"
			width="14"
		>
			<path d="M4 20h4l10-10-4-4L4 16v4Z" />
			<path d="m12 6 4 4" />
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
