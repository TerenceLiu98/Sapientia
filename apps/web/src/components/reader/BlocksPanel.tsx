import "katex/dist/katex.min.css"
import { memo, type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import katex from "katex"
import { type Block, useBlocks } from "@/api/hooks/blocks"
import { type PaletteEntry, paletteVisualTokens } from "@/lib/highlight-palette"
import { BlockCitationsPopover } from "./BlockCitationsPopover"
import { BlockHighlightPicker } from "./BlockHighlightPicker"

const BLOCKS_WINDOW_RADIUS = 1

interface Props {
	paperId: string
	currentPage?: number
	followCurrentPage?: boolean
	externalFollowLockUntil?: number
	onInteract?: () => void
	onViewportAnchorChange?: (page: number, yRatio: number) => void
	selectedBlockId?: string | null
	previewedBlockId?: string | null
	selectedBlockRequestNonce?: number
	requestedAnchorYRatio?: number
	requestedPage?: number
	requestedPageNonce?: number
	onSelectBlock?: (block: Block) => void
	colorByBlock?: Map<string, string>
	palette?: PaletteEntry[]
	onSetHighlight?: (blockId: string, color: string) => Promise<void> | void
	onClearHighlight?: (blockId: string) => Promise<void> | void
	// Optional render slot the citation flow (TASK-013) hooks into.
	renderActions?: (block: Block) => React.ReactNode
	// Map of blockId → number of notes citing it. Drives the badge.
	citationCounts?: Map<string, number>
}

export function BlocksPanel({
	paperId,
	currentPage,
	followCurrentPage = true,
	externalFollowLockUntil,
	onInteract,
	onViewportAnchorChange,
	selectedBlockId,
	previewedBlockId,
	selectedBlockRequestNonce,
	requestedAnchorYRatio,
	requestedPage,
	requestedPageNonce,
	onSelectBlock,
	colorByBlock,
	palette,
	onSetHighlight,
	onClearHighlight,
	renderActions,
	citationCounts,
}: Props) {
	const { data: blocks, isLoading, error } = useBlocks(paperId)
	const [openPopoverFor, setOpenPopoverFor] = useState<string | null>(null)
	const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null)

	const grouped = useMemo(() => {
		if (!blocks) return [] as Array<[number, Block[]]>
		const m = new Map<number, Block[]>()
		for (const b of blocks) {
			const arr = m.get(b.page) ?? []
			arr.push(b)
			m.set(b.page, arr)
		}
		return [...m.entries()].sort(([a], [b]) => a - b)
	}, [blocks])
	const [visiblePage, setVisiblePage] = useState<number>(currentPage ?? 1)

	useEffect(() => {
		if (followCurrentPage && currentPage != null) {
			setVisiblePage(currentPage)
			return
		}
		if (grouped.length > 0 && !grouped.some(([page]) => page === visiblePage)) {
			setVisiblePage(grouped[0][0])
		}
	}, [currentPage, followCurrentPage, grouped, visiblePage])

	if (isLoading) {
		return <div className="p-4 text-sm text-text-tertiary">Loading blocks…</div>
	}
	if (error) {
		return <div className="p-4 text-sm text-text-error">Failed to load blocks.</div>
	}
	if (!blocks || blocks.length === 0) {
		return (
			<div className="p-4 text-sm text-text-tertiary">
				No blocks yet. The paper may still be parsing, or parsing failed.
			</div>
		)
	}

	return (
		<div className="flex h-full min-h-0 flex-col bg-[var(--color-reading-bg)]">
			<div className="flex shrink-0 items-center justify-between border-b border-border-subtle bg-bg-primary/75 px-4 py-3">
				<div>
					<div className="text-xs uppercase tracking-[0.16em] text-text-secondary">
						Parsed blocks
					</div>
				</div>
				<div className="rounded-md border border-border-default bg-bg-primary px-3 py-1 text-xs font-medium text-text-secondary">
					{visiblePage}/{grouped.length}
				</div>
			</div>
			<BlocksPanelScrollBody
				citationCounts={citationCounts}
				colorByBlock={colorByBlock}
				currentPage={visiblePage}
				followCurrentPage={followCurrentPage}
				externalFollowLockUntil={externalFollowLockUntil}
					grouped={grouped}
					hoveredBlockId={hoveredBlockId}
					onActivePageChange={setVisiblePage}
					onClearHighlight={onClearHighlight}
					onDismissPopover={() => setOpenPopoverFor(null)}
					onHoverBlock={setHoveredBlockId}
				onInteract={onInteract}
				onViewportAnchorChange={onViewportAnchorChange}
				onSelect={onSelectBlock}
				onSetHighlight={onSetHighlight}
				onTogglePopover={(id) => setOpenPopoverFor((cur) => (cur === id ? null : id))}
				openPopoverFor={openPopoverFor}
				paperId={paperId}
				palette={palette}
				requestedAnchorYRatio={requestedAnchorYRatio}
				requestedPage={requestedPage}
				requestedPageNonce={requestedPageNonce}
				previewedBlockId={previewedBlockId}
				renderActions={renderActions}
				selectedBlockId={selectedBlockId}
				selectedBlockRequestNonce={selectedBlockRequestNonce}
			/>
		</div>
	)
}

// Owns the scrollable card list. Holds a ref to the scroll container plus a
// blockId → card-element map; when `selectedBlockId` changes (from PDF click
// or otherwise) we compute the right scrollTop ourselves and animate to it.
// `scrollIntoView` was unreliable here because the parent layout has nested
// overflow ancestors and the browser kept picking the wrong one.
function BlocksPanelScrollBody({
	citationCounts,
	colorByBlock,
	currentPage,
	followCurrentPage,
	externalFollowLockUntil,
	grouped,
	hoveredBlockId,
	onActivePageChange,
	onClearHighlight,
	onDismissPopover,
	onHoverBlock,
	onInteract,
	onViewportAnchorChange,
	onSelect,
	onSetHighlight,
	onTogglePopover,
	openPopoverFor,
	paperId,
	palette,
	requestedAnchorYRatio,
	requestedPage,
	requestedPageNonce,
	previewedBlockId,
	renderActions,
	selectedBlockId,
	selectedBlockRequestNonce,
}: {
	citationCounts?: Map<string, number>
	colorByBlock?: Map<string, string>
	currentPage?: number
	followCurrentPage: boolean
	externalFollowLockUntil?: number
	grouped: Array<[number, Block[]]>
	hoveredBlockId?: string | null
	onActivePageChange?: (page: number) => void
	onClearHighlight?: (blockId: string) => Promise<void> | void
	onDismissPopover: () => void
	onHoverBlock?: (blockId: string | null) => void
	onInteract?: () => void
	onViewportAnchorChange?: (page: number, yRatio: number) => void
	onSelect?: (block: Block) => void
	onSetHighlight?: (blockId: string, color: string) => Promise<void> | void
	onTogglePopover: (id: string) => void
	openPopoverFor: string | null
	paperId: string
	palette?: PaletteEntry[]
	requestedAnchorYRatio?: number
	requestedPage?: number
	requestedPageNonce?: number
	previewedBlockId?: string | null
	renderActions?: (block: Block) => React.ReactNode
	selectedBlockId?: string | null
	selectedBlockRequestNonce?: number
}) {
	const scrollRef = useRef<HTMLDivElement | null>(null)
	const cardRefs = useRef(new Map<string, HTMLDivElement>())
	const [cardRefsVersion, setCardRefsVersion] = useState(0)
	const pageHeaderRefs = useRef(new Map<number, HTMLDivElement>())
	const pageIntersectionRatiosRef = useRef(new Map<number, number>())
	const activePageRef = useRef(currentPage ?? grouped[0]?.[0] ?? 1)
	const pageObserverRef = useRef<IntersectionObserver | null>(null)
	const scrollMeasureFrameRef = useRef<number | null>(null)
	const lastReportedViewportRef = useRef<{ page: number; yRatio: number } | null>(null)
	const handledRequestedJumpRef = useRef<string | null>(null)
	const [pageBodyHeights, setPageBodyHeights] = useState<Map<number, number>>(() => new Map())

	const selectedBlockPage = useMemo(
		() => grouped.find(([, pageBlocks]) => pageBlocks.some((block) => block.blockId === selectedBlockId))?.[0],
		[grouped, selectedBlockId],
	)
	const renderedPages = useMemo(() => {
		// Window pages around the centers of interest; out-of-window pages
		// fall back to a placeholder with estimated height. Crucial during
		// the cold mount on view-mode switch — rendering all pages here
		// pinned a ~1s synchronous KaTeX render across the entire paper. The
		// jump-handling effect tolerates the target page not being rendered
		// yet (it bails and re-runs once `cardRefsVersion` ticks), and page
		// headers render for every page regardless, so scroll alignment
		// still works.
		const centers = new Set<number>()
		if (currentPage != null) centers.add(currentPage)
		if (requestedPage != null) centers.add(requestedPage)
		if (selectedBlockPage != null) centers.add(selectedBlockPage)
		const next = new Set<number>()
		for (const [page] of grouped) {
			if (centers.size === 0 || Array.from(centers).some((center) => Math.abs(center - page) <= BLOCKS_WINDOW_RADIUS)) {
				next.add(page)
			}
		}
		return next
	}, [currentPage, grouped, requestedPage, selectedBlockPage])

	const averageMeasuredBodyHeight = useMemo(() => {
		const values = Array.from(pageBodyHeights.values()).filter((value) => value > 0)
		if (values.length === 0) return 0
		return values.reduce((sum, value) => sum + value, 0) / values.length
	}, [pageBodyHeights])

	const scrollContainerToOffset = useCallback((offset: number) => {
		const container = scrollRef.current
		if (!container) return
		const max = container.scrollHeight - container.clientHeight
		const top = Math.max(0, Math.min(max, offset))
		if (typeof container.scrollTo === "function") {
			container.scrollTo({ top, behavior: "smooth" })
			return
		}
		container.scrollTop = top
	}, [])

	const computeTopmostVisiblePage = useCallback(() => {
		const container = scrollRef.current
		if (!container) return activePageRef.current
		const containerRect = container.getBoundingClientRect()
		const pages = grouped.map(([page]) => page)
		for (const page of pages) {
			const section = pageHeaderRefs.current.get(page)
			if (!section) continue
			const rect = section.getBoundingClientRect()
			if (rect.bottom <= containerRect.top) continue
			if (rect.top >= containerRect.bottom) continue
			return page
		}
		return activePageRef.current
	}, [grouped])

	const registerCardRef = useCallback((blockId: string, el: HTMLDivElement | null) => {
		const previous = cardRefs.current.get(blockId)
		if (el) {
			if (previous === el) return
			cardRefs.current.set(blockId, el)
			setCardRefsVersion((value) => value + 1)
			return
		}
		if (!previous) return
		cardRefs.current.delete(blockId)
		setCardRefsVersion((value) => value + 1)
	}, [])

	// Selection-driven scroll wins: when a block is explicitly selected (click
	// in PDF or in this pane), we lock out the page-driven scroll briefly so
	// the smooth-scrolling PDF can't drag this pane through every intermediate
	// page header on the way to the target.
	const lockUntilRef = useRef(0)
	// Set right before a click *inside this pane* selects a block. The
	// selection effect treats this as "the user can already see the block,
	// don't auto-scroll the pane" — only PDF-side or programmatic selections
	// should re-center the card. Avoids the small jitter where clicking a
	// fully-visible card scrolls it the few pixels needed to be exactly
	// centered in the viewport.
	const skipNextSelectionScrollRef = useRef(false)

	useEffect(() => {
		if (!externalFollowLockUntil) return
		lockUntilRef.current = Math.max(lockUntilRef.current, externalFollowLockUntil)
	}, [externalFollowLockUntil])

	useEffect(() => {
		if (!followCurrentPage || !currentPage) return
		activePageRef.current = currentPage
	}, [currentPage, followCurrentPage])

	const handleBlockSelectFromPane = useCallback(
		(block: Block) => {
			skipNextSelectionScrollRef.current = true
			onSelect?.(block)
		},
		[onSelect],
	)

	useEffect(() => {
		void requestedPageNonce
		if (!requestedPage) return
		const requestKey = `${requestedPageNonce ?? "default"}:${requestedPage}:${requestedAnchorYRatio ?? "none"}`
		if (handledRequestedJumpRef.current === requestKey) return
		lockUntilRef.current = Date.now() + 500
		// A programmatic jump already positions the pane at the target block.
		// Skip the next selection-driven recenter so we don't "correct" the
		// scroll a second time and create a visible bounce.
		skipNextSelectionScrollRef.current = true
		const container = scrollRef.current
		const header = pageHeaderRefs.current.get(requestedPage)
		if (!container || !header) return
		const pageBlocks = grouped.find(([page]) => page === requestedPage)?.[1] ?? []
		const exactSelectedBlock =
			selectedBlockId != null
				? pageBlocks.find((block) => block.blockId === selectedBlockId) ?? null
				: null
		const targetBlock =
			exactSelectedBlock ??
			(typeof requestedAnchorYRatio === "number"
				? pageBlocks.reduce<Block | null>((best, block) => {
						if (!block.bbox) return best
						if (!best?.bbox) return block
						const bestDistance = Math.abs(best.bbox.y + best.bbox.h / 2 - requestedAnchorYRatio)
						const nextDistance = Math.abs(block.bbox.y + block.bbox.h / 2 - requestedAnchorYRatio)
						return nextDistance < bestDistance ? block : best
					}, null)
				: null)
		if (targetBlock && !cardRefs.current.get(targetBlock.blockId)) return
		const targetEl = targetBlock ? (cardRefs.current.get(targetBlock.blockId) ?? header) : header
		const targetRect = targetEl.getBoundingClientRect()
		const containerRect = container.getBoundingClientRect()
		// Always scroll on a focus request. Self-pane card clicks no longer
		// emit one (the block is visible by definition), so the only callers
		// here are cross-view toggles and citation chip jumps — both want
		// to re-center the target even if it's currently in viewport.
		const targetTopInContent = targetRect.top - containerRect.top + container.scrollTop
		scrollContainerToOffset(targetTopInContent - 8)
		handledRequestedJumpRef.current = requestKey
	}, [
		cardRefsVersion,
		grouped,
		requestedAnchorYRatio,
		requestedPage,
		requestedPageNonce,
		selectedBlockId,
		scrollContainerToOffset,
	])

	const measureViewport = useCallback(() => {
		const container = scrollRef.current
		if (!container) return

		const containerRect = container.getBoundingClientRect()
		let activePage = computeTopmostVisiblePage() || grouped[0]?.[0]
		let activeBlocks = grouped.find(([page]) => page === activePage)?.[1] ?? grouped[0]?.[1] ?? []
		if (activePage != null && activePage !== activePageRef.current) {
			activePageRef.current = activePage
			onActivePageChange?.(activePage)
		}

		if (activePage == null) return

		const probeY = containerRect.top + container.clientHeight / 2
		let anchorYRatio = 0.5
		let bestDistance = Number.POSITIVE_INFINITY

		for (const block of activeBlocks) {
			if (!block.bbox) continue
			const card = cardRefs.current.get(block.blockId)
			if (!card) continue
			const rect = card.getBoundingClientRect()
			const distance = Math.abs(rect.top + rect.height / 2 - probeY)
			if (distance < bestDistance) {
				bestDistance = distance
				anchorYRatio = clampUnit(block.bbox.y + block.bbox.h / 2)
			}
		}

		const last = lastReportedViewportRef.current
		if (last && last.page === activePage && Math.abs(last.yRatio - anchorYRatio) < 0.04) return
		lastReportedViewportRef.current = { page: activePage, yRatio: anchorYRatio }
		onViewportAnchorChange?.(activePage, anchorYRatio)
	}, [computeTopmostVisiblePage, grouped, onActivePageChange, onViewportAnchorChange])

	const scheduleViewportMeasure = useCallback(() => {
		if (scrollMeasureFrameRef.current != null) return
		scrollMeasureFrameRef.current = window.requestAnimationFrame(() => {
			scrollMeasureFrameRef.current = null
			measureViewport()
		})
	}, [measureViewport])

	useEffect(() => {
		const container = scrollRef.current
		if (!container) return

		scheduleViewportMeasure()
		container.addEventListener("scroll", scheduleViewportMeasure, { passive: true })
		return () => {
			container.removeEventListener("scroll", scheduleViewportMeasure)
			if (scrollMeasureFrameRef.current != null) {
				window.cancelAnimationFrame(scrollMeasureFrameRef.current)
				scrollMeasureFrameRef.current = null
			}
		}
	}, [scheduleViewportMeasure])

	useEffect(() => {
		const container = scrollRef.current
		if (!container) return
		if (typeof IntersectionObserver === "undefined") return

		const observer = new IntersectionObserver(
			(_entries) => {
				scheduleViewportMeasure()
			},
			{
				root: container,
				threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
			},
		)

		pageObserverRef.current = observer
		for (const el of pageHeaderRefs.current.values()) observer.observe(el)
		scheduleViewportMeasure()
		return () => {
			pageObserverRef.current = null
			observer.disconnect()
		}
	}, [scheduleViewportMeasure])

	useEffect(() => {
		void selectedBlockRequestNonce
		if (requestedPage) return
		// Lock the page-driven scroll regardless — we don't want the PDF's
		// smooth-scroll to drag the pane through intermediate pages even if
		// we're skipping our own selection scroll.
		if (selectedBlockId) lockUntilRef.current = Date.now() + 500
		if (skipNextSelectionScrollRef.current) {
			skipNextSelectionScrollRef.current = false
			return
		}
		if (!selectedBlockId) return
		const card = cardRefs.current.get(selectedBlockId)
		const container = scrollRef.current
		if (!card || !container) return
		// `offsetTop` is unreliable here because the scroll container isn't
		// guaranteed to be the offsetParent. Compute the card's position via
		// bounding rects + the container's current scrollTop so we always
		// get an offset relative to the *scroll content*.
		const cardRect = card.getBoundingClientRect()
		const containerRect = container.getBoundingClientRect()
		const cardTopInContent = cardRect.top - containerRect.top + container.scrollTop
		const target = cardTopInContent - container.clientHeight / 2 + cardRect.height / 2
		scrollContainerToOffset(target)
	}, [cardRefsVersion, requestedPage, selectedBlockId, selectedBlockRequestNonce, scrollContainerToOffset])

	// Follow PDF scroll: when the PDF advances to a new page, snap the parsed
	// pane to that page's section header. Skip during the post-selection lock
	// window so a click → page jump doesn't drag this pane through every
	// intermediate page on the way to the target.
	useEffect(() => {
		if (!followCurrentPage || !currentPage) return
		if (Date.now() < lockUntilRef.current) return
		const header = pageHeaderRefs.current.get(currentPage)
		const container = scrollRef.current
		if (!header || !container) return
		// Park the page header just below the top edge so the user sees the
		// "Page N" chip and the first block right under it. Same rationale
		// as above: bounding-rect math, not offsetTop.
		const headerRect = header.getBoundingClientRect()
		const containerRect = container.getBoundingClientRect()
		const headerTopInContent = headerRect.top - containerRect.top + container.scrollTop
		scrollContainerToOffset(headerTopInContent - 8)
	}, [currentPage, followCurrentPage, scrollContainerToOffset])

	const handleUserScrollIntent = useCallback(() => {
		lockUntilRef.current = Date.now() + 500
	}, [])

	const handleMainPointerDown = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			if (!shouldCollapseNotesOnMainClick(event.target)) return
			onInteract?.()
		},
		[onInteract],
	)

	const rememberPageBodyHeight = useCallback((page: number, height: number) => {
		if (!Number.isFinite(height) || height <= 0) return
		setPageBodyHeights((current) => {
			const previous = current.get(page)
			if (previous != null && Math.abs(previous - height) < 2) return current
			const next = new Map(current)
			next.set(page, height)
			return next
		})
	}, [])

	return (
		<div
			className="scrollbar-none min-h-0 flex-1 overflow-y-auto p-4"
			onMouseDown={handleMainPointerDown}
			onTouchMove={handleUserScrollIntent}
			onWheel={handleUserScrollIntent}
			ref={scrollRef}
		>
			{grouped.map(([page, pageBlocks]) => (
				<div
					className="mb-5"
					data-page-number={page}
					key={page}
					ref={(el) => {
						const previous = pageHeaderRefs.current.get(page)
						if (previous && previous !== el) {
							pageObserverRef.current?.unobserve(previous)
						}
						if (el) {
							pageHeaderRefs.current.set(page, el)
							pageObserverRef.current?.observe(el)
						} else {
							pageHeaderRefs.current.delete(page)
							pageIntersectionRatiosRef.current.delete(page)
						}
					}}
				>
					<div
						className={`mb-2 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
							currentPage === page
								? "bg-surface-selected text-text-accent"
								: "bg-bg-secondary text-text-secondary"
						}`}
					>
						Page {page}
					</div>
					{renderedPages.has(page) ? (
						<PageBlockBody
							citationCounts={citationCounts}
							colorByBlock={colorByBlock}
							hoveredBlockId={hoveredBlockId}
							onClearHighlight={onClearHighlight}
							onDismissPopover={onDismissPopover}
							onHoverBlock={onHoverBlock}
							onMeasureHeight={(height) => rememberPageBodyHeight(page, height)}
							onRegisterCardRef={registerCardRef}
							onSelect={handleBlockSelectFromPane}
							onSetHighlight={onSetHighlight}
							onTogglePopover={onTogglePopover}
							openPopoverFor={openPopoverFor}
								pageBlocks={pageBlocks}
								palette={palette}
								paperId={paperId}
								previewedBlockId={previewedBlockId}
								renderActions={renderActions}
								selectedBlockId={selectedBlockId}
							/>
					) : (
						<PageBlockPlaceholder
							blockCount={pageBlocks.length}
							height={pageBodyHeights.get(page) ?? estimatePageBodyHeight(pageBlocks, averageMeasuredBodyHeight)}
						/>
					)}
				</div>
			))}
		</div>
	)
}

function clampUnit(value: number) {
	return Math.max(0, Math.min(1, value))
}

function shouldCollapseNotesOnMainClick(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return false
	return !target.closest("button, a, input, textarea, select, [contenteditable='true']")
}

function estimatePageBodyHeight(pageBlocks: Block[], averageMeasuredBodyHeight: number) {
	if (averageMeasuredBodyHeight > 0) return averageMeasuredBodyHeight
	const estimate = pageBlocks.reduce((sum, block) => {
		switch (block.type) {
			case "heading":
				return sum + 64
			case "figure":
			case "table":
				return sum + 320
			case "equation":
			case "code":
				return sum + 120
			case "list":
				return sum + 140
			case "other":
				return sum + 56
			default:
				return sum + 96
		}
	}, 0)
	return Math.max(estimate, 160)
}

function PageBlockPlaceholder({ blockCount, height }: { blockCount: number; height: number }) {
	return (
		<div
			aria-hidden="true"
			className="overflow-hidden rounded-md border border-border-subtle/40 bg-bg-secondary/20"
			style={{ height }}
		>
			<div className="flex h-full flex-col gap-3 p-3 opacity-40">
				{Array.from({ length: Math.min(Math.max(blockCount, 2), 5) }, (_, index) => (
					<div
						className="rounded-sm bg-bg-secondary/70"
						key={index}
						style={{
							height: index === 0 ? 20 : 14,
							width: `${92 - index * 9}%`,
						}}
					/>
				))}
			</div>
		</div>
	)
}

interface PageBlockBodyProps {
	citationCounts?: Map<string, number>
	colorByBlock?: Map<string, string>
	hoveredBlockId?: string | null
	onClearHighlight?: (blockId: string) => Promise<void> | void
	onDismissPopover: () => void
	onHoverBlock?: (blockId: string | null) => void
	onMeasureHeight: (height: number) => void
	onRegisterCardRef: (blockId: string, el: HTMLDivElement | null) => void
	onSelect?: (block: Block) => void
	onSetHighlight?: (blockId: string, color: string) => Promise<void> | void
	onTogglePopover: (id: string) => void
	openPopoverFor: string | null
	pageBlocks: Block[]
	palette?: PaletteEntry[]
	paperId: string
	previewedBlockId?: string | null
	renderActions?: (block: Block) => React.ReactNode
	selectedBlockId?: string | null
}

const PageBlockBody = memo(function PageBlockBody({
	citationCounts,
	colorByBlock,
	hoveredBlockId,
	onClearHighlight,
	onDismissPopover,
	onHoverBlock,
	onMeasureHeight,
	onRegisterCardRef,
	onSelect,
	onSetHighlight,
	onTogglePopover,
	openPopoverFor,
	pageBlocks,
	palette,
	paperId,
	previewedBlockId,
	renderActions,
	selectedBlockId,
}: PageBlockBodyProps) {
	const bodyRef = useRef<HTMLDivElement | null>(null)

	useEffect(() => {
		const el = bodyRef.current
		if (!el) return
		onMeasureHeight(el.offsetHeight)
		if (typeof ResizeObserver === "undefined") return
		const observer = new ResizeObserver(() => {
			onMeasureHeight(el.offsetHeight)
		})
		observer.observe(el)
		return () => observer.disconnect()
	}, [onMeasureHeight, pageBlocks])

	return (
		<div className="space-y-3" ref={bodyRef}>
			{pageBlocks.map((block) => (
				<BlockRow
						block={block}
						citationCount={citationCounts?.get(block.blockId)}
						highlightColor={colorByBlock?.get(block.blockId) ?? null}
						isHovered={hoveredBlockId === block.blockId || previewedBlockId === block.blockId}
						isSelected={selectedBlockId === block.blockId}
						key={block.blockId}
					onClearHighlight={onClearHighlight}
					onDismissPopover={onDismissPopover}
					onHoverBlock={onHoverBlock}
					onRegisterCardRef={onRegisterCardRef}
					onSelect={onSelect}
					onSetHighlight={onSetHighlight}
					onTogglePopover={() => onTogglePopover(block.blockId)}
					palette={palette}
					paperId={paperId}
					popoverOpen={openPopoverFor === block.blockId}
					renderActions={renderActions}
				/>
			))}
		</div>
	)
})

type BlockRowProps = {
	block: Block
	citationCount?: number
	highlightColor: string | null
	isHovered: boolean
	isSelected: boolean
	onClearHighlight?: (blockId: string) => Promise<void> | void
	onDismissPopover: () => void
	onHoverBlock?: (blockId: string | null) => void
	onRegisterCardRef: (blockId: string, el: HTMLDivElement | null) => void
	onSelect?: (block: Block) => void
	onSetHighlight?: (blockId: string, color: string) => Promise<void> | void
	onTogglePopover: () => void
	palette?: PaletteEntry[]
	paperId: string
	popoverOpen: boolean
	renderActions?: (block: Block) => React.ReactNode
}

// A block in the parsed-blocks pane. Default state is invisible chrome so
// the pane reads like an article; hover / selection / an applied highlight
// each contribute their own visual layer (toolbar, ring, fill).
const BlockRow = memo(function BlockRow({
	block,
	citationCount,
	highlightColor,
	isHovered,
	isSelected,
	onClearHighlight,
	onDismissPopover,
	onHoverBlock,
	onRegisterCardRef,
	onSelect,
	onSetHighlight,
	onTogglePopover,
	palette,
	paperId,
	popoverOpen,
	renderActions,
}: BlockRowProps) {
	const setRef = (el: HTMLDivElement | null) => {
		onRegisterCardRef(block.blockId, el)
	}

	const handleCopy = (e: React.MouseEvent) => {
		e.stopPropagation()
		const text = (block.caption ?? block.text ?? "").trim()
		if (!text) return
		void navigator.clipboard?.writeText(text)
	}

	// Block-level fill is the only highlight rendering — soft tinted bg
	// applied to the whole card. Hover / selected layers blend with it.
	const fillStyle = highlightColor
		? (() => {
				const colors = paletteVisualTokens(palette ?? [], highlightColor)
				return { backgroundColor: colors.fillBg }
			})()
		: undefined

	const wrapperClass = `group relative cursor-pointer rounded-md px-3 py-2 transition-colors ${
		highlightColor
			? ""
			: isSelected
				? "bg-accent-600/12"
				: isHovered
					? "bg-accent-600/7"
					: "hover:bg-bg-overlay/50"
	}`

	return (
		// biome-ignore lint/a11y/useSemanticElements: nesting <h1>/<figure>/<pre> inside a <button> would break their semantics; role="button" on a <div> is the right escape hatch
		<div
			className={wrapperClass}
			onClick={() => onSelect?.(block)}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault()
					onSelect?.(block)
				}
			}}
			onMouseEnter={() => onHoverBlock?.(block.blockId)}
			onMouseLeave={() => onHoverBlock?.(null)}
			ref={setRef}
			role="button"
			style={fillStyle}
			tabIndex={0}
		>
			<BlockBody block={block} />
			{/*
			 * Floating action toolbar — appears on hover, anchored centered
			 * just below the row. Reading-view stays clean by default; the
			 * toolbar surfaces the citation badge, the highlight color
			 * picker, copy, and cite/add-note in one strip. `top-full`
			 * (zero gap) keeps the toolbar a hover descendant so cursor
			 * transit between row and toolbar doesn't fire mouseleave.
			 */}
			<div className="absolute left-1/2 top-full z-10 flex -translate-x-1/2 items-center gap-1 rounded-md border border-border-subtle bg-bg-overlay/95 px-1.5 py-0.5 opacity-0 shadow-[var(--shadow-popover)] backdrop-blur transition-opacity group-hover:opacity-100 focus-within:opacity-100">
				{citationCount && citationCount > 0 ? (
					<span className="relative">
						<button
							aria-label={`${citationCount} note${citationCount > 1 ? "s" : ""} cite this block`}
							className="flex h-7 min-w-[28px] items-center justify-center rounded-sm px-1.5 text-xs font-medium text-text-accent hover:bg-surface-hover"
							onClick={(e) => {
								e.stopPropagation()
								onTogglePopover()
							}}
							title={`${citationCount} note${citationCount > 1 ? "s" : ""} cite this block`}
							type="button"
						>
							{citationCount}
						</button>
						{popoverOpen ? (
							<BlockCitationsPopover
								blockId={block.blockId}
								onDismiss={onDismissPopover}
								paperId={paperId}
							/>
						) : null}
					</span>
				) : null}
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
					onClick={handleCopy}
					title="Copy"
					type="button"
				>
					<CopyIcon />
				</button>
				{renderActions ? renderActions(block) : null}
			</div>
		</div>
	)
},
(prev, next) =>
	prev.block === next.block &&
	prev.citationCount === next.citationCount &&
	prev.highlightColor === next.highlightColor &&
	prev.isHovered === next.isHovered &&
	prev.isSelected === next.isSelected &&
	prev.paperId === next.paperId &&
	prev.popoverOpen === next.popoverOpen &&
	prev.palette === next.palette &&
	prev.renderActions === next.renderActions,
)

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

const katexHtmlCache = new Map<string, string>()
const mathSegmentsCache = new Map<string, MathSegment[]>()

function renderKatex(latex: string, displayMode: boolean) {
	if (!latex.trim()) return ""
	const cacheKey = `${displayMode ? "display" : "inline"}:${latex}`
	const cached = katexHtmlCache.get(cacheKey)
	if (cached != null) return cached
	try {
		const html = katex.renderToString(latex, {
			displayMode,
			throwOnError: false,
			strict: "ignore",
		})
		katexHtmlCache.set(cacheKey, html)
		return html
	} catch {
		return ""
	}
}

function normalizeEquationLatex(source: string) {
	const trimmed = source.trim()
	if (!trimmed) return trimmed
	if (trimmed.startsWith("$$") && trimmed.endsWith("$$") && trimmed.length >= 4) {
		return trimmed.slice(2, -2).trim()
	}
	if (trimmed.startsWith("\\[") && trimmed.endsWith("\\]") && trimmed.length >= 4) {
		return trimmed.slice(2, -2).trim()
	}
	if (trimmed.startsWith("\\(") && trimmed.endsWith("\\)") && trimmed.length >= 4) {
		return trimmed.slice(2, -2).trim()
	}
	return trimmed
}

type MathSegment =
	| { type: "text"; value: string }
	| { type: "math"; value: string; displayMode: boolean }

function splitTextWithMath(source: string): MathSegment[] {
	const cached = mathSegmentsCache.get(source)
	if (cached) return cached
	if (!source) {
		const empty: MathSegment[] = [{ type: "text", value: "" }]
		mathSegmentsCache.set(source, empty)
		return empty
	}
	const segments: MathSegment[] = []
	const pattern = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^\n$]+?)\$/g
	let lastIndex = 0

	for (const match of source.matchAll(pattern)) {
		const full = match[0]
		const index = match.index ?? 0
		if (index > lastIndex) {
			segments.push({ type: "text", value: source.slice(lastIndex, index) })
		}
		if (match[1] != null) {
			segments.push({ type: "math", value: match[1], displayMode: true })
		} else if (match[2] != null) {
			segments.push({ type: "math", value: match[2], displayMode: true })
		} else if (match[3] != null) {
			segments.push({ type: "math", value: match[3], displayMode: false })
		} else if (match[4] != null) {
			segments.push({ type: "math", value: match[4], displayMode: false })
		}
		lastIndex = index + full.length
	}

	if (lastIndex < source.length) {
		segments.push({ type: "text", value: source.slice(lastIndex) })
	}

	const result: MathSegment[] =
		segments.length > 0 ? segments : [{ type: "text", value: source }]
	mathSegmentsCache.set(source, result)
	return result
}

const RichTextContent = memo(function RichTextContent({
	text,
	displayClassName,
}: {
	text: string
	displayClassName?: string
}) {
	const segments = useMemo(() => splitTextWithMath(text), [text])

	return (
		<>
			{segments.map((segment, index) => {
				if (segment.type === "text") {
					return <span key={`text-${index}`}>{segment.value}</span>
				}
				const html = renderKatex(segment.value, segment.displayMode)
				if (!html) {
					return (
						<span
							className={segment.displayMode ? "block whitespace-pre-wrap" : ""}
							key={`math-fallback-${index}`}
						>
							{segment.displayMode ? `$$${segment.value}$$` : `$${segment.value}$`}
						</span>
					)
				}
				return (
					<span
						className={segment.displayMode ? displayClassName : ""}
						dangerouslySetInnerHTML={{ __html: html }}
						key={`math-${index}`}
					/>
				)
			})}
		</>
	)
})

const EquationBlock = memo(function EquationBlock({ latex }: { latex: string }) {
	const normalizedLatex = useMemo(() => normalizeEquationLatex(latex), [latex])
	const html = useMemo(() => renderKatex(normalizedLatex, true), [normalizedLatex])
	if (!html) {
		return (
			<pre className="my-2 overflow-x-auto whitespace-pre-wrap rounded-sm bg-bg-secondary/70 px-3 py-2 font-mono text-sm text-text-primary">
				{latex || "[equation]"}
			</pre>
		)
	}
	return (
		<div
			className="my-2 overflow-x-auto rounded-sm bg-bg-secondary/40 px-3 py-3 text-text-primary"
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	)
})

// Flowing-markdown rendering of a block. Highlight visualization happens at
// the row wrapper (block-level fill); BlockBody just renders the content.
const BlockBody = memo(function BlockBody({ block }: { block: Block }) {
	switch (block.type) {
		case "heading": {
			const level = block.headingLevel ?? 2
			const cls =
				level <= 1
					? "mt-4 mb-2 font-serif text-2xl font-semibold text-text-primary"
					: level === 2
						? "mt-3 mb-2 font-serif text-xl font-semibold text-text-primary"
						: "mt-2 mb-1.5 font-serif text-lg font-semibold text-text-primary"
			const text = block.text || "[heading]"
			if (level <= 1)
				return (
					<h1 className={cls}>
						<RichTextContent text={text} />
					</h1>
				)
			if (level === 2)
				return (
					<h2 className={cls}>
						<RichTextContent text={text} />
					</h2>
				)
			return (
				<h3 className={cls}>
					<RichTextContent text={text} />
				</h3>
			)
		}
		case "figure":
		case "table": {
			return (
				<figure className="my-2">
					{block.imageUrl ? (
						<img
							alt={block.caption ?? `${block.type}`}
							className="mx-auto max-h-[360px] w-auto max-w-full rounded-sm border border-border-subtle bg-bg-primary object-contain"
							loading="lazy"
							src={block.imageUrl}
						/>
					) : (
						<div className="rounded-sm border border-dashed border-border-subtle bg-bg-secondary px-3 py-2 text-xs italic text-text-tertiary">
							[{block.type} — no image extracted]
						</div>
					)}
					{block.caption ? (
						<figcaption className="mt-1.5 text-center text-sm text-text-secondary">
							{block.caption}
						</figcaption>
					) : null}
				</figure>
			)
		}
		case "equation":
			return <EquationBlock latex={block.text || ""} />
		case "code":
			return (
				<pre className="my-2 overflow-x-auto whitespace-pre-wrap rounded-sm bg-bg-secondary/70 px-3 py-2 font-mono text-sm text-text-primary">
					{block.text || `[${block.type}]`}
				</pre>
			)
		case "list": {
			const items = (block.metadata?.listItems as unknown[] | undefined) ?? []
			if (items.length === 0 && block.text) {
				return (
					<p className="my-1 whitespace-pre-wrap font-serif text-[0.97rem] leading-7 text-text-primary">
						<RichTextContent text={block.text} displayClassName="my-2 block overflow-x-auto" />
					</p>
				)
			}
			return (
				<ul className="my-2 list-disc pl-6 font-serif text-[0.97rem] leading-7 text-text-primary">
					{items.map((item) => (
						<li key={`${block.blockId}-${String(item)}`}>
							<RichTextContent text={String(item)} displayClassName="my-2 block overflow-x-auto" />
						</li>
					))}
				</ul>
			)
		}
		case "other":
			return (
				<p className="my-1 text-sm italic text-text-tertiary">{block.text || `[${block.type}]`}</p>
			)
		default:
			return (
				<p className="my-1 whitespace-pre-wrap font-serif text-[0.97rem] leading-7 text-text-primary">
					<RichTextContent text={block.text || "[empty]"} displayClassName="my-2 block overflow-x-auto" />
				</p>
			)
	}
})
