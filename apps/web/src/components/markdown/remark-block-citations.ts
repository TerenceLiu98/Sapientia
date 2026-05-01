const INLINE_CITATION_RE =
	/\[((?:(?:blk|block)\s+[a-zA-Z0-9_-]{6,})(?:\s*[,，]\s*(?:blk|block)\s+[a-zA-Z0-9_-]{6,})+)\]|\[(?:Block|块)\s*#([a-zA-Z0-9_-]+)[:：]\s*([^\]\n]+)\]|\[(?:blk|block)\s+([a-zA-Z0-9_-]+)\]|block:([a-zA-Z0-9_-]+)|\bBlock\s*#([a-zA-Z0-9_-]+)(?=[:：)\],.;，。；、\s]|$)|块\s*#([a-zA-Z0-9_-]+)(?=[:：)\]）】,.;，。；、\s]|$)|\b(?:blk|block)\s+([a-zA-Z0-9_-]{6,})(?=[:：)\],.;，。；、\s]|$)|(^|[^a-zA-Z0-9_])#([a-zA-Z0-9_-]{6,})(?=[:：)\]）】,.;，。；、\s]|$)/gi
const SKIP_CITATION_TYPES = new Set(["code", "inlineCode", "link", "definition", "image", "imageReference"])

type MarkdownNode = {
	type?: string
	value?: string
	url?: string
	title?: string | null
	children?: MarkdownNode[]
}

export function remarkBlockCitations() {
	return (tree: MarkdownNode) => {
		transformCitationNodes(tree)
	}
}

function transformCitationNodes(node: MarkdownNode) {
	if (!Array.isArray(node.children) || SKIP_CITATION_TYPES.has(node.type ?? "")) return

	const nextChildren: MarkdownNode[] = []
	for (const child of node.children) {
		if (child.type === "text" && typeof child.value === "string") {
			nextChildren.push(...splitTextWithCitations(child.value))
			continue
		}
		transformCitationNodes(child)
		nextChildren.push(child)
	}
	node.children = nextChildren
}

function splitTextWithCitations(text: string): MarkdownNode[] {
	const nodes: MarkdownNode[] = []
	let lastIndex = 0

	for (const match of text.matchAll(INLINE_CITATION_RE)) {
		const start = match.index ?? 0
		if (start > lastIndex) {
			nodes.push({ type: "text", value: text.slice(lastIndex, start) })
		}

		const bracketedList = match[1]
		const bracketedBlockId = match[2]
		const bracketedLabel = match[3]
		const shortBlockId = match[4]
		const blockColonId = match[5]
		const englishBlockId = match[6]
		const chineseBlockId = match[7]
		const nakedPrefixedBlockId = match[8]
		const hashPrefix = match[9] ?? ""
		const hashOnlyBlockId = match[10]

		if (hashPrefix) nodes.push({ type: "text", value: hashPrefix })

		if (bracketedList) {
			const ids = Array.from(bracketedList.matchAll(/\b(?:blk|block)\s+([a-zA-Z0-9_-]{6,})\b/gi)).map(
				(item) => item[1],
			)
			ids.forEach((blockId, index) => {
				if (index > 0) nodes.push({ type: "text", value: ", " })
				nodes.push(createCitationLinkNode(blockId))
			})
		} else {
			const blockId =
				bracketedBlockId ??
				shortBlockId ??
				blockColonId ??
				englishBlockId ??
				chineseBlockId ??
				nakedPrefixedBlockId ??
				hashOnlyBlockId
			if (blockId) nodes.push(createCitationLinkNode(blockId))
		}

		if (bracketedLabel) nodes.push({ type: "text", value: `: ${bracketedLabel}` })

		lastIndex = start + match[0].length
	}

	if (lastIndex === 0) return [{ type: "text", value: text }]
	if (lastIndex < text.length) nodes.push({ type: "text", value: text.slice(lastIndex) })
	return nodes
}

function createCitationLinkNode(blockId: string): MarkdownNode {
	return {
		type: "link",
		url: `citation:${blockId}`,
		title: null,
		children: [{ type: "text", value: `[blk ${blockId}]` }],
	}
}
