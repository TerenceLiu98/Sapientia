import type { Block } from "@/api/hooks/blocks"

export function buildAiAskDocument(args: {
	question: string
	selectedText?: string
	answer: string
	paperId: string
	blocksById: Map<string, Block>
}) {
	return {
		type: "doc",
		content: buildAiAskContent(args),
	}
}

export function buildAiAskPendingDocument(args: {
	question: string
	selectedText?: string
}) {
	return {
		type: "doc",
		content: [
			buildQuestionNode(args.question || args.selectedText || ""),
			{
				type: "paragraph",
				content: [
					{
						type: "text",
						text: "Thinking...",
						marks: [{ type: "italic" }],
					},
				],
			},
			{ type: "paragraph" },
		],
	}
}

export function buildAiAskStreamingDocument(args: {
	question: string
	selectedText?: string
	answer: string
}) {
	const answer = args.answer.trim()
	return {
		type: "doc",
		content: [
			buildQuestionNode(args.question || args.selectedText || ""),
			...(answer
				? rawAnswerTextToTiptapNodes(answer)
				: [
						{
							type: "paragraph",
							content: [
								{
									type: "text",
									text: "Thinking...",
									marks: [{ type: "italic" }],
								},
							],
						},
					]),
			{ type: "paragraph" },
		],
	}
}

export function buildAiAskErrorDocument(args: {
	question: string
	selectedText?: string
	error: string
}) {
	return {
		type: "doc",
		content: [
			buildQuestionNode(args.question || args.selectedText || ""),
			{
				type: "paragraph",
				content: [
					{
						type: "text",
						text: `Ask failed: ${args.error}`,
						marks: [{ type: "italic" }],
					},
				],
			},
			{
				type: "paragraph",
				content: [{ type: "text", text: "You can edit this note or ask again." }],
			},
			{ type: "paragraph" },
		],
	}
}

export function buildAiAskContent(args: {
	question: string
	selectedText?: string
	answer: string
	paperId: string
	blocksById: Map<string, Block>
}) {
	return [
		buildQuestionNode(args.question || args.selectedText || ""),
		...answerMarkdownToTiptapNodes({
			markdown: args.answer,
			paperId: args.paperId,
			blocksById: args.blocksById,
		}),
		{ type: "paragraph" },
	]
}

function rawAnswerTextToTiptapNodes(text: string) {
	return text
		.replace(/\r\n/g, "\n")
		.split(/\n{2,}/)
		.map((paragraph) => paragraph.trim())
		.filter(Boolean)
		.map((paragraph) => ({
			type: "paragraph",
			content: [{ type: "text", text: paragraph }],
		}))
}

function buildQuestionNode(text: string) {
	return {
		type: "blockquote",
		content: [
			{
				type: "paragraph",
				content: [{ type: "text", text }],
			},
		],
	}
}

function answerMarkdownToTiptapNodes(args: {
	markdown: string
	paperId: string
	blocksById: Map<string, Block>
}) {
	const lines = args.markdown.replace(/\r\n/g, "\n").split("\n")
	const nodes: Array<Record<string, unknown>> = []
	let paragraphBuffer: string[] = []
	let bulletItems: string[] = []
	let orderedItems: string[] = []

	const flushParagraph = () => {
		const text = paragraphBuffer.join(" ").replace(/\s+/g, " ").trim()
		paragraphBuffer = []
		if (!text) return
		nodes.push({
			type: "paragraph",
			content: parseAnswerInlineContent(text, args),
		})
	}
	const flushBulletItems = () => {
		if (bulletItems.length === 0) return
		nodes.push({
			type: "bulletList",
			content: bulletItems.map((item) => ({
				type: "listItem",
				content: [
					{
						type: "paragraph",
						content: parseAnswerInlineContent(item, args),
					},
				],
			})),
		})
		bulletItems = []
	}
	const flushOrderedItems = () => {
		if (orderedItems.length === 0) return
		nodes.push({
			type: "orderedList",
			content: orderedItems.map((item) => ({
				type: "listItem",
				content: [
					{
						type: "paragraph",
						content: parseAnswerInlineContent(item, args),
					},
				],
			})),
		})
		orderedItems = []
	}
	const flushAll = () => {
		flushParagraph()
		flushBulletItems()
		flushOrderedItems()
	}

	for (const rawLine of lines) {
		const line = rawLine.trim()
		if (!line) {
			flushParagraph()
			continue
		}

		const heading = line.match(/^(#{1,3})\s+(.+)$/)
		if (heading) {
			flushAll()
			nodes.push({
				type: "heading",
				attrs: { level: Math.min(3, heading[1].length) },
				content: parseAnswerInlineContent(heading[2], args),
			})
			continue
		}

		const bullet = line.match(/^[-*]\s+(.+)$/)
		if (bullet) {
			flushParagraph()
			flushOrderedItems()
			bulletItems.push(bullet[1])
			continue
		}

		const ordered = line.match(/^\d+[.)]\s+(.+)$/)
		if (ordered) {
			flushParagraph()
			flushBulletItems()
			orderedItems.push(ordered[1])
			continue
		}

		flushBulletItems()
		flushOrderedItems()
		paragraphBuffer.push(line)
	}

	flushAll()

	return nodes.length > 0
		? nodes
		: [{ type: "paragraph", content: [{ type: "text", text: "(No answer returned.)" }] }]
}

function parseAnswerInlineContent(
	text: string,
	args: { paperId: string; blocksById: Map<string, Block> },
) {
	const nodes: Array<Record<string, unknown>> = []
	const pattern = /(\*\*[^*]+\*\*|\[blk\s+([^\]]+)\])/gi
	let cursor = 0

	for (const match of text.matchAll(pattern)) {
		const index = match.index ?? 0
		if (index > cursor) {
			nodes.push(...parseBoldInlineText(text.slice(cursor, index)))
		}

		const token = match[0]
		const blockIdsText = match[2]
		if (blockIdsText) {
			const blockIds = blockIdsText
				.split(/[,\s]+/)
				.map((blockId) => blockId.trim())
				.filter(Boolean)
			blockIds.forEach((blockId, index) => {
				const block = args.blocksById.get(blockId)
				if (index > 0) nodes.push({ type: "text", text: " " })
				nodes.push({
					type: "blockCitation",
					attrs: {
						paperId: args.paperId,
						blockId,
						blockNumber: block ? block.blockIndex + 1 : 0,
						snapshot: block ? noteBlockCitationSnapshot(block) : "",
					},
				})
			})
		} else if (token.startsWith("**") && token.endsWith("**")) {
			nodes.push({
				type: "text",
				text: token.slice(2, -2),
				marks: [{ type: "bold" }],
			})
		}
		cursor = index + token.length
	}

	if (cursor < text.length) {
		nodes.push(...parseBoldInlineText(text.slice(cursor)))
	}

	return nodes.length > 0 ? nodes : [{ type: "text", text }]
}

function parseBoldInlineText(text: string) {
	const nodes: Array<Record<string, unknown>> = []
	const pattern = /\*\*([^*]+)\*\*/g
	let cursor = 0
	for (const match of text.matchAll(pattern)) {
		const index = match.index ?? 0
		if (index > cursor) nodes.push({ type: "text", text: text.slice(cursor, index) })
		nodes.push({
			type: "text",
			text: match[1],
			marks: [{ type: "bold" }],
		})
		cursor = index + match[0].length
	}
	if (cursor < text.length) nodes.push({ type: "text", text: text.slice(cursor) })
	return nodes
}

function noteBlockCitationSnapshot(block: Block) {
	const raw = (block.caption ?? block.text ?? "").replace(/\s+/g, " ").trim()
	if (!raw) return ""
	return raw.length > 160 ? `${raw.slice(0, 157)}...` : raw
}
