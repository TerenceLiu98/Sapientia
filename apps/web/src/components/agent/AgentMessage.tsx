import { useMemo } from "react"
import { MarkdownProse } from "../markdown/MarkdownProse"
import type { AgentUIMessage } from "./types"

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
			<MarkdownProse
				blockNumberByBlockId={blockNumberByBlockId}
				className="agent-markdown text-sm leading-6 text-text-primary"
				markdown={text}
				onOpenBlock={onOpenBlock}
			/>
		</div>
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
