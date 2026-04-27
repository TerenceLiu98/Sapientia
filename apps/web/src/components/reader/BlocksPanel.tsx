import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { type Block, useBlocks } from "@/api/hooks/blocks"
import { type PaletteEntry, paletteColorVars } from "@/lib/highlight-palette"
import { BlockCitationsPopover } from "./BlockCitationsPopover"
import { BlockHighlightPicker } from "./BlockHighlightPicker"

interface Props {
	paperId: string
	currentPage?: number
	externalFollowLockUntil?: number
	onInteract?: () => void
	onViewportAnchorChange?: (page: number, yRatio: number) => void
	hoveredBlockId?: string | null
	selectedBlockId?: string | null
	selectedBlockRequestNonce?: number
	requestedAnchorYRatio?: number
	requestedPage?: number
	requestedPageNonce?: number
	onHoverBlock?: (blockId: string | null) => void
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
	externalFollowLockUntil,
	onInteract,
	onViewportAnchorChange,
	hoveredBlockId,
	selectedBlockId,
	selectedBlockRequestNonce,
	requestedAnchorYRatio,
	requestedPage,
	requestedPageNonce,
	onHoverBlock,
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

	const selectedBlock = selectedBlockId
		? blocks.find((block) => block.blockId === selectedBlockId)
		: null

	return (
		<div className="flex h-full min-h-0 flex-col bg-[var(--color-reading-bg)]">
			<div className="flex shrink-0 items-center justify-between border-b border-border-subtle bg-bg-primary/75 px-4 py-3">
				<div>
					<div className="text-xs uppercase tracking-[0.16em] text-text-secondary">
						Parsed blocks
					</div>
					<div className="mt-1 text-sm text-text-tertiary">
						{selectedBlock
							? `Selected block on page ${selectedBlock.page}`
							: `${blocks.length} blocks parsed`}
					</div>
				</div>
				<div className="rounded-md border border-border-default bg-bg-primary px-3 py-1 text-xs font-medium text-text-secondary">
					Page {currentPage ?? 1}
				</div>
			</div>
			<BlocksPanelScrollBody
				citationCounts={citationCounts}
				colorByBlock={colorByBlock}
				currentPage={currentPage}
				externalFollowLockUntil={externalFollowLockUntil}
				grouped={grouped}
				hoveredBlockId={hoveredBlockId}
				onClearHighlight={onClearHighlight}
				onDismissPopover={() => setOpenPopoverFor(null)}
				onHoverBlock={onHoverBlock}
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
	externalFollowLockUntil,
	grouped,
	hoveredBlockId,
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
	renderActions,
	selectedBlockId,
	selectedBlockRequestNonce,
}: {
	citationCounts?: Map<string, number>
	colorByBlock?: Map<string, string>
	currentPage?: number
	externalFollowLockUntil?: number
	grouped: Array<[number, Block[]]>
	hoveredBlockId?: string | null
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
	renderActions?: (block: Block) => React.ReactNode
	selectedBlockId?: string | null
	selectedBlockRequestNonce?: number
}) {
	const scrollRef = useRef<HTMLDivElement | null>(null)
	const cardRefs = useRef(new Map<string, HTMLDivElement>())
	const pageHeaderRefs = useRef(new Map<number, HTMLDivElement>())

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
		lockUntilRef.current = Date.now() + 500
		// A programmatic jump already positions the pane at the target block.
		// Skip the next selection-driven recenter so we don't "correct" the
		// scroll a second time and create a visible bounce.
		skipNextSelectionScrollRef.current = true
		const container = scrollRef.current
		const header = pageHeaderRefs.current.get(requestedPage)
		if (!container || !header) return
		const pageBlocks = grouped.find(([page]) => page === requestedPage)?.[1] ?? []
		const targetBlock =
			typeof requestedAnchorYRatio === "number"
				? pageBlocks.reduce<Block | null>((best, block) => {
						if (!block.bbox) return best
						if (!best?.bbox) return block
						const bestDistance = Math.abs(best.bbox.y + best.bbox.h / 2 - requestedAnchorYRatio)
						const nextDistance = Math.abs(block.bbox.y + block.bbox.h / 2 - requestedAnchorYRatio)
						return nextDistance < bestDistance ? block : best
					}, null)
				: null
		const targetEl = targetBlock ? (cardRefs.current.get(targetBlock.blockId) ?? header) : header
		const targetRect = targetEl.getBoundingClientRect()
		const containerRect = container.getBoundingClientRect()
		const targetTopInContent = targetRect.top - containerRect.top + container.scrollTop
		scrollContainerToOffset(targetTopInContent - 8)
	}, [grouped, requestedAnchorYRatio, requestedPage, requestedPageNonce, scrollContainerToOffset])

	useEffect(() => {
		const container = scrollRef.current
		if (!container) return

		const handleScroll = () => {
			let activePage = grouped[0]?.[0]
			let activeBlocks = grouped[0]?.[1] ?? []
			let bestRatio = -1
			const containerRect = container.getBoundingClientRect()

			for (const [page, pageBlocks] of grouped) {
				const section = pageHeaderRefs.current.get(page)
				if (!section) continue
				const rect = section.getBoundingClientRect()
				const visibleTop = Math.max(rect.top, containerRect.top)
				const visibleBottom = Math.min(rect.bottom, containerRect.bottom)
				const visibleHeight = Math.max(0, visibleBottom - visibleTop)
				const ratio = visibleHeight / Math.max(rect.height, 1)
				if (ratio > bestRatio) {
					bestRatio = ratio
					activePage = page
					activeBlocks = pageBlocks
				}
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

			onViewportAnchorChange?.(activePage, anchorYRatio)
		}

		handleScroll()
		container.addEventListener("scroll", handleScroll, { passive: true })
		return () => container.removeEventListener("scroll", handleScroll)
	}, [grouped, onViewportAnchorChange])

	useEffect(() => {
		void selectedBlockRequestNonce
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
	}, [selectedBlockId, selectedBlockRequestNonce, scrollContainerToOffset])

	// Follow PDF scroll: when the PDF advances to a new page, snap the parsed
	// pane to that page's section header. Skip during the post-selection lock
	// window so a click → page jump doesn't drag this pane through every
	// intermediate page on the way to the target.
	useEffect(() => {
		if (!currentPage) return
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
	}, [currentPage, scrollContainerToOffset])

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
					key={page}
					ref={(el) => {
						if (el) pageHeaderRefs.current.set(page, el)
						else pageHeaderRefs.current.delete(page)
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
					<div className="space-y-3">
						{pageBlocks.map((block) => (
							<BlockRow
								block={block}
								cardRefs={cardRefs}
								citationCount={citationCounts?.get(block.blockId)}
								highlightColor={colorByBlock?.get(block.blockId) ?? null}
								isHovered={hoveredBlockId === block.blockId}
								isSelected={selectedBlockId === block.blockId}
								key={block.blockId}
								onClearHighlight={onClearHighlight}
								onDismissPopover={onDismissPopover}
								onHoverBlock={onHoverBlock}
								onSelect={handleBlockSelectFromPane}
								onSetHighlight={onSetHighlight}
								onTogglePopover={() => onTogglePopover(block.blockId)}
								palette={palette}
								paperId={paperId}
								popoverOpen={openPopoverFor === block.blockId}
								renderActions={renderActions}
							/>
						))}
					</div>
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

// A block in the parsed-blocks pane. Default state is invisible chrome so
// the pane reads like an article; hover / selection / an applied highlight
// each contribute their own visual layer (toolbar, ring, fill).
function BlockRow({
	block,
	cardRefs,
	citationCount,
	highlightColor,
	isHovered,
	isSelected,
	onClearHighlight,
	onDismissPopover,
	onHoverBlock,
	onSelect,
	onSetHighlight,
	onTogglePopover,
	palette,
	paperId,
	popoverOpen,
	renderActions,
}: {
	block: Block
	cardRefs: React.MutableRefObject<Map<string, HTMLDivElement>>
	citationCount?: number
	highlightColor: string | null
	isHovered: boolean
	isSelected: boolean
	onClearHighlight?: (blockId: string) => Promise<void> | void
	onDismissPopover: () => void
	onHoverBlock?: (blockId: string | null) => void
	onSelect?: (block: Block) => void
	onSetHighlight?: (blockId: string, color: string) => Promise<void> | void
	onTogglePopover: () => void
	palette?: PaletteEntry[]
	paperId: string
	popoverOpen: boolean
	renderActions?: (block: Block) => React.ReactNode
}) {
	const setRef = (el: HTMLDivElement | null) => {
		if (el) cardRefs.current.set(block.blockId, el)
		else cardRefs.current.delete(block.blockId)
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
				const colors = paletteColorVars(palette ?? [], highlightColor)
				return { backgroundColor: colors.bg }
			})()
		: undefined

	const wrapperClass = `group relative cursor-pointer rounded-md px-3 py-2 transition-colors ${
		isSelected
			? "ring-1 ring-inset ring-accent-600/55"
			: isHovered
				? "ring-1 ring-inset ring-accent-600/25"
				: ""
	} ${highlightColor ? "" : "hover:bg-bg-overlay/50"}`

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

// Flowing-markdown rendering of a block. Highlight visualization happens at
// the row wrapper (block-level fill); BlockBody just renders the content.
function BlockBody({ block }: { block: Block }) {
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
			if (level <= 1) return <h1 className={cls}>{text}</h1>
			if (level === 2) return <h2 className={cls}>{text}</h2>
			return <h3 className={cls}>{text}</h3>
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
					<p className="my-1 font-serif text-[0.97rem] leading-7 text-text-primary">{block.text}</p>
				)
			}
			return (
				<ul className="my-2 list-disc pl-6 font-serif text-[0.97rem] leading-7 text-text-primary">
					{items.map((item) => (
						<li key={`${block.blockId}-${String(item)}`}>{String(item)}</li>
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
					{block.text || "[empty]"}
				</p>
			)
	}
}
