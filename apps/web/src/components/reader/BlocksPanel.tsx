import { useMemo } from "react"
import { type Block, useBlocks } from "@/api/hooks/blocks"

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
	onSelectBlock?: (block: Block) => void
	// Optional render slot the citation flow (TASK-013) hooks into.
	renderActions?: (block: Block) => React.ReactNode
}

export function BlocksPanel({ paperId, currentPage, onSelectBlock, renderActions }: Props) {
	const { data: blocks, isLoading, error } = useBlocks(paperId)

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

	return (
		<div className="h-full overflow-y-auto p-3">
			<div className="mb-3 px-1.5 text-xs uppercase tracking-[0.16em] text-text-secondary">
				Blocks ({blocks.length})
			</div>
			{grouped.map(([page, pageBlocks]) => (
				<div className="mb-4" key={page}>
					<div
						className={`mb-1 inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
							currentPage === page ? "bg-surface-selected text-text-accent" : "text-text-secondary"
						}`}
					>
						Page {page}
					</div>
					<div className="space-y-1">
						{pageBlocks.map((block) => (
							<BlockRow
								block={block}
								key={block.blockId}
								onSelect={onSelectBlock}
								renderActions={renderActions}
							/>
						))}
					</div>
				</div>
			))}
		</div>
	)
}

function BlockRow({
	block,
	onSelect,
	renderActions,
}: {
	block: Block
	onSelect?: (block: Block) => void
	renderActions?: (block: Block) => React.ReactNode
}) {
	const preview = useMemo(() => {
		const text = block.caption ?? block.text
		if (!text) return `[${block.type}]`
		return text.length > 100 ? `${text.slice(0, 100)}…` : text
	}, [block])

	const styleByType =
		block.type === "heading"
			? "font-medium text-text-primary"
			: block.type === "other"
				? "text-text-tertiary italic"
				: "text-text-secondary"

	return (
		<div className="group flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-hover">
			<button
				className="flex flex-1 items-start gap-2 text-left"
				onClick={() => onSelect?.(block)}
				type="button"
			>
				<span className="mt-0.5 w-4 shrink-0 text-xs text-text-tertiary">
					{TYPE_GLYPH[block.type]}
				</span>
				<span className={styleByType}>{preview}</span>
			</button>
			{renderActions ? (
				<span className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
					{renderActions(block)}
				</span>
			) : null}
		</div>
	)
}
