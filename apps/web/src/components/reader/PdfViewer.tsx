import {
	memo,
	type MouseEvent,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import { RotateCw } from "lucide-react"
import { Document, Page } from "react-pdf"
import type { Block } from "@/api/hooks/blocks"
import type { ReaderAnnotation } from "@/api/hooks/reader-annotations"
import { usePaperPdfUrl } from "@/api/hooks/papers"
import { type PaletteEntry, paletteColorVars } from "@/lib/highlight-palette"
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

const MIN_SCALE = 0.5
const MAX_SCALE = 3
const PREVIEW_MIN_SCALE = 0.75
const PREVIEW_MAX_SCALE = 3.5
const PREVIEW_MIN_WIDTH_PX = 320
const PREVIEW_MAX_WIDTH_PX = 1480
const PREVIEW_VIEWPORT_MARGIN_PX = 48
// Popup outer width targets at least this fraction of the viewport so
// (a) small natural images still open at a readable size, and (b) the
// caption gets enough horizontal room to wrap into few lines instead
// of a tall paragraph.
const PREVIEW_TARGET_VIEWPORT_FRACTION = 0.78
const FIT_WIDTH_GUTTER_PX = 32
const BBOX_EPSILON = 0.02
const HIGHLIGHT_MIN_H = 0.018
const HIGHLIGHT_MIN_W = 0.01
const VIRTUAL_WINDOW_RADIUS = 2
const DEFAULT_PAGE_ASPECT_RATIO = 11 / 8.5

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
		if (!scrollToPage(requestedPage, requestedBlockY)) return
		handledJumpRequestRef.current = requestKey
	}, [numPages, pageCanvasVersion, pageRefsVersion, renderedPages, requestedPageNonce, requestedPage, requestedBlockY, scrollToPage])

	useEffect(() => {
		const container = scrollContainerRef.current
		if (!container || numPages == null) return
		const measureActivePageAnchor = () => {
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
					let bestPage = activePageRef.current
					let bestRatio = -1
					for (const [page, ratio] of intersectionRatiosRef.current.entries()) {
						if (ratio > bestRatio) {
							bestRatio = ratio
							bestPage = page
						}
					}
					if (bestPage !== activePageRef.current) {
						activePageRef.current = bestPage
						setCurrentPage(bestPage)
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
			let bestPage = 1
			let bestRatio = 0
			const containerRect = container.getBoundingClientRect()
			for (const [page, el] of pageRefs.current.entries()) {
				const rect = el.getBoundingClientRect()
				const visibleTop = Math.max(rect.top, containerRect.top)
				const visibleBottom = Math.min(rect.bottom, containerRect.bottom)
				const visibleHeight = Math.max(0, visibleBottom - visibleTop)
				const ratio = visibleHeight / Math.max(rect.height, 1)
				if (ratio > bestRatio) {
					bestRatio = ratio
					bestPage = page
				}
			}
			if (bestPage !== activePageRef.current) {
				activePageRef.current = bestPage
				setCurrentPage(bestPage)
			}
			measureActivePageAnchor()
		}

		fallbackHandleScroll()
		container.addEventListener("scroll", fallbackHandleScroll, { passive: true })
		return () => container.removeEventListener("scroll", fallbackHandleScroll)
	}, [numPages, onViewportAnchorChange])

	useEffect(() => {
		const container = scrollContainerRef.current
		if (!container) return
		const handleScroll = () => {
			if (scrollRafRef.current != null) return
			scrollRafRef.current = window.requestAnimationFrame(() => {
				scrollRafRef.current = null
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
	}, [onViewportAnchorChange])

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

function SelectedBlockPreview({
	block,
	onDismiss,
}: {
	block: Block
	onDismiss?: () => void
}) {
	const [popupScale, setPopupScale] = useState(1)
	const [rotation, setRotation] = useState(0)
	const [offset, setOffset] = useState({ x: 0, y: 0 })
	const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null)
	const [viewportSize, setViewportSize] = useState<{ width: number; height: number } | null>(null)
	const interactionRef = useRef<
		| {
				mode: "drag"
				originX: number
				originY: number
				startX: number
				startY: number
		  }
		| {
				mode: "resize"
				originScale: number
				startX: number
				startY: number
				axis: "x" | "y" | "xy"
		  }
		| null
	>(null)
	const summary = (block.caption ?? block.text ?? "").trim()
	const isQuarterTurn = Math.abs(rotation % 180) === 90
	const previewBaseSize = useMemo(() => {
		const fallbackCaption = 1024
		const fallbackImage = { width: 1024, height: 560 }
		if (!naturalSize || !viewportSize) {
			return {
				captionWidth: fallbackCaption,
				imageWidth: fallbackImage.width,
				imageHeight: fallbackImage.height,
			}
		}
		const { width: nw, height: nh } = naturalSize

		const availableWidth = Math.max(
			PREVIEW_MIN_WIDTH_PX,
			viewportSize.width - PREVIEW_VIEWPORT_MARGIN_PX * 2,
		)
		const availableHeight = Math.max(
			240,
			viewportSize.height - PREVIEW_VIEWPORT_MARGIN_PX * 2,
		)

		// Caption dock width: rotation-invariant. Driven by the un-rotated
		// natural width plus a viewport floor, so rotating never reflows
		// the caption.
		const targetWidth = Math.max(nw, viewportSize.width * PREVIEW_TARGET_VIEWPORT_FRACTION)
		const captionWidth = Math.max(
			PREVIEW_MIN_WIDTH_PX,
			Math.round(Math.min(targetWidth, availableWidth, PREVIEW_MAX_WIDTH_PX)),
		)

		// Image visual dimensions (post-rotation). Card hugs these so
		// there's no leftover gutter making the chrome perceptible.
		const visualAspect = isQuarterTurn ? nw / nh : nh / nw // visualH / visualW
		const captionAllowance = summary ? Math.min(240, availableHeight * 0.4) : 0
		const maxImageHeight = Math.max(160, availableHeight - captionAllowance)
		// Cap image's visual width at the caption width too, so wide
		// figures don't make the image card visually broader than the
		// caption dock — keeps the pair feeling aligned.
		const maxImageWidth = Math.min(captionWidth, availableWidth)
		let imageWidth = maxImageWidth
		let imageHeight = imageWidth * visualAspect
		if (imageHeight > maxImageHeight) {
			imageHeight = maxImageHeight
			imageWidth = imageHeight / visualAspect
		}
		return {
			captionWidth,
			imageWidth: Math.round(imageWidth),
			imageHeight: Math.round(imageHeight),
		}
	}, [isQuarterTurn, naturalSize, summary, viewportSize])

	const endDrag = useCallback(() => {
		interactionRef.current = null
	}, [])

	const handlePointerMove = useCallback((event: PointerEvent) => {
		const interaction = interactionRef.current
		if (!interaction) return
		if (interaction.mode === "drag") {
			setOffset({
				x: interaction.originX + (event.clientX - interaction.startX),
				y: interaction.originY + (event.clientY - interaction.startY),
			})
			return
		}
		const deltaX = event.clientX - interaction.startX
		const deltaY = event.clientY - interaction.startY
		const delta =
			interaction.axis === "x"
				? deltaX
				: interaction.axis === "y"
					? deltaY
					: Math.max(deltaX, deltaY)
		setPopupScale(clampPreviewScale(interaction.originScale + delta / 420))
	}, [])

	useEffect(() => {
		if (typeof window === "undefined") return
		window.addEventListener("pointermove", handlePointerMove)
		window.addEventListener("pointerup", endDrag)
		window.addEventListener("pointercancel", endDrag)
		return () => {
			window.removeEventListener("pointermove", handlePointerMove)
			window.removeEventListener("pointerup", endDrag)
			window.removeEventListener("pointercancel", endDrag)
		}
	}, [endDrag, handlePointerMove])

	useEffect(() => {
		if (typeof window === "undefined") return
		const syncViewport = () => {
			setViewportSize({ width: window.innerWidth, height: window.innerHeight })
		}
		syncViewport()
		window.addEventListener("resize", syncViewport)
		return () => window.removeEventListener("resize", syncViewport)
	}, [])

	useEffect(() => {
		if (typeof window === "undefined") return
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault()
				onDismiss?.()
			}
		}
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [onDismiss])

	const handlePointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			event.preventDefault()
			interactionRef.current = {
				mode: "drag",
				originX: offset.x,
				originY: offset.y,
				startX: event.clientX,
				startY: event.clientY,
			}
		},
		[offset.x, offset.y],
	)

	const handleResizePointerDown = useCallback(
		(axis: "x" | "y" | "xy") => (event: ReactPointerEvent<HTMLButtonElement>) => {
			event.preventDefault()
			event.stopPropagation()
			interactionRef.current = {
				mode: "resize",
				originScale: popupScale,
				startX: event.clientX,
				startY: event.clientY,
				axis,
			}
		},
		[popupScale],
	)

	return (
		<div className="pointer-events-none absolute inset-0 z-[5] p-6">
			<button
				aria-label="Close focused preview"
				className="pointer-events-auto absolute inset-0 bg-black/18 backdrop-blur-[1px]"
				onClick={() => onDismiss?.()}
				type="button"
			/>
			{/* Image card: absolutely centered, draggable. Caption dock
			    (rendered as a sibling further down) is pinned to the
			    viewport bottom independently — rotating or zooming the
			    image leaves the caption put. */}
			<div
				className="pointer-events-auto absolute left-1/2 top-1/2"
				style={{
					transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
				}}
			>
				<div
					className="relative overflow-hidden rounded-2xl border border-border-default bg-bg-overlay/97 shadow-[var(--shadow-popover)] backdrop-blur"
					style={{ width: `${previewBaseSize.imageWidth * popupScale}px` }}
				>
					<div
						className="absolute inset-x-0 top-0 z-[1] h-14 cursor-grab active:cursor-grabbing"
						onPointerDown={handlePointerDown}
					/>
					<div
						className="group relative flex items-center justify-center overflow-hidden bg-bg-secondary"
						style={{ height: `${previewBaseSize.imageHeight * popupScale}px` }}
					>
						<div
							className="shrink-0 flex items-center justify-center"
							style={{
								width: isQuarterTurn
									? `${previewBaseSize.imageHeight * popupScale}px`
									: `${previewBaseSize.imageWidth * popupScale}px`,
								height: isQuarterTurn
									? `${previewBaseSize.imageWidth * popupScale}px`
									: `${previewBaseSize.imageHeight * popupScale}px`,
							}}
						>
							<img
								alt={block.caption ?? `${block.type} preview`}
								className="h-full w-full object-contain transition-transform"
								onLoad={(event) => {
									const image = event.currentTarget
									setNaturalSize({
										width: image.naturalWidth,
										height: image.naturalHeight,
									})
								}}
								src={block.imageUrl ?? undefined}
								style={{ transform: `rotate(${rotation}deg)` }}
							/>
						</div>
					</div>
					<button
						aria-label="Resize focused preview horizontally"
						className="absolute right-0 top-12 hidden h-[calc(100%-3rem)] w-3 cursor-ew-resize bg-transparent md:block"
						onPointerDown={handleResizePointerDown("x")}
						type="button"
					/>
					<button
						aria-label="Resize focused preview vertically"
						className="absolute bottom-0 left-0 hidden h-3 w-[calc(100%-3rem)] cursor-ns-resize bg-transparent md:block"
						onPointerDown={handleResizePointerDown("y")}
						type="button"
					/>
					<button
						aria-label="Resize focused preview"
						className="absolute bottom-0 right-0 h-6 w-6 cursor-nwse-resize bg-transparent"
						onPointerDown={handleResizePointerDown("xy")}
						type="button"
					>
						<span className="absolute bottom-1 right-1 h-3 w-3 border-b-2 border-r-2 border-border-default/80" />
					</button>
				</div>
			</div>
			{/* Caption dock: pinned to the bottom of the popup overlay,
			    centered horizontally. Independent of the image card —
			    rotating or dragging the image never moves it. */}
			<div
				className="pointer-events-auto absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-border-subtle/70 bg-bg-overlay/70 px-5 py-3 shadow-[var(--shadow-popover)] backdrop-blur-md"
				style={{
					width: `${previewBaseSize.captionWidth}px`,
					maxWidth: "calc(100vw - 96px)",
				}}
			>
				{summary ? (
					<p className="flex-1 text-sm leading-6 text-text-primary/90">{summary}</p>
				) : (
					<span className="flex-1" />
				)}
				<button
					aria-label="Rotate preview"
					className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200/80 bg-white/96 text-slate-900 shadow-[0_4px_10px_rgba(15,23,42,0.12)] transition-transform hover:scale-110"
					onClick={(e) => {
						e.stopPropagation()
						setRotation((value) => (value + 90) % 360)
					}}
					type="button"
				>
					<RotateCw aria-hidden="true" size={18} strokeWidth={2.4} />
				</button>
			</div>
		</div>
	)
}

function clamp(scale: number) {
	return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))
}

function clampPreviewScale(scale: number) {
	return Math.max(PREVIEW_MIN_SCALE, Math.min(PREVIEW_MAX_SCALE, Number(scale.toFixed(2))))
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
				const fill = highlightColor ? paletteColorVars(palette ?? [], highlightColor) : null
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
											background: `color-mix(in oklch, ${fill.bg} 38%, transparent)`,
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
												background: fill.bg,
												color: fill.text,
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

function ReaderAnnotationShape({
	annotation,
	H,
	onSelect,
	W,
}: {
	annotation: ReaderAnnotation
	H: number
	onSelect?: (annotationId: string | null) => void
	W: number
}) {
	// SVG viewBox is "0 0 W H" (pixel coordinates). 0..1-stored values
	// are scaled by W or H so 1 SVG unit == 1 CSS pixel — strokes render
	// at consistent pixel widths regardless of line direction.
	const stopAndSelect = {
		onClick: (event: React.MouseEvent) => event.stopPropagation(),
		onPointerDown: (event: React.PointerEvent) => {
			event.stopPropagation()
			event.preventDefault()
			onSelect?.(annotation.id)
		},
	}
	if (annotation.kind === "highlight" && "rect" in annotation.body) {
		const { rect } = annotation.body
		return (
			<rect
				fill={annotation.color}
				fillOpacity={0.28}
				height={rect.h * H}
				rx={3}
				ry={3}
				width={rect.w * W}
				x={rect.x * W}
				y={rect.y * H}
				{...stopAndSelect}
			/>
		)
	}
	if (annotation.kind === "underline" && "from" in annotation.body && "to" in annotation.body) {
		const { from, to } = annotation.body
		return (
			<>
				<line
					pointerEvents="none"
					stroke={annotation.color}
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeOpacity={0.95}
					strokeWidth={3}
					x1={from.x * W}
					x2={to.x * W}
					y1={from.y * H}
					y2={to.y * H}
				/>
				<line
					{...stopAndSelect}
					pointerEvents="stroke"
					stroke="transparent"
					strokeWidth={16}
					x1={from.x * W}
					x2={to.x * W}
					y1={from.y * H}
					y2={to.y * H}
				/>
			</>
		)
	}
	if (annotation.kind === "ink" && "points" in annotation.body) {
		const d = pointsToScaledPath(annotation.body.points, W, H)
		return (
			<>
				<path
					d={d}
					fill="none"
					pointerEvents="none"
					stroke={annotation.color}
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeOpacity={0.95}
					strokeWidth={3.5}
				/>
				<path
					{...stopAndSelect}
					d={d}
					fill="none"
					pointerEvents="stroke"
					stroke="transparent"
					strokeWidth={16}
				/>
			</>
		)
	}
	return null
}

function pointsToScaledPath(points: ReaderAnnotationPoint[], W: number, H: number) {
	if (points.length === 0) return ""
	return points
		.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x * W} ${p.y * H}`)
		.join(" ")
}

function annotationBoundingBox(annotation: ReaderAnnotation) {
	if (annotation.kind === "highlight" && "rect" in annotation.body) {
		return annotation.body.rect
	}
	if (annotation.kind === "underline" && "from" in annotation.body && "to" in annotation.body) {
		const { from, to } = annotation.body
		return {
			x: Math.min(from.x, to.x),
			y: Math.min(from.y, to.y),
			w: Math.abs(to.x - from.x),
			h: Math.abs(to.y - from.y),
		}
	}
	if (annotation.kind === "ink" && "points" in annotation.body && annotation.body.points.length) {
		const xs = annotation.body.points.map((p) => p.x)
		const ys = annotation.body.points.map((p) => p.y)
		const x = Math.min(...xs)
		const y = Math.min(...ys)
		return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
	}
	return null
}

function ReaderAnnotationSelectionOutline({
	annotation,
	H,
	W,
}: {
	annotation: ReaderAnnotation
	H: number
	W: number
}) {
	const bbox = annotationBoundingBox(annotation)
	if (!bbox) return null
	const padX = 0.006
	const padY = 0.008
	const x = Math.max(0, bbox.x - padX) * W
	const y = Math.max(0, bbox.y - padY) * H
	const w = Math.min(1 - Math.max(0, bbox.x - padX), bbox.w + padX * 2) * W
	const h = Math.min(1 - Math.max(0, bbox.y - padY), bbox.h + padY * 2) * H
	return (
		<rect
			fill="none"
			height={h}
			pointerEvents="none"
			rx={3}
			ry={3}
			stroke="rgba(15, 23, 42, 0.55)"
			strokeDasharray="6 4"
			strokeWidth={1.5}
			width={w}
			x={x}
			y={y}
		/>
	)
}

function FloatingMarkupPalette({
	color,
	onChangeColor,
	onChangeTool,
	onClose,
	tool,
}: {
	color: string
	onChangeColor: (color: string) => void
	onChangeTool: (tool: ReaderAnnotationTool) => void
	onClose: () => void
	tool: ReaderAnnotationTool
}) {
	// Position is local to the PdfViewer's relative root. Initial position
	// is top-center of the PDF area; user can drag the handle to relocate.
	const [pos, setPos] = useState<{ x: number; y: number }>({ x: 24, y: 16 })
	const dragRef = useRef<{ originX: number; originY: number; startX: number; startY: number } | null>(
		null,
	)

	const onPointerMove = useCallback((event: PointerEvent) => {
		const drag = dragRef.current
		if (!drag) return
		setPos({
			x: drag.originX + (event.clientX - drag.startX),
			y: drag.originY + (event.clientY - drag.startY),
		})
	}, [])

	const endDrag = useCallback(() => {
		dragRef.current = null
	}, [])

	useEffect(() => {
		if (typeof window === "undefined") return
		window.addEventListener("pointermove", onPointerMove)
		window.addEventListener("pointerup", endDrag)
		window.addEventListener("pointercancel", endDrag)
		return () => {
			window.removeEventListener("pointermove", onPointerMove)
			window.removeEventListener("pointerup", endDrag)
			window.removeEventListener("pointercancel", endDrag)
		}
	}, [endDrag, onPointerMove])

	const onHandlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		event.preventDefault()
		dragRef.current = {
			originX: pos.x,
			originY: pos.y,
			startX: event.clientX,
			startY: event.clientY,
		}
	}

	return (
		<div
			className="absolute z-[20] flex select-none items-center gap-1 rounded-lg border border-border-subtle bg-bg-overlay/95 px-1.5 py-1 shadow-[var(--shadow-popover)] backdrop-blur"
			style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
		>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: drag handle */}
			<div
				className="flex h-7 w-5 cursor-grab items-center justify-center text-text-tertiary hover:text-text-secondary active:cursor-grabbing"
				onPointerDown={onHandlePointerDown}
				title="Drag to move"
			>
				<DragHandleIcon />
			</div>
			<div className="mx-0.5 h-4 w-px bg-border-subtle" />
			<AnnotationToolButton
				active={tool === "highlight"}
				ariaLabel="Highlight tool"
				icon={<HighlightToolIcon />}
				onClick={() => onChangeTool("highlight")}
			/>
			<AnnotationToolButton
				active={tool === "underline"}
				ariaLabel="Underline tool"
				icon={<UnderlineToolIcon />}
				onClick={() => onChangeTool("underline")}
			/>
			<AnnotationToolButton
				active={tool === "ink"}
				ariaLabel="Freehand tool"
				icon={<InkToolIcon />}
				onClick={() => onChangeTool("ink")}
			/>
			<div className="mx-1 h-4 w-px bg-border-subtle" />
			{READER_ANNOTATION_COLORS.map((entry) => (
				<button
					aria-label={`${entry.label} markup color`}
					aria-pressed={color === entry.value}
					className={`h-5 w-5 rounded-full border transition-transform hover:scale-110 ${
						color === entry.value
							? "border-text-primary ring-2 ring-accent-600/35"
							: "border-border-default"
					}`}
					key={entry.value}
					onClick={() => onChangeColor(entry.value)}
					style={{ backgroundColor: entry.value }}
					type="button"
				/>
			))}
			<div className="mx-1 h-4 w-px bg-border-subtle" />
			<button
				aria-label="Exit markup mode"
				className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover"
				onClick={onClose}
				title="Close markup palette"
				type="button"
			>
				<CloseIcon />
			</button>
		</div>
	)
}

function DragHandleIcon() {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="14"
			stroke="currentColor"
			strokeLinecap="round"
			strokeWidth="1.6"
			viewBox="0 0 24 24"
			width="14"
		>
			<circle cx="9" cy="6" r="0.6" fill="currentColor" />
			<circle cx="9" cy="12" r="0.6" fill="currentColor" />
			<circle cx="9" cy="18" r="0.6" fill="currentColor" />
			<circle cx="15" cy="6" r="0.6" fill="currentColor" />
			<circle cx="15" cy="12" r="0.6" fill="currentColor" />
			<circle cx="15" cy="18" r="0.6" fill="currentColor" />
		</svg>
	)
}

function CloseIcon() {
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
			<path d="m6 6 12 12M18 6 6 18" />
		</svg>
	)
}

function ReaderAnnotationActionsPopover({
	annotation,
	H,
	onChangeColor,
	onDelete,
	W,
}: {
	annotation: ReaderAnnotation
	H: number
	onChangeColor: (color: string) => void
	onDelete: () => void
	W: number
}) {
	const bbox = annotationBoundingBox(annotation)
	if (!bbox) return null
	// Anchor above the bbox (or below if too close to the page top), centered.
	const POPOVER_HEIGHT = 36
	const GAP = 8
	const centerX = (bbox.x + bbox.w / 2) * W
	const topAbove = bbox.y * H - POPOVER_HEIGHT - GAP
	const showBelow = topAbove < 0
	const top = showBelow ? (bbox.y + bbox.h) * H + GAP : topAbove
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: presentational; clicks within shouldn't bubble to the SVG and clear selection
		<div
			className="absolute z-[3] -translate-x-1/2 flex items-center gap-1 whitespace-nowrap rounded-md border border-border-subtle bg-bg-overlay/95 px-1.5 py-1 shadow-[var(--shadow-popover)] backdrop-blur"
			onClick={(e) => e.stopPropagation()}
			onMouseDown={(e) => e.stopPropagation()}
			onPointerDown={(e) => e.stopPropagation()}
			style={{ left: `${centerX}px`, top: `${top}px` }}
		>
			{READER_ANNOTATION_COLORS.map((entry) => (
				<button
					aria-label={`Set ${entry.label}`}
					aria-pressed={annotation.color === entry.value}
					className={`h-5 w-5 rounded-full border transition-transform hover:scale-110 ${
						annotation.color === entry.value
							? "border-text-primary ring-2 ring-accent-600/35"
							: "border-border-default"
					}`}
					key={entry.value}
					onClick={() => {
						if (annotation.color !== entry.value) onChangeColor(entry.value)
					}}
					style={{ backgroundColor: entry.value }}
					type="button"
				/>
			))}
			<div className="mx-1 h-4 w-px bg-border-subtle" />
			<button
				aria-label="Delete annotation"
				className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-error"
				onClick={onDelete}
				title="Delete"
				type="button"
			>
				<TrashIcon />
			</button>
		</div>
	)
}

function ReaderAnnotationDraft({
	body,
	color,
	H,
	kind,
	W,
}: {
	body: ReaderAnnotationBody
	color: string
	H: number
	kind: ReaderAnnotationTool
	W: number
}) {
	if (kind === "highlight" && "rect" in body) {
		return (
			<rect
				fill={color}
				fillOpacity={0.22}
				height={body.rect.h * H}
				rx={3}
				ry={3}
				stroke={color}
				strokeDasharray="8 5"
				strokeOpacity={0.65}
				strokeWidth={1.2}
				width={body.rect.w * W}
				x={body.rect.x * W}
				y={body.rect.y * H}
			/>
		)
	}
	if (kind === "underline" && "from" in body && "to" in body) {
		return (
			<line
				stroke={color}
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeOpacity={0.8}
				strokeWidth={3}
				x1={body.from.x * W}
				x2={body.to.x * W}
				y1={body.from.y * H}
				y2={body.to.y * H}
			/>
		)
	}
	if (kind === "ink" && "points" in body) {
		return (
			<path
				d={pointsToScaledPath(body.points, W, H)}
				fill="none"
				stroke={color}
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeOpacity={0.8}
				strokeWidth={3.5}
			/>
		)
	}
	return null
}

function bodyHasNoVisibleExtent(body: ReaderAnnotationBody) {
	// Reject only true zero-extent shapes (accidental clicks). Highlights are
	// intentionally thin bands; we no longer require a vertical drag.
	if ("rect" in body) return body.rect.w < 0.002 && body.rect.h < 0.002
	if ("from" in body && "to" in body) return distanceBetweenPoints(body.from, body.to) < 0.005
	if ("points" in body) {
		if (body.points.length < 2) return true
		return body.points.every((point) => distanceBetweenPoints(point, body.points[0]!) < 0.005)
	}
	return true
}

// Highlights track a horizontal text drag, so the raw bbox is often
// near-zero in one axis. Inflate to a visible band, clamped to the page.
// Already-large rects pass through unchanged so we don't introduce
// floating-point drift on a normal drag.
function padHighlightRect(rect: { x: number; y: number; w: number; h: number }) {
	if (rect.w >= HIGHLIGHT_MIN_W && rect.h >= HIGHLIGHT_MIN_H) return rect
	const w = Math.max(rect.w, HIGHLIGHT_MIN_W)
	const h = Math.max(rect.h, HIGHLIGHT_MIN_H)
	const cx = rect.x + rect.w / 2
	const cy = rect.y + rect.h / 2
	const x = Math.max(0, Math.min(1 - w, cx - w / 2))
	const y = Math.max(0, Math.min(1 - h, cy - h / 2))
	return { x, y, w, h }
}

function AnnotationToolButton({
	active,
	ariaLabel,
	icon,
	onClick,
}: {
	active: boolean
	ariaLabel: string
	icon: React.ReactNode
	onClick: () => void
}) {
	return (
		<button
			aria-label={ariaLabel}
			aria-pressed={active}
			className={`flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
				active
					? "border-accent-600 bg-accent-600 text-text-inverse"
					: "border-transparent text-text-secondary hover:bg-surface-hover"
			}`}
			onClick={onClick}
			type="button"
		>
			{icon}
		</button>
	)
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

function TrashIcon() {
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
			<path d="M3 6h18" />
			<path d="M8 6V4h8v2" />
			<path d="M19 6l-1 14H6L5 6" />
			<path d="M10 11v6M14 11v6" />
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

function HighlightToolIcon() {
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
			<path d="m6 15 5-5 4 4-5 5H6v-4Z" />
			<path d="M14 7 17 10" />
			<path d="M4 20h16" />
		</svg>
	)
}

function UnderlineToolIcon() {
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
			<path d="M7 5v6a5 5 0 0 0 10 0V5" />
			<path d="M5 20h14" />
		</svg>
	)
}

function InkToolIcon() {
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
			<path d="M3 14c3-4 5-4 8 0s5 4 10-2" />
			<path d="M3 19c2-2 4-2 6 0" />
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
