import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Document, Page } from "react-pdf"
import type { Block } from "@/api/hooks/blocks"
import { usePaperPdfUrl } from "@/api/hooks/papers"

const MIN_SCALE = 0.5
const MAX_SCALE = 3
const FIT_WIDTH_GUTTER_PX = 32
const BBOX_EPSILON = 0.02

interface PdfViewerProps {
	paperId: string
	// Imperative jump request from a sibling (e.g. BlocksPanel). Bumping the
	// nonce on each click is enough to retrigger; the page number is in the
	// `requestedPage` prop.
	requestedPage?: number
	requestedPageNonce?: number
	onPageChange?: (page: number) => void
	// Optional block overlay. When provided, MinerU-parsed block bboxes are
	// drawn on top of each page; the selected block is emphasised. Bboxes are
	// normalized [0,1] ratios of the page dimensions, so the overlay scales
	// with fit-width / zoom without any extra coordinate transforms.
	blocks?: Block[]
	hoveredBlockId?: string | null
	selectedBlockId?: string | null
	onHoverBlock?: (blockId: string | null) => void
	onSelectBlock?: (block: Block) => void
}

export function PdfViewer({
	paperId,
	requestedPage,
	requestedPageNonce,
	onPageChange,
	blocks,
	hoveredBlockId,
	selectedBlockId,
	onHoverBlock,
	onSelectBlock,
}: PdfViewerProps) {
	const { data, isLoading, isError, refetch } = usePaperPdfUrl(paperId)
	const [numPages, setNumPages] = useState<number | null>(null)
	const [currentPage, setCurrentPage] = useState(1)
	const [scale, setScale] = useState(1.0)
	const [scaleMode, setScaleMode] = useState<"fit" | "manual">("fit")
	const [basePageWidth, setBasePageWidth] = useState<number | null>(null)
	const [renderError, setRenderError] = useState<string | null>(null)
	const scrollContainerRef = useRef<HTMLDivElement>(null)
	const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset local viewer state specifically when the paper changes
	useEffect(() => {
		setNumPages(null)
		setCurrentPage(1)
		setScale(1)
		setScaleMode("fit")
		setBasePageWidth(null)
		setRenderError(null)
		pageRefs.current.clear()
	}, [paperId])

	const blocksByPage = useMemo(() => {
		const m = new Map<number, Block[]>()
		if (!blocks) return m
		for (const b of blocks) {
			if (!isRenderableBbox(b.bbox)) continue
			const arr = m.get(b.page) ?? []
			arr.push(b)
			m.set(b.page, arr)
		}
		return m
	}, [blocks])

	const scrollToPage = useCallback((page: number) => {
		const el = pageRefs.current.get(page)
		if (el) el.scrollIntoView({ behavior: "smooth", block: "start" })
	}, [])

	const fitToWidth = useCallback(() => {
		if (!scrollContainerRef.current || !basePageWidth) return
		const availableWidth = scrollContainerRef.current.clientWidth - FIT_WIDTH_GUTTER_PX
		if (availableWidth <= 0) return
		setScale(clamp(availableWidth / basePageWidth))
	}, [basePageWidth])

	// Notify parent on page change (BlocksPanel uses this to highlight the
	// current page header).
	useEffect(() => {
		onPageChange?.(currentPage)
	}, [currentPage, onPageChange])

	// External jump request: scroll once per nonce change. We deliberately
	// only depend on the nonce so re-clicking the same block still retriggers
	// the scroll, and so a stale `requestedPage` doesn't keep firing.
	// biome-ignore lint/correctness/useExhaustiveDependencies: nonce drives the effect
	useEffect(() => {
		if (requestedPage == null) return
		scrollToPage(requestedPage)
	}, [requestedPageNonce])

	// Track which page is most visible while scrolling.
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

	// PageDown / Space → next, PageUp / Shift+Space → previous.
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
			// BlockNote (and other rich-text editors) use contentEditable divs,
			// not <textarea>. Without this guard, hitting Space inside the note
			// editor would scroll the PDF instead of inserting a space.
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

	// Cmd/Ctrl + scroll wheel → zoom.
	useEffect(() => {
		const container = scrollContainerRef.current
		if (!container) return
		const handler = (e: WheelEvent) => {
			if (e.ctrlKey || e.metaKey) {
				e.preventDefault()
				const delta = e.deltaY < 0 ? 0.1 : -0.1
				setScaleMode("manual")
				setScale((s) => clamp(s + delta))
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
		const container = scrollContainerRef.current
		const observer = new ResizeObserver(() => {
			fitToWidth()
		})
		observer.observe(container)
		return () => observer.disconnect()
	}, [fitToWidth, scaleMode])

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
		<div className="flex h-full flex-col bg-[var(--color-reading-bg)]">
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
							const p = Number(e.target.value)
							if (!Number.isNaN(p) && p >= 1) scrollToPage(p)
						}}
					/>{" "}
					of {numPages ?? "—"}
				</div>
				<div className="flex items-center gap-1">
					<button
						aria-label="Zoom out"
						className="h-7 w-7 rounded-md text-sm hover:bg-surface-hover"
						onClick={() => {
							setScaleMode("manual")
							setScale((s) => clamp(s - 0.1))
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
							setScale((s) => clamp(s + 0.1))
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

			<div ref={scrollContainerRef} className="flex-1 overflow-auto">
				<Document
					className="flex flex-col items-center gap-4 py-4"
					file={data.url}
					loading={<div className="p-8 text-text-tertiary">Rendering PDF…</div>}
					error={
						<div className="p-8 text-text-error">{renderError ?? "Failed to render PDF."}</div>
					}
					onLoadSuccess={({ numPages: n }) => {
						setNumPages(n)
						setRenderError(null)
					}}
					onLoadError={(err) => setRenderError(err.message)}
				>
					{numPages != null
						? Array.from({ length: numPages }, (_, i) => i + 1).map((page) => (
								<PdfPageWithOverlay
									blocks={blocksByPage.get(page)}
									hoveredBlockId={hoveredBlockId}
									onHoverBlock={onHoverBlock}
									key={page}
									onSelectBlock={onSelectBlock}
									onPointDims={(dims) => {
										setBasePageWidth((current) => current ?? dims.w)
									}}
									page={page}
									pageRefs={pageRefs}
									scale={scale}
									selectedBlockId={selectedBlockId}
								/>
							))
						: null}
				</Document>
			</div>
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

// Renders a single PDF page plus an absolutely-positioned bbox overlay layer.
// We capture the page's intrinsic point dimensions once via onLoadSuccess so
// re-zooms don't need to re-measure — bbox * currentScale gives pixel coords
// directly because <Page scale={s}> renders at originalWidth*s pixels.
function PdfPageWithOverlay({
	blocks,
	hoveredBlockId,
	onHoverBlock,
	onSelectBlock,
	onPointDims,
	page,
	pageRefs,
	scale,
	selectedBlockId,
}: {
	blocks: Block[] | undefined
	hoveredBlockId?: string | null
	onHoverBlock?: (blockId: string | null) => void
	onSelectBlock?: (block: Block) => void
	onPointDims?: (dims: { w: number; h: number }) => void
	page: number
	pageRefs: React.MutableRefObject<Map<number, HTMLDivElement>>
	scale: number
	selectedBlockId?: string | null
}) {
	const wrapRef = useRef<HTMLDivElement | null>(null)
	const [pointDims, setPointDims] = useState<{ w: number; h: number } | null>(null)
	// We measure the canvas rect directly so the overlay layer aligns to the
	// pixels react-pdf actually rendered. Earlier versions positioned the
	// overlay against the wrapper (`absolute inset-0`); that's mostly fine,
	// but adds 1-2px drift if react-pdf nests another container. Locking onto
	// the canvas removes that ambiguity entirely.
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

	// Re-measure whenever the canvas resizes (zoom level changes, fit-to-width
	// recompute, etc.). ResizeObserver fires synchronously after layout.
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
				onLoadSuccess={(p) => {
					const view = (p as unknown as { view?: number[] }).view
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
			{blocks && blocks.length > 0 && pointDims && canvasRect ? (
				<div
					aria-hidden="true"
					className="pointer-events-none absolute"
					style={{
						left: canvasRect.left,
						top: canvasRect.top,
						width: canvasRect.width,
						height: canvasRect.height,
					}}
				>
					{blocks.map((block) => {
						if (!isRenderableBbox(block.bbox)) return null
						const isSelected = selectedBlockId === block.blockId
						const isHovered = hoveredBlockId === block.blockId
						return (
							<button
								className={`pointer-events-auto absolute cursor-pointer rounded-sm border transition-colors ${
									isSelected || isHovered
										? "border-accent-600 bg-accent-600/20 shadow-[0_0_0_1px_var(--color-accent-600)]"
										: "border-accent-600/55 bg-accent-600/9 hover:border-accent-600/80 hover:bg-accent-600/14"
								}`}
								key={block.blockId}
								onMouseEnter={() => onHoverBlock?.(block.blockId)}
								onMouseLeave={() => onHoverBlock?.(null)}
								onClick={(e) => {
									e.stopPropagation()
									onSelectBlock?.(block)
								}}
								style={{
									left: `${block.bbox.x * 100}%`,
									top: `${block.bbox.y * 100}%`,
									width: `${block.bbox.w * 100}%`,
									height: `${block.bbox.h * 100}%`,
								}}
								title={(block.caption ?? block.text ?? `[${block.type}]`).slice(0, 120)}
								type="button"
							/>
						)
					})}
				</div>
			) : null}
		</div>
	)
}
