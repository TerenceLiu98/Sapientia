import { useMemo } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { createProseComponents, proseUrlTransform } from "./markdown-components"
import { remarkBlockCitations } from "./remark-block-citations"

export function MarkdownProse({
	markdown,
	className = "",
	onOpenBlock,
	blockNumberByBlockId,
}: {
	markdown: string
	className?: string
	onOpenBlock?: (blockId: string) => void
	blockNumberByBlockId?: Map<string, number>
}) {
	const components = useMemo(
		() => createProseComponents({ onOpenBlock, blockNumberByBlockId }),
		[blockNumberByBlockId, onOpenBlock],
	)

	return (
		<div className={`markdown-prose text-sm leading-6 text-text-primary ${className}`.trim()}>
			<Markdown
				remarkPlugins={[remarkGfm, remarkBlockCitations]}
				urlTransform={proseUrlTransform}
				components={components}
			>
				{markdown}
			</Markdown>
		</div>
	)
}
