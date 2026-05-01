import type { Components } from "react-markdown"
import { defaultUrlTransform } from "react-markdown"
import { withMarkdownMath } from "./markdown-math"

function ReaderCitationChip({
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
			className="note-editor__citation-tag markdown-prose__citation-tag mx-0.5 cursor-pointer select-none font-sans font-semibold tracking-[-0.015em] transition-colors hover:brightness-[0.97]"
			onClick={() => onOpenBlock(blockId)}
			title={`block ${blockId}`}
			type="button"
		>
			<span className="whitespace-nowrap">{label}</span>
		</button>
	)
}

export function createProseComponents({
	onOpenBlock,
	blockNumberByBlockId,
}: {
	onOpenBlock?: (blockId: string) => void
	blockNumberByBlockId?: Map<string, number>
} = {}): Components {
	return {
		a({ href, children }) {
			if (href?.startsWith("citation:") && onOpenBlock) {
				const blockId = href.slice("citation:".length)
				return (
					<ReaderCitationChip
						blockId={blockId}
						blockNumber={blockNumberByBlockId?.get(blockId) ?? null}
						onOpenBlock={onOpenBlock}
					/>
				)
			}
			return (
				<a
					className="markdown-prose__link"
					href={href}
					rel="noopener noreferrer"
					target="_blank"
				>
					{children}
				</a>
			)
		},
		p({ children }) {
			return <p className="markdown-prose__p">{withMarkdownMath(children)}</p>
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
					<code className="markdown-prose__code-inline" {...props}>
						{children}
					</code>
				)
			}
			return (
				<code className={`${className ?? ""} markdown-prose__code-block`} {...props}>
					{children}
				</code>
			)
		},
		pre({ children }) {
			return <pre className="markdown-prose__pre">{children}</pre>
		},
		ul({ children }) {
			return <ul className="markdown-prose__ul">{children}</ul>
		},
		ol({ children }) {
			return <ol className="markdown-prose__ol">{children}</ol>
		},
		li({ children }) {
			return <li className="markdown-prose__li">{withMarkdownMath(children)}</li>
		},
		blockquote({ children }) {
			return <blockquote className="markdown-prose__blockquote">{withMarkdownMath(children)}</blockquote>
		},
		h1({ children }) {
			return <h1 className="markdown-prose__h1">{withMarkdownMath(children)}</h1>
		},
		h2({ children }) {
			return <h2 className="markdown-prose__h2">{withMarkdownMath(children)}</h2>
		},
		h3({ children }) {
			return <h3 className="markdown-prose__h3">{withMarkdownMath(children)}</h3>
		},
		table({ children }) {
			return (
				<div className="markdown-prose__table-wrap">
					<table className="markdown-prose__table">{children}</table>
				</div>
			)
		},
		thead({ children }) {
			return <thead className="markdown-prose__thead">{children}</thead>
		},
		th({ children }) {
			return <th className="markdown-prose__th">{withMarkdownMath(children)}</th>
		},
		td({ children }) {
			return <td className="markdown-prose__td">{withMarkdownMath(children)}</td>
		},
		hr() {
			return <hr className="markdown-prose__hr" />
		},
	}
}

export function proseUrlTransform(url: string) {
	return url.startsWith("citation:") ? url : defaultUrlTransform(url)
}
