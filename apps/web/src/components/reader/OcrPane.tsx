import { useEffect, useMemo, useRef } from "react"
import type { Block } from "@/api/hooks/blocks"
import { BlockCitationsPopover } from "./BlockCitationsPopover"

interface Props {
	paperId: string
	blocks: Block[] | undefined
	isLoading?: boolean
	error?: unknown
	currentPage?: number
	selectedBlockId?: string | null
	onSelectBlock?: (block: Block) => void
	// Optional Cite button slot used by the note view.
	renderActions?: (block: Block) => React.ReactNode
	// blockId → number of notes citing it (drives the inline badge).
	citationCounts?: Map<string, number>
	openPopoverFor?: string | null
	onTogglePopover?: (blockId: string) => void
	onDismissPopover?: () => void
}

const TYPE_LABEL: Record<Block["type"], string> = {
	text: "Paragraph",
	heading: "Heading",
	figure: "Figure",
	table: "Table",
	equation: "Equation",
	list: "List",
	code: "Code",
	other: "Other",
}

// "Parsed blocks" panel sibling to the PDF viewer, modelled on the demo's
// .blocks-list: each block is a card with a type pill, contextual subtitle,
// and a tinted preview of the content. Cards click-to-jump the PDF (state is
// owned upstream); the selected card draws an accent ring and auto-scrolls
// into view when selection changes elsewhere.
export function OcrPane({
	paperId,
	blocks,
	isLoading,
	error,
	currentPage,
	selectedBlockId,
	onSelectBlock,
	renderActions,
	citationCounts,
	openPopoverFor,
	onTogglePopover,
	onDismissPopover,
}: Props) {
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

	const headerLabel = currentPage
		? `Page ${currentPage} · ${blocks?.filter((b) => b.page === currentPage).length ?? 0} blocks`
		: `${blocks?.length ?? 0} blocks`

	if (isLoading) {
		return <div className="p-6 text-sm text-text-tertiary">Loading parsed content…</div>
	}
	if (error) {
		return <div className="p-6 text-sm text-text-error">Failed to load parsed content.</div>
	}
	if (!blocks || blocks.length === 0) {
		return (
			<div className="p-6 text-sm text-text-tertiary">
				No parsed content yet. The paper may still be parsing, or parsing failed.
			</div>
		)
	}

	return (
		<div className="flex h-full min-h-0 flex-col bg-[var(--color-reading-bg,inherit)]">
			<header className="flex shrink-0 items-center justify-between gap-4 border-b border-border-subtle px-4 py-3">
				<div>
					<div className="text-xs font-medium uppercase tracking-[0.16em] text-text-secondary">
						Parsed blocks
					</div>
					<div className="mt-0.5 text-xs text-text-tertiary">
						Click a card to jump the PDF to that block
					</div>
				</div>
				<span className="inline-flex h-6 items-center rounded-full border border-border-subtle bg-bg-primary px-3 text-xs text-text-secondary">
					{headerLabel}
				</span>
			</header>
			<div className="flex-1 overflow-y-auto p-4">
				<div className="grid gap-3">
					{grouped.map(([page, pageBlocks]) => (
						<section className="grid gap-3" key={page}>
							<div className="text-xs uppercase tracking-[0.16em] text-text-tertiary">
								Page {page}
							</div>
							{pageBlocks.map((block) => (
								<BlockCard
									block={block}
									citationCount={citationCounts?.get(block.blockId)}
									isSelected={selectedBlockId === block.blockId}
									key={block.blockId}
									onDismissPopover={onDismissPopover}
									onSelect={onSelectBlock}
									onTogglePopover={onTogglePopover}
									paperId={paperId}
									popoverOpen={openPopoverFor === block.blockId}
									renderActions={renderActions}
								/>
							))}
						</section>
					))}
				</div>
			</div>
		</div>
	)
}

function BlockCard({
	block,
	citationCount,
	isSelected,
	onDismissPopover,
	onSelect,
	onTogglePopover,
	paperId,
	popoverOpen,
	renderActions,
}: {
	block: Block
	citationCount: number | undefined
	isSelected: boolean
	onDismissPopover?: () => void
	onSelect?: (block: Block) => void
	onTogglePopover?: (blockId: string) => void
	paperId: string
	popoverOpen: boolean
	renderActions?: (block: Block) => React.ReactNode
}) {
	const ref = useRef<HTMLDivElement | null>(null)

	useEffect(() => {
		if (!isSelected || !ref.current) return
		ref.current.scrollIntoView({ behavior: "smooth", block: "center" })
	}, [isSelected])

	const subtitle = isSelected
		? "Selected block"
		: block.type === "heading"
			? `Heading${block.headingLevel ? ` · level ${block.headingLevel}` : ""}`
			: block.bbox
				? `Maps to a region on page ${block.page}`
				: `Page ${block.page}`

	return (
		// biome-ignore lint/a11y/useSemanticElements: nesting <figure>/images inside a <button> would break their semantics; role="button" on a <div> is the right escape hatch
		<div
			className={`group cursor-pointer rounded-md border bg-bg-overlay/60 p-4 transition-colors ${
				isSelected
					? "border-border-accent shadow-[inset_0_0_0_1px_var(--color-border-accent)]"
					: "border-border-subtle hover:border-border-default"
			}`}
			onClick={() => onSelect?.(block)}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault()
					onSelect?.(block)
				}
			}}
			ref={ref}
			role="button"
			tabIndex={0}
		>
			<div className="mb-3 flex items-center justify-between gap-2 text-xs text-text-tertiary">
				<div className="flex items-center gap-2">
					<span className="inline-flex h-[22px] items-center rounded-full bg-surface-selected px-3 font-semibold text-text-accent">
						{TYPE_LABEL[block.type]}
					</span>
					<span>{subtitle}</span>
				</div>
				<div className="flex items-center gap-2">
					{citationCount && citationCount > 0 ? (
						<span className="relative">
							<button
								className="rounded-md bg-bg-tertiary px-1.5 py-0.5 text-xs text-text-secondary hover:bg-surface-active"
								onClick={(e) => {
									e.stopPropagation()
									onTogglePopover?.(block.blockId)
								}}
								title={`${citationCount} note${citationCount > 1 ? "s" : ""} cite this block`}
								type="button"
							>
								{citationCount}
							</button>
							{popoverOpen && onDismissPopover ? (
								<BlockCitationsPopover
									blockId={block.blockId}
									onDismiss={onDismissPopover}
									paperId={paperId}
								/>
							) : null}
						</span>
					) : null}
					{renderActions ? (
						<span
							className="opacity-0 transition-opacity group-hover:opacity-100"
							onClickCapture={(e) => e.stopPropagation()}
							onKeyDownCapture={(e) => e.stopPropagation()}
						>
							{renderActions(block)}
						</span>
					) : null}
				</div>
			</div>

			<div className="rounded-sm bg-[color-mix(in_oklch,var(--color-accent-100,#cfe7ea)_42%,white_58%)] p-3 font-serif text-base leading-[1.65] text-text-primary">
				<BlockPreview block={block} />
			</div>
		</div>
	)
}

function BlockPreview({ block }: { block: Block }) {
	switch (block.type) {
		case "heading":
			return <span className="font-semibold">{block.text || "[heading]"}</span>
		case "figure":
		case "table":
			return (
				<div className="flex flex-col items-stretch gap-2">
					{block.imageUrl ? (
						<img
							alt={block.caption ?? `${block.type}`}
							className="mx-auto max-h-[260px] w-auto max-w-full rounded-sm border border-border-subtle bg-bg-primary object-contain"
							loading="lazy"
							src={block.imageUrl}
						/>
					) : (
						<div className="rounded-sm border border-dashed border-border-subtle bg-bg-secondary px-3 py-2 text-xs italic text-text-tertiary">
							[{block.type} — no image extracted]
						</div>
					)}
					{block.caption ? (
						<span className="text-sm text-text-secondary">{block.caption}</span>
					) : null}
				</div>
			)
		case "equation":
		case "code":
			return (
				<pre className="m-0 overflow-x-auto whitespace-pre-wrap font-mono text-sm">
					{block.text || `[${block.type}]`}
				</pre>
			)
		case "list": {
			const items = (block.metadata?.listItems as unknown[] | undefined) ?? []
			if (items.length === 0 && block.text) return <span>{block.text}</span>
			return (
				<ul className="m-0 list-disc pl-5">
					{items.map((item) => (
						<li key={`${block.blockId}-${String(item)}`}>{String(item)}</li>
					))}
				</ul>
			)
		}
		case "other":
			return (
				<span className="text-sm italic text-text-tertiary">{block.text || `[${block.type}]`}</span>
			)
		default:
			return <span>{block.text || "[empty]"}</span>
	}
}
