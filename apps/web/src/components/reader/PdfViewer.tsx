import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Document, Page } from "react-pdf"
import type { Block } from "@/api/hooks/blocks"
import type { BlockHighlight, HighlightColor, HighlightInput } from "@/api/hooks/highlights"
import { usePaperPdfUrl } from "@/api/hooks/papers"
import { computeBlockRanges } from "./highlight-utils"
import { SelectionToolbar } from "./SelectionToolbar"

const MIN_SCALE = 0.5
const MAX_SCALE = 3
const FIT_WIDTH_GUTTER_PX = 32
const BBOX_EPSILON = 0.02

interface PdfViewerProps {
	paperId: string
	requestedPage?: number
	requestedBlockY?: number
	requestedPageNonce?: number
	onPageChange?: (page: number) => void
	blocks?: Block[]
	highlights?: BlockHighlight[]
	hoveredBlockId?: string | null
	selectedBlockId?: string | null
	onHoverBlock?: (blockId: string | null) => void
	onSelectBlock?: (block: Block) => void
	onApplyHighlights?: (color: HighlightColor, ranges: HighlightInput[]) => Promise<void> | void
	onDeleteHighlight?: (highlightId: string) => Promise<void> | void
	onCiteBlocks?: (blockIds: string[]) => Promise<void> | void
}

interface ToolbarState {
	position: { top: number; left: number }
	hits: HighlightInput[]
}

interface WholeBlockPopoverState {
	block: Block
	page: number
}

const WHOLE_BLOCK_TYPES = new Set<Block["type"]>(["figure", "table", "equation"])
const TEXT_SELECTABLE_TYPES = new Set<Block["type"]>(["text", "heading", "list", "code", "other"])

const HIGHLIGHT_COLORS: HighlightColor[] = [
	"questioning",
	"important",
	"original",
	"pending",
	"background",
]

export function PdfViewer({
	paperId,
	requestedPage,
	requestedBlockY,
	requestedPageNonce,
	onPageChange,
	blocks,
	highlights,
	hoveredBlockId,
	selectedBlockId,
	onHoverBlock,
	onSelectBlock,
	onApplyHighlights,
	onDeleteHighlight,
	onCiteBlocks,
}: PdfViewerProps) {
	const { data, isLoading, isError, refetch } = usePaperPdfUrl(paperId)
	const [numPages, setNumPages] = useState<number | null>(null)
	const [currentPage, setCurrentPage] = useState(1)
	const [scale, setScale] = useState(1.0)
	const [scaleMode, setScaleMode] = useState<"fit" | "manual">("fit")
	const [showLayoutBoxes, setShowLayoutBoxes] = useState(false)
	const [basePageWidth, setBasePageWidth] = useState<number | null>(null)
	const [renderError, setRenderError] = useState<string | null>(null)
	const [toolbarState, setToolbarState] = useState<ToolbarState | null>(null)
	const [wholeBlockPopover, setWholeBlockPopover] = useState<WholeBlockPopoverState | null>(null)
	const viewerRef = useRef<HTMLDivElement>(null)
	const scrollContainerRef = useRef<HTMLDivElement>(null)
	const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())

	const updateToolbarFromSelection = useCallback(() => {
		const root = viewerRef.current
		const selection = window.getSelection()
		if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
			setToolbarState(null)
			return
		}
		const range = selection.getRangeAt(0)
		if (!root.contains(range.commonAncestorContainer)) {
			setToolbarState(null)
			return
		}
		const hits = computeBlockRanges(selection).map((hit) => ({
			blockId: hit.blockId,
			charStart: hit.charStart,
			charEnd: hit.charEnd,
			selectedText: hit.selectedText,
		}))
		if (hits.length === 0) {
			setToolbarState(null)
			return
		}
		const rect = range.getBoundingClientRect()
		setToolbarState({
			position: {
				top: Math.max(12, rect.top - 56),
				left: Math.max(12, Math.min(window.innerWidth - 252, rect.left + rect.width / 2 - 112)),
			},
			hits,
		})
		setWholeBlockPopover(null)
	}, [])

	useEffect(() => {
		void paperId
		setNumPages(null)
		setCurrentPage(1)
		setScale(1)
		setScaleMode("fit")
		setShowLayoutBoxes(false)
		setBasePageWidth(null)
		setRenderError(null)
		setToolbarState(null)
		setWholeBlockPopover(null)
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

	const highlightsByBlock = useMemo(() => {
		const map = new Map<string, BlockHighlight[]>()
		for (const highlight of highlights ?? []) {
			const list = map.get(highlight.blockId) ?? []
			list.push(highlight)
			map.set(highlight.blockId, list)
		}
		return map
	}, [highlights])

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

	const dismissToolbar = useCallback(() => {
		window.getSelection()?.removeAllRanges()
		setToolbarState(null)
	}, [])

	const applyColor = useCallback(
		async (color: HighlightColor) => {
			if (!toolbarState || !onApplyHighlights) return
			await onApplyHighlights(color, toolbarState.hits)
			dismissToolbar()
		},
		[dismissToolbar, onApplyHighlights, toolbarState],
	)

	const copySelection = useCallback(() => {
		const text = toolbarState?.hits.map((hit) => hit.selectedText).join("\n") ?? ""
		if (!text.trim()) return
		void navigator.clipboard?.writeText(text)
		dismissToolbar()
	}, [dismissToolbar, toolbarState])

	const citeSelection = useCallback(async () => {
		if (!toolbarState || !onCiteBlocks) return
		await onCiteBlocks(toolbarState.hits.map((hit) => hit.blockId))
		dismissToolbar()
	}, [dismissToolbar, onCiteBlocks, toolbarState])

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
				}
			}
			setCurrentPage(activePage)
		}

		container.addEventListener("scroll", handleScroll, { passive: true })
		return () => container.removeEventListener("scroll", handleScroll)
	}, [numPages])

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

	useEffect(() => {
		document.addEventListener("selectionchange", updateToolbarFromSelection)
		document.addEventListener("mouseup", updateToolbarFromSelection)
		document.addEventListener("keyup", updateToolbarFromSelection)
		return () => {
			document.removeEventListener("selectionchange", updateToolbarFromSelection)
			document.removeEventListener("mouseup", updateToolbarFromSelection)
			document.removeEventListener("keyup", updateToolbarFromSelection)
		}
	}, [updateToolbarFromSelection])

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

			<div className="scrollbar-none flex-1 overflow-auto" ref={scrollContainerRef}>
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
									highlightsByBlock={highlightsByBlock}
									hoveredBlockId={hoveredBlockId}
									key={page}
									onApplyHighlights={onApplyHighlights}
									onDeleteHighlight={onDeleteHighlight}
									onHoverBlock={onHoverBlock}
									onOpenWholeBlockPopover={(block) => {
										setWholeBlockPopover((current) =>
											current?.block.blockId === block.blockId ? null : { block, page },
										)
										dismissToolbar()
									}}
									onPointDims={(dims) => setBasePageWidth((current) => current ?? dims.w)}
									onSelectBlock={onSelectBlock}
									openWholeBlockId={
										wholeBlockPopover?.page === page ? wholeBlockPopover.block.blockId : null
									}
									page={page}
									pageRefs={pageRefs}
									scale={scale}
									selectedBlockId={selectedBlockId}
									showLayoutBoxes={showLayoutBoxes}
								/>
							))
						: null}
				</Document>
			</div>

			{toolbarState ? (
				<SelectionToolbar
					onAsk={() => {
						dismissToolbar()
						window.alert("Ask agent is coming soon.")
					}}
					onCite={() => void citeSelection()}
					onColor={(color) => void applyColor(color)}
					onCopy={copySelection}
					onDismiss={dismissToolbar}
					position={toolbarState.position}
				/>
			) : (
				<div className="pointer-events-none absolute right-4 top-14 rounded-md border border-border-subtle bg-bg-overlay/92 px-2.5 py-1.5 text-xs text-text-tertiary shadow-[var(--shadow-popover)]">
					Select text in PDF to highlight
				</div>
			)}
		</div>
	)
}

function clamp(scale: number) {
	return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))
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

function PdfPageWithOverlay({
	blocks,
	highlightsByBlock,
	hoveredBlockId,
	onApplyHighlights,
	onDeleteHighlight,
	onHoverBlock,
	onOpenWholeBlockPopover,
	onPointDims,
	onSelectBlock,
	openWholeBlockId,
	page,
	pageRefs,
	scale,
	selectedBlockId,
	showLayoutBoxes,
}: {
	blocks: Block[] | undefined
	highlightsByBlock: Map<string, BlockHighlight[]>
	hoveredBlockId?: string | null
	onApplyHighlights?: (color: HighlightColor, ranges: HighlightInput[]) => Promise<void> | void
	onDeleteHighlight?: (highlightId: string) => Promise<void> | void
	onHoverBlock?: (blockId: string | null) => void
	onOpenWholeBlockPopover?: (block: Block) => void
	onPointDims?: (dims: { w: number; h: number }) => void
	onSelectBlock?: (block: Block) => void
	openWholeBlockId?: string | null
	page: number
	pageRefs: React.MutableRefObject<Map<number, HTMLDivElement>>
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
						const blockHighlights = highlightsByBlock.get(block.blockId) ?? []
						const wholeBlockHighlights = blockHighlights.filter(
							(highlight) => highlight.charStart == null || highlight.charEnd == null,
						)
						const blockText = getBlockText(block)
						const isSelected = selectedBlockId === block.blockId
						const isHovered = hoveredBlockId === block.blockId
						const isWholeBlockType = WHOLE_BLOCK_TYPES.has(block.type)
						const showPopover = openWholeBlockId === block.blockId
						const tone = wholeBlockHighlights[0]?.color
						const showBoxChrome =
							showLayoutBoxes ||
							isSelected ||
							isHovered ||
							wholeBlockHighlights.length > 0 ||
							showPopover

						return (
							// biome-ignore lint/a11y/noStaticElementInteractions: the block shell only mirrors hover state for PDF↔blocks sync; interactive actions live on descendants
							<div
								className="absolute"
								data-block-id={block.blockId}
								data-block-type={block.type}
								key={block.blockId}
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
										tone
											? {
													background: `color-mix(in oklch, var(--note-${tone}-bg) 32%, transparent)`,
												}
											: undefined
									}
								/>
								{isWholeBlockType ? (
									<>
										<button
											className="absolute inset-0 z-[1] cursor-pointer rounded-[2px] bg-transparent"
											onClick={(e) => {
												e.stopPropagation()
												onSelectBlock?.(block)
												onOpenWholeBlockPopover?.(block)
											}}
											title={(block.caption ?? block.text ?? `[${block.type}]`).slice(0, 120)}
											type="button"
										/>
										{showPopover && onApplyHighlights ? (
											<div className="absolute right-1 top-1 z-[2] rounded-md border border-border-default bg-bg-overlay p-1 shadow-[var(--shadow-popover)]">
												<div className="flex items-center gap-1">
													{HIGHLIGHT_COLORS.map((color) => (
														<button
															aria-label={`Highlight ${block.type} as ${color}`}
															className="h-5 w-5 rounded-sm border border-border-subtle"
															key={color}
															onClick={(e) => {
																e.stopPropagation()
																void onApplyHighlights(color, [
																	{
																		blockId: block.blockId,
																		charStart: null,
																		charEnd: null,
																		selectedText: (
																			block.caption ??
																			block.text ??
																			`[${block.type}]`
																		).trim(),
																	},
																])
																onOpenWholeBlockPopover?.(block)
															}}
															style={{ backgroundColor: `var(--note-${color}-bg)` }}
															type="button"
														/>
													))}
												</div>
											</div>
										) : null}
									</>
								) : TEXT_SELECTABLE_TYPES.has(block.type) ? (
									// biome-ignore lint/a11y/noStaticElementInteractions: text selection needs a non-button text container so the browser selection model works normally
									// biome-ignore lint/a11y/useKeyWithClickEvents: keyboard activation is handled in the parsed-blocks pane; this click only focuses the PDF block when no text selection exists
									<div
										className="absolute inset-0 z-[1] overflow-hidden rounded-[2px] px-1 py-0.5"
										onClick={(e) => {
											if ((window.getSelection()?.toString() ?? "").trim()) return
											e.stopPropagation()
											onSelectBlock?.(block)
										}}
									>
										<span
											className={`pdf-block-text whitespace-pre-wrap break-words font-serif select-text ${
												block.type === "heading" ? "font-semibold leading-[1.15]" : "leading-[1.28]"
											}`}
											data-block-text="true"
											style={{
												color: "transparent",
												fontSize: estimateFontSize(block),
											}}
										>
											{renderHighlightSegments(blockText, blockHighlights, onDeleteHighlight)}
										</span>
									</div>
								) : null}
							</div>
						)
					})}
				</div>
			) : null}
		</div>
	)
}

function estimateFontSize(block: Block) {
	if (block.type === "heading") {
		const level = block.headingLevel ?? 2
		if (level <= 1) return "22px"
		if (level === 2) return "18px"
		return "15px"
	}
	if (block.type === "code") return "11px"
	return "12px"
}

function getBlockText(block: Block) {
	if (block.caption?.trim()) return block.caption
	if (block.text?.trim()) return block.text
	return `[${block.type}]`
}

function renderHighlightSegments(
	text: string,
	highlights: BlockHighlight[],
	onDeleteHighlight?: (highlightId: string) => Promise<void> | void,
) {
	const segments = buildSegments(text, highlights)
	return segments.map((segment) => {
		if (segment.kind === "plain") {
			return <span key={segment.key}>{segment.text}</span>
		}
		return (
			<span
				className="sapientia-highlight group/highlight relative rounded-[2px]"
				data-highlight-id={segment.highlight.id}
				key={segment.highlight.id}
				style={{
					backgroundColor: `var(--note-${segment.highlight.color}-bg)`,
					color: "var(--color-text-primary)",
				}}
			>
				{segment.text}
				{onDeleteHighlight ? (
					<button
						aria-label="Remove highlight"
						className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full border border-border-default bg-bg-primary text-[9px] leading-none text-text-secondary opacity-0 shadow-sm transition-opacity group-hover/highlight:opacity-100"
						onClick={(e) => {
							e.stopPropagation()
							void onDeleteHighlight(segment.highlight.id)
						}}
						type="button"
					>
						×
					</button>
				) : null}
			</span>
		)
	})
}

function buildSegments(text: string, highlights: BlockHighlight[]) {
	const ranged = highlights
		.filter(
			(highlight): highlight is BlockHighlight & { charStart: number; charEnd: number } =>
				typeof highlight.charStart === "number" && typeof highlight.charEnd === "number",
		)
		.filter((highlight) => highlight.charEnd > highlight.charStart)
		.sort((a, b) => a.charStart - b.charStart || a.charEnd - b.charEnd)

	const segments: Array<
		| { kind: "plain"; key: string; text: string }
		| { kind: "highlight"; key: string; text: string; highlight: BlockHighlight }
	> = []
	let cursor = 0

	for (const highlight of ranged) {
		const start = Math.max(cursor, highlight.charStart)
		const end = Math.min(text.length, highlight.charEnd)
		if (start > cursor) {
			segments.push({
				kind: "plain",
				key: `plain-${cursor}-${start}`,
				text: text.slice(cursor, start),
			})
		}
		if (end > start) {
			segments.push({
				kind: "highlight",
				key: `highlight-${highlight.id}-${start}-${end}`,
				text: text.slice(start, end),
				highlight,
			})
			cursor = end
		}
	}

	if (cursor < text.length) {
		segments.push({
			kind: "plain",
			key: `plain-${cursor}-${text.length}`,
			text: text.slice(cursor),
		})
	}

	return segments.length > 0 ? segments : [{ kind: "plain" as const, key: "plain-full", text }]
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
