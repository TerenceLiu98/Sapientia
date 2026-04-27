import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { type Block, useBlocks } from "@/api/hooks/blocks"
import type { BlockHighlight, HighlightColor } from "@/api/hooks/highlights"
import { BlockCitationsPopover } from "./BlockCitationsPopover"

interface Props {
	paperId: string
	currentPage?: number
	hoveredBlockId?: string | null
	selectedBlockId?: string | null
	selectedBlockRequestNonce?: number
	onHoverBlock?: (blockId: string | null) => void
	onSelectBlock?: (block: Block) => void
	highlights?: BlockHighlight[]
	// Optional render slot the citation flow (TASK-013) hooks into.
	renderActions?: (block: Block) => React.ReactNode
	// Map of blockId → number of notes citing it. Drives the badge.
	citationCounts?: Map<string, number>
}

export function BlocksPanel({
	paperId,
	currentPage,
	hoveredBlockId,
	selectedBlockId,
	selectedBlockRequestNonce,
	onHoverBlock,
	onSelectBlock,
	highlights,
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
	const highlightColorsByBlock = useMemo(() => {
		const map = new Map<string, HighlightColor[]>()
		for (const highlight of highlights ?? []) {
			const colors = map.get(highlight.blockId) ?? []
			if (!colors.includes(highlight.color)) colors.push(highlight.color)
			map.set(highlight.blockId, colors)
		}
		return map
	}, [highlights])

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
				currentPage={currentPage}
				grouped={grouped}
				highlightColorsByBlock={highlightColorsByBlock}
				hoveredBlockId={hoveredBlockId}
				onDismissPopover={() => setOpenPopoverFor(null)}
				onHoverBlock={onHoverBlock}
				onSelect={onSelectBlock}
				onTogglePopover={(id) => setOpenPopoverFor((cur) => (cur === id ? null : id))}
				openPopoverFor={openPopoverFor}
				paperId={paperId}
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
	currentPage,
	grouped,
	highlightColorsByBlock,
	hoveredBlockId,
	onDismissPopover,
	onHoverBlock,
	onSelect,
	onTogglePopover,
	openPopoverFor,
	paperId,
	renderActions,
	selectedBlockId,
	selectedBlockRequestNonce,
}: {
	citationCounts?: Map<string, number>
	currentPage?: number
	grouped: Array<[number, Block[]]>
	highlightColorsByBlock: Map<string, HighlightColor[]>
	hoveredBlockId?: string | null
	onDismissPopover: () => void
	onHoverBlock?: (blockId: string | null) => void
	onSelect?: (block: Block) => void
	onTogglePopover: (id: string) => void
	openPopoverFor: string | null
	paperId: string
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
	const handleBlockSelectFromPane = useCallback(
		(block: Block) => {
			skipNextSelectionScrollRef.current = true
			onSelect?.(block)
		},
		[onSelect],
	)

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

	return (
		<div className="scrollbar-none min-h-0 flex-1 overflow-y-auto p-4" ref={scrollRef}>
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
								isHovered={hoveredBlockId === block.blockId}
								key={block.blockId}
								highlightColors={highlightColorsByBlock.get(block.blockId) ?? []}
								onHoverBlock={onHoverBlock}
								isSelected={selectedBlockId === block.blockId}
								onSelect={handleBlockSelectFromPane}
								renderActions={renderActions}
								citationCount={citationCounts?.get(block.blockId)}
								paperId={paperId}
								popoverOpen={openPopoverFor === block.blockId}
								onTogglePopover={() => onTogglePopover(block.blockId)}
								onDismissPopover={onDismissPopover}
							/>
						))}
					</div>
				</div>
			))}
		</div>
	)
}

// A block in the parsed-blocks pane. Defaults to flowing prose / images with
// no chrome — the panel reads like the article itself. Hover or selection
// adds a soft outline to make the link with the PDF overlay visible.
function BlockRow({
	block,
	cardRefs,
	highlightColors,
	isHovered,
	isSelected,
	onHoverBlock,
	onSelect,
	renderActions,
	citationCount,
	paperId,
	popoverOpen,
	onTogglePopover,
	onDismissPopover,
}: {
	block: Block
	cardRefs: React.MutableRefObject<Map<string, HTMLDivElement>>
	highlightColors: HighlightColor[]
	isHovered: boolean
	isSelected: boolean
	onHoverBlock?: (blockId: string | null) => void
	onSelect?: (block: Block) => void
	renderActions?: (block: Block) => React.ReactNode
	citationCount?: number
	paperId: string
	popoverOpen: boolean
	onTogglePopover: () => void
	onDismissPopover: () => void
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

	// Subtle ring + slight tint when active. Default state has no border / fill
	// so blocks visually flow into one continuous article.
	const wrapperClass = `group relative cursor-pointer rounded-md px-3 py-2 transition-colors ${
		isSelected
			? "bg-accent-50/70 ring-1 ring-inset ring-accent-600/55"
			: isHovered
				? "bg-accent-50/40"
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
			tabIndex={0}
		>
			{highlightColors.length > 0 ? (
				<div
					aria-hidden="true"
					className="absolute bottom-2 left-1.5 top-2 flex w-1 overflow-hidden rounded-full"
					data-testid={`highlight-band-${block.blockId}`}
				>
					{highlightColors.map((color) => (
						<span
							className="flex-1"
							key={color}
							style={{ backgroundColor: `var(--note-${color}-bg)` }}
						/>
					))}
				</div>
			) : null}
			<BlockBody block={block} />
			{/*
			 * Floating action toolbar — appears on hover at the top-right of
			 * the row. Reading-view stays clean by default; the toolbar
			 * surfaces tools only when the user is interacting with this
			 * block. Renders the citation count too when present so the user
			 * doesn't have to chase a separate badge.
			 */}
			<div className="absolute right-2 top-2 flex items-center gap-0.5 rounded-md border border-border-subtle bg-bg-overlay/95 px-1 py-0.5 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:opacity-100 focus-within:opacity-100">
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

// Flowing-markdown rendering of a block. Headings get heading styles, figures
// render their image + caption, code/equation render in monospace, list items
// fall back to bullet list. Anything we don't recognize renders as a plain
// paragraph.
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
			if (level <= 1) return <h1 className={cls}>{block.text || "[heading]"}</h1>
			if (level === 2) return <h2 className={cls}>{block.text || "[heading]"}</h2>
			return <h3 className={cls}>{block.text || "[heading]"}</h3>
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
