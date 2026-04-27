import { memo, type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Document, Page } from "react-pdf"
import type { Block } from "@/api/hooks/blocks"
import { usePaperPdfUrl } from "@/api/hooks/papers"
import { type PaletteEntry, paletteColorVars } from "@/lib/highlight-palette"
import { BlockHighlightPicker } from "./BlockHighlightPicker"

const MIN_SCALE = 0.5
const MAX_SCALE = 3
const FIT_WIDTH_GUTTER_PX = 32
const BBOX_EPSILON = 0.02

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
	onSetHighlight?: (blockId: string, color: string) => Promise<void> | void
	onClearHighlight?: (blockId: string) => Promise<void> | void
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
	onSetHighlight,
	onClearHighlight,
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
									blocks={blocksByPage.get(page)}
									colorByBlock={colorByBlock}
									hoveredBlockId={hoveredBlockId}
									key={page}
									onClearHighlight={onClearHighlight}
									onHoverBlock={onHoverBlock}
									onPointDims={(dims) => setBasePageWidth((current) => current ?? dims.w)}
									onSelectBlock={onSelectBlock}
									onSetHighlight={onSetHighlight}
									page={page}
									pageRefs={pageRefs}
									palette={palette}
									renderActions={renderActions}
									scale={scale}
									selectedBlockId={selectedBlockId}
									showLayoutBoxes={showLayoutBoxes}
								/>
							))
						: null}
				</Document>
			</div>
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
	blocks,
	colorByBlock,
	hoveredBlockId,
	onClearHighlight,
	onHoverBlock,
	onPointDims,
	onSelectBlock,
	onSetHighlight,
	page,
	pageRefs,
	palette,
	renderActions,
	scale,
	selectedBlockId,
	showLayoutBoxes,
}: {
	blocks: Block[] | undefined
	colorByBlock?: Map<string, string>
	hoveredBlockId?: string | null
	onClearHighlight?: (blockId: string) => Promise<void> | void
	onHoverBlock?: (blockId: string | null) => void
	onPointDims?: (dims: { w: number; h: number }) => void
	onSelectBlock?: (block: Block) => void
	onSetHighlight?: (blockId: string, color: string) => Promise<void> | void
	page: number
	pageRefs: React.MutableRefObject<Map<number, HTMLDivElement>>
	palette?: PaletteEntry[]
	renderActions?: (block: Block) => React.ReactNode
	scale: number
	selectedBlockId?: string | null
	showLayoutBoxes: boolean
}) {
	const wrapRef = useRef<HTMLDivElement | null>(null)
	const [pointDims, setPointDims] = useState<{ w: number; h: number } | null>(null)
	const [canvasRect, setCanvasRect] = useState<{
		left: number
		top: number
		width: number
		height: number
	} | null>(null)

	const measureCanvas = useCallback(() => {
		const wrap = wrapRef.current
		if (!wrap) return
		const canvas = wrap.querySelector("canvas")
		if (!canvas) return
		const wrapRectBox = wrap.getBoundingClientRect()
		const canvasRectBox = canvas.getBoundingClientRect()
		setCanvasRect({
			left: canvasRectBox.left - wrapRectBox.left,
			top: canvasRectBox.top - wrapRectBox.top,
			width: canvasRectBox.width,
			height: canvasRectBox.height,
		})
	}, [])

	useEffect(() => {
		const wrap = wrapRef.current
		if (!wrap || typeof ResizeObserver === "undefined") return
		const canvas = wrap.querySelector("canvas")
		if (!canvas) return
		const observer = new ResizeObserver(() => measureCanvas())
		observer.observe(canvas)
		return () => observer.disconnect()
	}, [measureCanvas])

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
				onRenderSuccess={measureCanvas}
				pageNumber={page}
				renderAnnotationLayer={false}
				renderTextLayer={true}
				scale={scale}
			/>
			{blocks && blocks.length > 0 && pointDims ? (
				<div
					className="absolute"
					style={
						canvasRect
							? {
									left: canvasRect.left,
									top: canvasRect.top,
									width: canvasRect.width,
									height: canvasRect.height,
								}
							: {
									inset: 0,
									width: pointDims.w * scale,
									height: pointDims.h * scale,
								}
					}
				>
					{blocks.map((block) => {
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
					})}
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
