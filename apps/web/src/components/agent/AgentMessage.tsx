import { type ReactNode, useMemo } from "react"
import type { AgentUIMessage } from "./types"

const BLOCK_CITATION_RE = /\[(?:blk|block)\s+([a-zA-Z0-9_-]+)\]|block:([a-zA-Z0-9_-]+)/g

export function AgentMessage({
	message,
	onOpenBlock,
}: {
	message: AgentUIMessage
	onOpenBlock: (blockId: string) => void
}) {
	const text = useMemo(() => getMessageText(message), [message])
	const toneClass =
		message.role === "assistant"
			? "border-border-subtle bg-bg-primary text-text-primary"
			: "border-accent-200 bg-accent-50/60 text-text-primary"

	return (
		<div className={`rounded-2xl border px-4 py-3 ${toneClass}`}>
			<div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-text-secondary">
				{message.role === "assistant" ? "Agent" : "You"}
			</div>
			<div className="space-y-3 text-sm leading-6 text-text-primary">
				{renderParagraphs(text, onOpenBlock)}
			</div>
		</div>
	)
}

function renderParagraphs(text: string, onOpenBlock: (blockId: string) => void) {
	return text.split(/\n{2,}/).map((paragraph, index) => (
		<p className="whitespace-pre-wrap" key={`para-${index}`}>
			{renderInline(paragraph, onOpenBlock)}
		</p>
	))
}

function renderInline(text: string, onOpenBlock: (blockId: string) => void) {
	const output: ReactNode[] = []
	let lastIndex = 0

	for (const match of text.matchAll(BLOCK_CITATION_RE)) {
		const full = match[0]
		const blockId = match[1] ?? match[2]
		const start = match.index ?? 0
		if (start > lastIndex) output.push(text.slice(lastIndex, start))
		output.push(
			<button
				className="mx-1 inline-flex rounded-full border border-border-default bg-bg-secondary px-2 py-0.5 align-middle text-xs font-medium text-text-accent hover:bg-surface-hover"
				key={`${blockId}-${start}`}
				onClick={() => onOpenBlock(blockId)}
				type="button"
			>
				[blk {blockId}]
			</button>,
		)
		lastIndex = start + full.length
	}

	if (lastIndex < text.length) output.push(text.slice(lastIndex))
	return output.length > 0 ? output : text
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
