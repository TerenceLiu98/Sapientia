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
				.map((phrase) => `"${sanitizePromptText(phrase)}"`)
				.join(", ")
			if (phrases) lines.push(`USER MARKED AS ${color.toUpperCase()}: ${phrases}`)
		}
	}

	lines.push(formatBlockBody(block.text))
	const body = lines.join("\n")
	return isFocus ? `<focus>\n${body}\n</focus>` : body
}

function formatBlockBody(text: string) {
	const sanitized = sanitizePromptText(text)
	const fence = "`".repeat(Math.max(3, longestBacktickRun(sanitized) + 1))
	return [fence, sanitized, fence].join("\n")
}

function sanitizePromptText(text: string) {
	return text.replace(/<\/?(think|short|system|user|assistant|tool_call|tool|function)>/gi, (token) =>
		token.replace("<", "〈").replace(">", "〉"),
	)
}

function longestBacktickRun(text: string) {
	let longest = 0
	let current = 0
	for (const char of text) {
		if (char === "`") {
			current += 1
			longest = Math.max(longest, current)
			continue
		}
		current = 0
	}
	return longest
}
