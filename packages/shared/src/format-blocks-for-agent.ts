export interface BlockForContext {
	blockId: string
	type: string
	text: string
	headingLevel?: number | null
}

export interface HighlightForContext {
	blockId: string
	selectedText: string
	color: string
}

export function formatBlocksForAgent(args: {
	blocks: BlockForContext[]
	highlights: HighlightForContext[]
	focusBlockId?: string | null
}): string {
	const byBlock = new Map<string, HighlightForContext[]>()
	for (const highlight of args.highlights) {
		const list = byBlock.get(highlight.blockId) ?? []
		list.push(highlight)
		byBlock.set(highlight.blockId, list)
	}

	return args.blocks
		.map((block) =>
			formatOne(block, byBlock.get(block.blockId) ?? [], args.focusBlockId === block.blockId),
		)
		.join("\n\n")
}

function formatOne(
	block: BlockForContext,
	highlights: HighlightForContext[],
	isFocus: boolean,
): string {
	const lines: string[] = []
	const typeLabel = block.headingLevel ? `H${block.headingLevel} heading` : block.type
	lines.push(`[Block #${block.blockId}: ${typeLabel}]`)

	if (highlights.length > 0) {
		const byColor = new Map<string, HighlightForContext[]>()
		for (const highlight of highlights) {
			const list = byColor.get(highlight.color) ?? []
			list.push(highlight)
			byColor.set(highlight.color, list)
		}

		for (const [color, items] of byColor) {
			const phrases = [...new Set(items.map((item) => item.selectedText.trim()).filter(Boolean))]
				.map((phrase) => `"${phrase}"`)
				.join(", ")
			if (phrases) lines.push(`USER MARKED AS ${color.toUpperCase()}: ${phrases}`)
		}
	}

	lines.push(block.text)
	const body = lines.join("\n")
	return isFocus ? `<focus>\n${body}\n</focus>` : body
}
