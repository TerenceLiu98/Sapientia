import { useEffect, useMemo, useRef, useState } from "react"
import { type Block, useBlocks } from "@/api/hooks/blocks"
import { BlockCitationsPopover } from "./BlockCitationsPopover"

const TYPE_GLYPH: Record<Block["type"], string> = {
	text: "¶",
	heading: "§",
	figure: "▣",
	table: "▦",
	equation: "∑",
	list: "•",
	code: "</>",
	other: "·",
}

interface Props {
	paperId: string
	currentPage?: number
	hoveredBlockId?: string | null
	selectedBlockId?: string | null
	onHoverBlock?: (blockId: string | null) => void
	onSelectBlock?: (block: Block) => void
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
	onHoverBlock,
	onSelectBlock,
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
			<div className="min-h-0 flex-1 overflow-y-auto p-4">
				{grouped.map(([page, pageBlocks]) => (
					<div className="mb-5" key={page}>
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
									isHovered={hoveredBlockId === block.blockId}
									key={block.blockId}
									onHoverBlock={onHoverBlock}
									isSelected={selectedBlockId === block.blockId}
									onSelect={onSelectBlock}
									renderActions={renderActions}
									citationCount={citationCounts?.get(block.blockId)}
									paperId={paperId}
									popoverOpen={openPopoverFor === block.blockId}
									onTogglePopover={() =>
										setOpenPopoverFor((cur) => (cur === block.blockId ? null : block.blockId))
									}
									onDismissPopover={() => setOpenPopoverFor(null)}
								/>
							))}
						</div>
					</div>
				))}
			</div>
		</div>
	)
}

function BlockRow({
	block,
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
	const fullText = useMemo(() => {
		const text = block.caption ?? block.text
		return text && text.trim().length > 0 ? text.trim() : `[${block.type}]`
	}, [block])

	const styleByType =
		block.type === "heading"
			? "font-medium text-text-primary"
			: block.type === "other"
				? "text-text-tertiary italic"
				: "text-text-secondary"

	// Visual blocks (figures, tables) lead with a thumbnail of the MinerU
	// crop when one is available, with the caption underneath. The image is
	// the primary cue; text-only fallback kicks in if the URL is missing.
	const isVisual = block.type === "figure" || block.type === "table"
	const showThumb = isVisual && Boolean(block.imageUrl)
	const rowRef = useRef<HTMLDivElement | null>(null)

	useEffect(() => {
		if (!isSelected || !rowRef.current) return
		rowRef.current.scrollIntoView({ block: "nearest" })
	}, [isSelected])

	return (
		<div
			className={`group rounded-lg border p-4 text-sm transition-colors ${
				isSelected
					? "border-border-accent bg-surface-selected/55 shadow-[inset_0_0_0_1px_var(--color-border-accent)]"
					: isHovered
						? "border-accent-300 bg-accent-50/70"
						: "border-border-subtle bg-[oklch(1_0_0_/_0.56)] hover:bg-[oklch(1_0_0_/_0.72)]"
			}`}
			ref={rowRef}
		>
			<button
				className="flex w-full flex-col items-start gap-3 text-left"
				onMouseEnter={() => onHoverBlock?.(block.blockId)}
				onMouseLeave={() => onHoverBlock?.(null)}
				onClick={() => onSelect?.(block)}
				type="button"
			>
				<div className="flex w-full items-center justify-between gap-3">
					<div className="flex min-w-0 items-center gap-2">
						<span className="text-xs text-text-tertiary">{TYPE_GLYPH[block.type]}</span>
						<span className="rounded-full bg-surface-selected px-2.5 py-1 text-xs font-medium text-text-accent">
							{labelForType(block.type)}
						</span>
					</div>
					<div className="text-xs text-text-tertiary">p.{block.page}</div>
				</div>
				{showThumb ? (
					<span className="flex w-full flex-col gap-2">
						<img
							alt={block.caption ?? `${block.type} block`}
							className="max-h-52 w-full rounded-md border border-border-subtle bg-bg-primary object-contain"
							loading="lazy"
							src={block.imageUrl ?? ""}
						/>
						{block.caption ? (
							<span className={`text-sm ${styleByType}`}>{block.caption}</span>
						) : null}
					</span>
				) : (
					<span
						className={`whitespace-pre-wrap font-serif text-[1.02rem] leading-7 ${styleByType}`}
					>
						{fullText}
					</span>
				)}
			</button>
			<div className="mt-3 flex items-center justify-between gap-3">
				<div className="text-xs text-text-tertiary">
					{isSelected ? "Linked to PDF focus" : "Click to focus in PDF"}
				</div>
				<div className="flex items-center gap-2">
					{citationCount && citationCount > 0 ? (
						<span className="relative shrink-0">
							<button
								className="rounded-md bg-bg-tertiary px-1.5 py-0.5 text-xs text-text-secondary hover:bg-surface-active"
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
					{renderActions ? (
						<span className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
							{renderActions(block)}
						</span>
					) : null}
				</div>
			</div>
		</div>
	)
}

function labelForType(type: Block["type"]) {
	switch (type) {
		case "heading":
			return "Heading"
		case "figure":
			return "Figure"
		case "table":
			return "Table"
		case "equation":
			return "Equation"
		case "list":
			return "List"
		case "code":
			return "Code"
		case "other":
			return "Other"
		default:
			return "Paragraph"
	}
}
