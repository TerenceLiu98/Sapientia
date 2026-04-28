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
	pointsToSvgPath,
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
const PREVIEW_MAX_WIDTH_PX = 1280
const PREVIEW_VIEWPORT_MARGIN_PX = 48
const PREVIEW_SUMMARY_ALLOWANCE_PX = 132
const FIT_WIDTH_GUTTER_PX = 32
const BBOX_EPSILON = 0.02
const HIGHLIGHT_MIN_H = 0.018
const HIGHLIGHT_MIN_W = 0.01

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
	hoveredBlockId?: string | null
	selectedBlockId?: string | null
	onHoverBlock?: (blockId: string | null) => void
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
	hoveredBlockId,
	selectedBlockId,
	onHoverBlock,
	onSelectBlock,
	onClearSelectedBlock,
	onSetHighlight,
	onClearHighlight,
	readerAnnotations,
	onCreateReaderAnnotation,
	onDeleteReaderAnnotation,
	renderActions,
}: PdfViewerProps) {
	const { data, isLoading, isError, refetch } = usePaperPdfUrl(paperId)
	const [numPages, setNumPages] = useState<number | null>(null)
	const [currentPage, setCurrentPage] = useState(1)
	const [scale, setScale] = useState(1.0)
	const [scaleMode, setScaleMode] = useState<"fit" | "manual">("fit")
	const [showLayoutBoxes, setShowLayoutBoxes] = useState(false)
	const [basePageWidth, setBasePageWidth] = useState<number | null>(null)
	const [renderError, setRenderError] = useState<string | null>(null)
	const [annotationMode, setAnnotationMode] = useState(false)
	const [annotationTool, setAnnotationTool] = useState<ReaderAnnotationTool>("highlight")
	const [annotationColor, setAnnotationColor] = useState(READER_ANNOTATION_COLORS[0]?.value ?? "#f4c84f")
	const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null)
	const viewerRef = useRef<HTMLDivElement>(null)
	const scrollContainerRef = useRef<HTMLDivElement>(null)
	const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())

	useEffect(() => {
		void paperId
		setNumPages(null)
		setCurrentPage(1)
		setScale(1)
		setScaleMode("fit")
		setShowLayoutBoxes(false)
		setBasePageWidth(null)
		setRenderError(null)
		setAnnotationMode(false)
		setAnnotationTool("highlight")
		setAnnotationColor(READER_ANNOTATION_COLORS[0]?.value ?? "#f4c84f")
		setSelectedAnnotationId(null)
		pageRefs.current.clear()
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

	const scrollToPage = useCallback((page: number, blockYRatio?: number) => {
		const el = pageRefs.current.get(page)
		const container = scrollContainerRef.current
		if (!el || !container) return
		if (typeof blockYRatio === "number") {
			const elRect = el.getBoundingClientRect()
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
			return
		}
		el.scrollIntoView({ behavior: "smooth", block: "start" })
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
		void requestedPageNonce
		if (requestedPage == null) return
		scrollToPage(requestedPage, requestedBlockY)
	}, [requestedPageNonce, requestedPage, requestedBlockY, scrollToPage])

	useEffect(() => {
		const container = scrollContainerRef.current
		if (!container || numPages == null) return

		const handleScroll = () => {
			let activePage = 1
			let bestRatio = 0
			let activePageTop = 0
			let activePageHeight = 1
			const containerRect = container.getBoundingClientRect()
			for (const [page, el] of pageRefs.current.entries()) {
				const rect = el.getBoundingClientRect()
				const visibleTop = Math.max(rect.top, containerRect.top)
				const visibleBottom = Math.min(rect.bottom, containerRect.bottom)
				const visibleHeight = Math.max(0, visibleBottom - visibleTop)
				const ratio = visibleHeight / Math.max(rect.height, 1)
				if (ratio > bestRatio) {
					bestRatio = ratio
					activePage = page
					activePageTop = rect.top
					activePageHeight = rect.height
				}
			}
			setCurrentPage(activePage)
			if (activePageHeight > 0) {
				const viewportMidY = containerRect.top + container.clientHeight / 2
				const yRatio = clampUnit((viewportMidY - activePageTop) / activePageHeight)
				onViewportAnchorChange?.(activePage, yRatio)
			}
		}

		handleScroll()
		container.addEventListener("scroll", handleScroll, { passive: true })
		return () => container.removeEventListener("scroll", handleScroll)
	}, [numPages, onViewportAnchorChange])

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
		const observer = new ResizeObserver(() => fitToWidth())
		observer.observe(scrollContainerRef.current)
		return () => observer.disconnect()
	}, [fitToWidth, scaleMode])

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
				<div className="flex items-center gap-1">
					{canAnnotate ? (
						<>
							<button
								aria-pressed={annotationMode}
								className={`mr-2 flex h-8 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors ${
									annotationMode
										? "border-accent-600 bg-accent-600 text-text-inverse hover:bg-accent-700"
										: "border-border-default text-text-secondary hover:bg-surface-hover"
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
							{annotationMode ? (
								<>
									<div className="mr-2 flex items-center gap-1 rounded-md border border-border-subtle bg-bg-overlay/80 px-1.5 py-1">
										<AnnotationToolButton
											active={annotationTool === "highlight"}
											ariaLabel="Highlight tool"
											icon={<HighlightToolIcon />}
											onClick={() => setAnnotationTool("highlight")}
										/>
										<AnnotationToolButton
											active={annotationTool === "underline"}
											ariaLabel="Underline tool"
											icon={<UnderlineToolIcon />}
											onClick={() => setAnnotationTool("underline")}
										/>
										<AnnotationToolButton
											active={annotationTool === "ink"}
											ariaLabel="Freehand tool"
											icon={<InkToolIcon />}
											onClick={() => setAnnotationTool("ink")}
										/>
										<div className="mx-1 h-4 w-px bg-border-subtle" />
										{READER_ANNOTATION_COLORS.map((entry) => (
											<button
												aria-label={`${entry.label} markup color`}
												aria-pressed={annotationColor === entry.value}
												className={`h-5 w-5 rounded-full border transition-transform hover:scale-105 ${
													annotationColor === entry.value
														? "border-text-primary ring-2 ring-accent-600/35"
														: "border-border-default"
												}`}
												key={entry.value}
												onClick={() => setAnnotationColor(entry.value)}
												style={{ backgroundColor: entry.value }}
												type="button"
											/>
										))}
										<div className="mx-1 h-4 w-px bg-border-subtle" />
										<button
											aria-label="Delete selected annotation"
											className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
											disabled={!selectedAnnotationId}
											onClick={() => {
												if (!selectedAnnotationId) return
												void onDeleteReaderAnnotation?.(selectedAnnotationId)
												setSelectedAnnotationId(null)
											}}
											title="Delete selected annotation"
											type="button"
										>
											<TrashIcon />
										</button>
									</div>
								</>
							) : null}
						</>
					) : null}
					<button
						aria-pressed={showLayoutBoxes}
						className={`mr-2 flex h-8 w-8 items-center justify-center rounded-md border transition-colors ${
							showLayoutBoxes
								? "border-accent-600 bg-accent-600 text-text-inverse hover:bg-accent-700"
								: "border-border-default text-text-secondary hover:bg-surface-hover"
						}`}
						onClick={() => setShowLayoutBoxes((value) => !value)}
						title={showLayoutBoxes ? "Hide layout boxes" : "Show layout boxes"}
						type="button"
					>
						<LayoutBoxesIcon />
					</button>
					<button
						aria-label="Zoom out"
						className="h-7 w-7 rounded-md text-sm hover:bg-surface-hover"
						onClick={() => {
							setScaleMode("manual")
							setScale((value) => clamp(value - 0.1))
						}}
						type="button"
					>
						−
					</button>
					<span className="w-12 text-center text-sm text-text-secondary">
						{Math.round(scale * 100)}%
					</span>
					<button
						aria-label="Zoom in"
						className="h-7 w-7 rounded-md text-sm hover:bg-surface-hover"
						onClick={() => {
							setScaleMode("manual")
							setScale((value) => clamp(value + 0.1))
						}}
						type="button"
					>
						+
					</button>
					<button
						aria-label="Fit width"
						className="ml-2 h-7 rounded-md px-2 text-xs hover:bg-surface-hover"
						onClick={() => {
							setScaleMode("fit")
							fitToWidth()
						}}
						type="button"
					>
						Fit
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
									hoveredBlockId={hoveredBlockId}
									key={page}
									onClearHighlight={onClearHighlight}
									onCreateReaderAnnotation={onCreateReaderAnnotation}
									onHoverBlock={onHoverBlock}
									onPointDims={(dims) => setBasePageWidth((current) => current ?? dims.w)}
									onSelectAnnotation={setSelectedAnnotationId}
									onSelectBlock={onSelectBlock}
									onSetHighlight={onSetHighlight}
									page={page}
									pageRefs={pageRefs}
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
		const fallbackWidth = 896
		const fallbackHeight = 560
		if (!naturalSize || !viewportSize) {
			return { width: fallbackWidth, imageHeight: fallbackHeight }
		}
		const effectiveWidth = isQuarterTurn ? naturalSize.height : naturalSize.width
		const effectiveHeight = isQuarterTurn ? naturalSize.width : naturalSize.height

		const availableWidth = Math.max(
			PREVIEW_MIN_WIDTH_PX,
			viewportSize.width - PREVIEW_VIEWPORT_MARGIN_PX * 2,
		)
		const availableHeight = Math.max(
			240,
			viewportSize.height -
				PREVIEW_VIEWPORT_MARGIN_PX * 2 -
				(summary ? PREVIEW_SUMMARY_ALLOWANCE_PX : 0),
		)
		const widthByHeight = (availableHeight * effectiveWidth) / effectiveHeight
		const fittedWidth = Math.min(
			effectiveWidth,
			PREVIEW_MAX_WIDTH_PX,
			availableWidth,
			widthByHeight,
		)
		const width = Math.max(PREVIEW_MIN_WIDTH_PX, Math.round(fittedWidth))
		const imageHeight = Math.round((width * effectiveHeight) / effectiveWidth)
		return { width, imageHeight }
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
		<div
			className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center p-6"
		>
			<button
				aria-label="Close focused preview"
				className="pointer-events-auto absolute inset-0 bg-black/18 backdrop-blur-[1px]"
				onClick={() => onDismiss?.()}
				type="button"
			/>
			<div
				className="pointer-events-auto relative overflow-hidden rounded-2xl border border-border-default bg-bg-overlay/97 shadow-[var(--shadow-popover)] backdrop-blur"
				style={{
					width: `${previewBaseSize.width}px`,
					transform: `translate(${offset.x}px, ${offset.y}px) scale(${popupScale})`,
				}}
			>
				<div
					className="absolute inset-x-0 top-0 z-[1] h-14 cursor-grab active:cursor-grabbing"
					onPointerDown={handlePointerDown}
				/>
				<div className="relative">
					<div
						className="group relative flex min-h-56 items-center justify-center overflow-hidden bg-bg-secondary"
						style={{ height: `${previewBaseSize.imageHeight}px` }}
					>
						<div
							className="shrink-0 flex items-center justify-center"
							style={{
								width: isQuarterTurn
									? `${previewBaseSize.imageHeight}px`
									: `${previewBaseSize.width}px`,
								height: isQuarterTurn
									? `${previewBaseSize.width}px`
									: `${previewBaseSize.imageHeight}px`,
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
						<button
							aria-label="Rotate preview"
							className="absolute right-4 top-4 z-[2] flex h-12 w-12 items-center justify-center rounded-full border border-transparent bg-white/0 text-slate-900/0 opacity-0 shadow-[0_8px_18px_rgba(15,23,42,0.12)] transition-all group-hover:border-slate-200/70 group-hover:bg-white/96 group-hover:text-slate-900 group-hover:opacity-100 focus-visible:border-slate-200/80 focus-visible:bg-white/96 focus-visible:text-slate-900 focus-visible:opacity-100"
							onClick={() => setRotation((value) => (value + 90) % 360)}
							style={{
								transform: `scale(${Number((1 / popupScale).toFixed(4))})`,
								transformOrigin: "top right",
							}}
							type="button"
						>
							<RotateCw aria-hidden="true" size={22} strokeWidth={2.4} />
						</button>
					</div>
					{summary ? (
						<div className="border-t border-border-subtle px-5 py-4">
							<p className="text-sm leading-6 text-text-primary">{summary}</p>
						</div>
					) : null}
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
	hoveredBlockId,
	onClearHighlight,
	onCreateReaderAnnotation,
	onHoverBlock,
	onPointDims,
	onSelectAnnotation,
	onSelectBlock,
	onSetHighlight,
	page,
	pageRefs,
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
	hoveredBlockId?: string | null
	onClearHighlight?: (blockId: string) => Promise<void> | void
	onCreateReaderAnnotation?: (input: {
		page: number
		kind: ReaderAnnotationTool
		color: string
		body: ReaderAnnotationBody
	}) => Promise<unknown> | unknown
	onHoverBlock?: (blockId: string | null) => void
	onPointDims?: (dims: { w: number; h: number }) => void
	onSelectAnnotation?: (annotationId: string | null) => void
	onSelectBlock?: (block: Block) => void
	onSetHighlight?: (blockId: string, color: string) => Promise<void> | void
	page: number
	pageRefs: React.MutableRefObject<Map<number, HTMLDivElement>>
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
	const [draftBody, setDraftBody] = useState<ReaderAnnotationBody | null>(null)
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

	const finishDraft = useCallback(
		async (commit: boolean) => {
			const session = draftSessionRef.current
			draftSessionRef.current = null
			setDraftBody(null)
			if (!commit || !session || !onCreateReaderAnnotation) return

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
			if (annotationTool === "ink" ? inkTotalDistance < 0.01 : dragDistance < 0.01) return

			const body =
				annotationTool === "highlight"
					? { rect: padHighlightRect(rectFromPoints(session.start, session.current)) }
					: annotationTool === "underline"
						? { from: session.start, to: session.current }
						: { points: session.points }

			if (bodyHasNoVisibleExtent(body)) return
			try {
				await onCreateReaderAnnotation({
					page,
					kind: annotationTool,
					color: annotationColor,
					body,
				})
			} catch (err) {
				console.error("Failed to persist reader annotation", err)
			}
		},
		[annotationColor, annotationTool, onCreateReaderAnnotation, page],
	)

	useEffect(() => {
		if (annotationMode) return
		draftSessionRef.current = null
		setDraftBody(null)
	}, [annotationMode])

	// Persisted annotations and the parsed-blocks layer are independent of
	// draftBody. Memoize so they don't re-render on every pointermove tick
	// (otherwise large pages stutter while drawing ink/underlines).
	const annotationNodes = useMemo(
		() =>
			(annotations ?? []).map((annotation) => (
				<ReaderAnnotationShape
					annotation={annotation}
					isSelected={selectedAnnotationId === annotation.id}
					key={annotation.id}
					onSelect={onSelectAnnotation}
				/>
			)),
		[annotations, selectedAnnotationId, onSelectAnnotation],
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
										? "border-accent-600 bg-accent-600/10 shadow-[0_0_0_1px_var(--color-accent-600)]"
										: isHovered
											? "border-accent-600/70 bg-accent-600/8"
											: "border-accent-600/35 bg-accent-600/3"
							}`}
							style={
								fill
									? {
											background: `color-mix(in oklch, ${fill.bg} 38%, transparent)`,
										}
									: undefined
							}
						/>
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
				if (el) pageRefs.current.set(page, el)
				else pageRefs.current.delete(page)
			}}
		>
			<Page
				onLoadSuccess={(loadedPage) => {
					const view = (loadedPage as { view?: number[] }).view
					if (view && view.length === 4) {
						const dims = { w: view[2] - view[0], h: view[3] - view[1] }
						setPointDims(dims)
						onPointDims?.(dims)
					}
				}}
				pageNumber={page}
				renderAnnotationLayer={false}
				// pdf.js's text layer sits above the canvas with pointer-events
				// enabled so users can select text. In markup mode it would
				// swallow pointerdowns over text — disable it so the SVG below
				// receives the drag everywhere on the page.
				renderTextLayer={!annotationMode}
				scale={scale}
			/>
			{pointDims ? (
				// Cover the full page wrapper. Earlier this used a measured
				// canvasRect, but ResizeObserver bound to the original canvas
				// missed react-pdf re-creating the canvas on zoom, leaving the
				// overlay short — drawing/clicks at the page bottom fell
				// outside the SVG. The page wrapper hugs the canvas exactly,
				// so inset:0 is both simpler and always correct.
				<div className="absolute inset-0">
					<svg
						aria-label={`Reader annotations page ${page}`}
						className={`absolute inset-0 z-[1] ${annotationMode ? "pointer-events-auto" : "pointer-events-none"}`}
						onClick={(event) => {
							// Only treat clicks on empty page surface as "deselect".
							// Clicks on existing annotation shapes already handle
							// selection on their own — falling through here would
							// race their stopPropagation and clear the selection.
							if (event.target !== event.currentTarget) return
							onSelectAnnotation?.(null)
						}}
						onPointerCancel={() => void finishDraft(false)}
						onPointerDown={(event) => {
							if (!annotationMode || !onCreateReaderAnnotation || event.button !== 0) return
							// Guard: clicks/drags that started on an annotation shape
							// must not start a new draft on top of it.
							if (event.target !== event.currentTarget) return
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
								setDraftBody({ rect: padHighlightRect(rectFromPoints(session.start, point)) })
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
						ref={annotationSvgRef}
						viewBox="0 0 1 1"
						preserveAspectRatio="none"
					>
						{annotationNodes}
						{draftBody ? (
							<ReaderAnnotationDraft
								body={draftBody}
								color={annotationColor}
								kind={annotationTool}
							/>
						) : null}
					</svg>
					<div className={`absolute inset-0 z-[2] ${annotationMode ? "pointer-events-none" : ""}`}>
						{blocksLayer}
					</div>
				</div>
			) : null}
		</div>
	)
})

PdfPageWithOverlay.displayName = "PdfPageWithOverlay"

function ReaderAnnotationShape({
	annotation,
	isSelected,
	onSelect,
}: {
	annotation: ReaderAnnotation
	isSelected: boolean
	onSelect?: (annotationId: string | null) => void
}) {
	const highlightStroke = isSelected ? "rgba(15, 23, 42, 0.55)" : "transparent"
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
				height={rect.h}
				rx={0.004}
				ry={0.004}
				stroke={highlightStroke}
				strokeDasharray={isSelected ? "0.012 0.008" : undefined}
				strokeWidth={isSelected ? 0.0018 : 0.004}
				width={rect.w}
				x={rect.x}
				y={rect.y}
				{...stopAndSelect}
			/>
		)
	}
	if (annotation.kind === "underline" && "from" in annotation.body && "to" in annotation.body) {
		const { from, to } = annotation.body
		// Visible stroke is thin; the second line is a transparent fat hit
		// target on top so the user can comfortably click to select. Handlers
		// live on the hit line itself — no <g> wrapper means there's no
		// bubble-stage where the parent SVG might race the selection.
		return (
			<>
				<line
					pointerEvents="none"
					stroke={annotation.color}
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeOpacity={0.95}
					strokeWidth={isSelected ? 0.01 : 0.006}
					x1={from.x}
					x2={to.x}
					y1={from.y}
					y2={to.y}
				/>
				<line
					{...stopAndSelect}
					pointerEvents="stroke"
					stroke="transparent"
					strokeWidth={0.03}
					x1={from.x}
					x2={to.x}
					y1={from.y}
					y2={to.y}
				/>
			</>
		)
	}
	if (annotation.kind === "ink" && "points" in annotation.body) {
		const d = pointsToSvgPath(annotation.body.points)
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
					strokeWidth={isSelected ? 0.012 : 0.0075}
				/>
				<path
					{...stopAndSelect}
					d={d}
					fill="none"
					pointerEvents="stroke"
					stroke="transparent"
					strokeWidth={0.03}
				/>
			</>
		)
	}
	return null
}

function ReaderAnnotationDraft({
	body,
	color,
	kind,
}: {
	body: ReaderAnnotationBody
	color: string
	kind: ReaderAnnotationTool
}) {
	if (kind === "highlight" && "rect" in body) {
		return (
			<rect
				fill={color}
				fillOpacity={0.22}
				height={body.rect.h}
				rx={0.004}
				ry={0.004}
				stroke={color}
				strokeDasharray="0.015 0.01"
				strokeOpacity={0.65}
				strokeWidth={0.003}
				width={body.rect.w}
				x={body.rect.x}
				y={body.rect.y}
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
				strokeWidth={0.006}
				x1={body.from.x}
				x2={body.to.x}
				y1={body.from.y}
				y2={body.to.y}
			/>
		)
	}
	if (kind === "ink" && "points" in body) {
		return (
			<path
				d={pointsToSvgPath(body.points)}
				fill="none"
				stroke={color}
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeOpacity={0.8}
				strokeWidth={0.0075}
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
function padHighlightRect(rect: { x: number; y: number; w: number; h: number }) {
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
