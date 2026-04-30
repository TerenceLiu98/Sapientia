import { useMemo } from "react"
import Markdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import type { AgentUIMessage } from "./types"

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

function remarkBlockCitations() {
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

		if (hashPrefix) {
			nodes.push({ type: "text", value: hashPrefix })
		}

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

export function AgentMessage({
	message,
	onOpenBlock,
	blockNumberByBlockId,
}: {
	message: AgentUIMessage
	onOpenBlock: (blockId: string) => void
	blockNumberByBlockId?: Map<string, number>
}) {
	const text = useMemo(() => getMessageText(message), [message])
	const toneClass =
		message.role === "assistant"
			? "border-border-subtle bg-bg-primary text-text-primary"
			: "border-accent-200 bg-accent-50/60 text-text-primary"

	if (message.role !== "assistant") {
		return (
			<div className={`rounded-2xl border px-4 py-3 ${toneClass}`}>
				<div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-text-secondary">
					You
				</div>
				<div className="whitespace-pre-wrap text-sm leading-6 text-text-primary">{text}</div>
			</div>
		)
	}

	return (
		<div className={`rounded-2xl border px-4 py-3 ${toneClass}`}>
			<div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-text-secondary">
				Agent
			</div>
			<div className="agent-markdown text-sm leading-6 text-text-primary">
				<Markdown
					remarkPlugins={[remarkGfm, remarkBlockCitations]}
					urlTransform={(url) =>
						url.startsWith("citation:") ? url : defaultUrlTransform(url)
					}
					components={{
						a({ href, children }) {
							if (href?.startsWith("citation:")) {
								const blockId = href.slice("citation:".length)
								return (
									<CitationChip
										blockId={blockId}
										blockNumber={blockNumberByBlockId?.get(blockId) ?? null}
										onOpenBlock={onOpenBlock}
									/>
								)
							}
							return (
								<a
									className="text-text-accent hover:underline"
									href={href}
									rel="noopener noreferrer"
									target="_blank"
								>
									{children}
								</a>
							)
						},
						p({ children }) {
							return <p className="mb-3 last:mb-0">{children}</p>
						},
						strong({ children }) {
							return <strong className="font-semibold">{children}</strong>
						},
						em({ children }) {
							return <em className="italic">{children}</em>
						},
						code({ className, children, ...props }) {
							const isInline = !className
							if (isInline) {
								return (
									<code
										className="rounded bg-bg-secondary px-1.5 py-0.5 font-mono text-[13px]"
										{...props}
									>
										{children}
									</code>
								)
							}
							return (
								<code className={`${className ?? ""} font-mono text-[13px]`} {...props}>
									{children}
								</code>
							)
						},
						pre({ children }) {
							return (
								<pre className="my-3 overflow-x-auto rounded-lg bg-bg-secondary p-3 text-[13px] leading-5">
									{children}
								</pre>
							)
						},
						ul({ children }) {
							return <ul className="mb-3 ml-5 list-disc space-y-1 last:mb-0">{children}</ul>
						},
						ol({ children }) {
							return (
								<ol className="mb-3 ml-5 list-decimal space-y-1 last:mb-0">{children}</ol>
							)
						},
						li({ children }) {
							return <li>{children}</li>
						},
						blockquote({ children }) {
							return (
								<blockquote className="my-3 border-l-3 border-border-subtle pl-4 text-text-secondary italic">
									{children}
								</blockquote>
							)
						},
						h1({ children }) {
							return <h1 className="mb-3 mt-4 text-lg font-bold first:mt-0">{children}</h1>
						},
						h2({ children }) {
							return <h2 className="mb-2 mt-4 text-base font-bold first:mt-0">{children}</h2>
						},
						h3({ children }) {
							return <h3 className="mb-2 mt-3 text-sm font-bold first:mt-0">{children}</h3>
						},
						table({ children }) {
							return (
								<div className="my-3 overflow-x-auto">
									<table className="w-full border-collapse border border-border-default text-[13px]">
										{children}
									</table>
								</div>
							)
						},
						thead({ children }) {
							return <thead className="bg-bg-secondary">{children}</thead>
						},
						th({ children }) {
							return (
								<th className="border border-border-default px-3 py-2 text-left font-semibold">
									{children}
								</th>
							)
						},
						td({ children }) {
							return (
								<td className="border border-border-default px-3 py-2">{children}</td>
							)
						},
						hr() {
							return <hr className="my-4 border-border-subtle" />
						},
					}}
				>
					{text}
				</Markdown>
			</div>
		</div>
	)
}

function CitationChip({
	blockId,
	blockNumber,
	onOpenBlock,
}: {
	blockId: string
	blockNumber: number | null
	onOpenBlock: (blockId: string) => void
}) {
	const label = blockNumber && blockNumber > 0 ? `block ${blockNumber}` : `[blk ${blockId}]`

	return (
		<button
			className="note-editor__citation-tag mx-0.5 cursor-pointer select-none font-sans font-semibold tracking-[-0.015em] bg-accent-700 text-text-inverse shadow-sm ring-1 ring-inset ring-current/10 transition-colors hover:brightness-[0.97]"
			onClick={() => onOpenBlock(blockId)}
			title={`block ${blockId}`}
			type="button"
		>
			<span className="whitespace-nowrap">{label}</span>
		</button>
	)
}

function getMessageText(message: AgentUIMessage) {
	if (message.parts.length === 0) return ""
	return message.parts
		.map((part) => {
			if (part.type === "text") return part.text
			return ""
		})
		.join("")
}
