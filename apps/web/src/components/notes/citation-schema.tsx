import "katex/dist/katex.min.css"
import { mergeAttributes, Node } from "@tiptap/core"
import {
	type NodeViewProps,
	NodeViewWrapper,
	ReactNodeViewRenderer,
} from "@tiptap/react"
import katex from "katex"
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { useHighlights } from "@/api/hooks/highlights"
import { type PaletteEntry, paletteVisualTokens } from "@/lib/highlight-palette"

// Theming context: chip rendering needs the active palette + the workspace
// id to look up highlight colors and the navigation handler to jump to the
// cited block. The Tiptap extensions live above the React tree of the
// editor, so we plumb these through context rather than threading via node
// attributes (which would denormalize the chip's data).
const NoteCitationThemeContext = createContext<{
	onOpenBlock: ((paperId: string, blockId: string) => void) | null
	workspaceId: string | null
	palette: PaletteEntry[]
}>({
	onOpenBlock: null,
	workspaceId: null,
	palette: [],
})

export function NoteCitationThemeProvider({
	children,
	onOpenBlock,
	palette,
	workspaceId,
}: {
	children: React.ReactNode
	onOpenBlock?: (paperId: string, blockId: string) => void
	palette: PaletteEntry[]
	workspaceId: string | null
}) {
	return (
		<NoteCitationThemeContext.Provider
			value={{ onOpenBlock: onOpenBlock ?? null, workspaceId, palette }}
		>
			{children}
		</NoteCitationThemeContext.Provider>
	)
}

// Block citation tag: an inline atom Tiptap node carrying the (paperId,
// blockId, blockNumber, snapshot) tuple. `atom: true` keeps the cursor
// from entering the chip; `selectable: false` prevents the rectangular
// "block selection" outline; `inline: true` makes it eligible to live
// inside a paragraph alongside text marks. Persisted in editor JSON via
// `attrs`, parsed back from `<span data-block-citation>` for HTML paste.
export const BlockCitationNode = Node.create({
	name: "blockCitation",
	group: "inline",
	inline: true,
	atom: true,
	selectable: false,
	draggable: false,

	addAttributes() {
		return {
			paperId: { default: "" },
			blockId: { default: "" },
			blockNumber: { default: 0 },
			snapshot: { default: "" },
		}
	},

	parseHTML() {
		return [{ tag: "span[data-block-citation]" }]
	},

	renderHTML({ HTMLAttributes }) {
		return [
			"span",
			mergeAttributes(HTMLAttributes, { "data-block-citation": "" }),
			"",
		]
	},

	addNodeView() {
		return ReactNodeViewRenderer(BlockCitationView)
	},
})

function BlockCitationView({ node }: NodeViewProps) {
	const paperId = (node.attrs.paperId as string) ?? ""
	const blockId = (node.attrs.blockId as string) ?? ""
	const blockNumber = (node.attrs.blockNumber as number) ?? 0
	const snapshot = (node.attrs.snapshot as string) ?? ""
	return (
		<NodeViewWrapper
			as="span"
			className="note-editor__citation-node"
			contentEditable={false}
		>
			<BlockCitationChip
				blockId={blockId}
				blockNumber={blockNumber}
				paperId={paperId}
				snapshot={snapshot}
			/>
		</NodeViewWrapper>
	)
}

export function BlockCitationChip({
	paperId,
	blockId,
	blockNumber,
	snapshot,
}: {
	paperId: string
	blockId: string
	blockNumber: number
	snapshot: string
}) {
	const numericLabel = blockNumber > 0 ? `block ${blockNumber}` : null
	const fallback = snapshot.length > 0 ? snapshot : `${blockId.slice(0, 6)}…`
	const label = numericLabel ?? fallback
	const { onOpenBlock, workspaceId, palette } = useContext(NoteCitationThemeContext)
	const { data: highlights = [] } = useHighlights(paperId, workspaceId ?? undefined)
	const highlightColor =
		highlights.find((highlight) => highlight.blockId === blockId)?.color ?? null
	const chipColors = highlightColor ? paletteVisualTokens(palette, highlightColor) : null

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: chip behaves like a button but lives inside Tiptap inline content; keyboard activation handled below
		// biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handler is wired alongside the click
		// biome-ignore lint/a11y/useSemanticElements: Tiptap inline content cannot host a real <button>; role="button" on a span is the necessary escape hatch
		<span
			className={`note-editor__citation-tag mx-0.5 cursor-pointer select-none font-sans font-semibold tracking-[-0.015em] transition-colors ${
				chipColors
					? "shadow-sm ring-1 ring-inset ring-current/10 hover:brightness-[0.97]"
					: "bg-accent-700 text-text-inverse hover:bg-accent-800"
			}`}
			contentEditable={false}
			onClick={(e) => {
				e.stopPropagation()
				onOpenBlock?.(paperId, blockId)
			}}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault()
					onOpenBlock?.(paperId, blockId)
				}
			}}
			role="button"
			style={
				chipColors
					? {
							backgroundColor: chipColors.chipBg,
							color: chipColors.chipText,
						}
					: undefined
			}
			tabIndex={0}
			title={`${paperId}#${blockId}`}
		>
			<span className="whitespace-nowrap">{label}</span>
		</span>
	)
}

function renderKatex(latex: string, displayMode: boolean): string {
	if (!latex) return ""
	try {
		return katex.renderToString(latex, {
			displayMode,
			throwOnError: false,
			strict: "ignore",
			output: "htmlAndMathml",
		})
	} catch {
		return ""
	}
}

// Inline math: KaTeX in inline mode. `atom: true` so the chip behaves as
// a single token; the popover-style prompt edits the LaTeX source.
export const MathInlineNode = Node.create({
	name: "math",
	group: "inline",
	inline: true,
	atom: true,
	selectable: false,
	draggable: false,

	addAttributes() {
		return {
			latex: { default: "" },
		}
	},

	parseHTML() {
		return [{ tag: "span[data-inline-math]" }]
	},

	renderHTML({ HTMLAttributes }) {
		return [
			"span",
			mergeAttributes(HTMLAttributes, { "data-inline-math": "" }),
			"",
		]
	},

	addNodeView() {
		return ReactNodeViewRenderer(MathInlineView)
	},
})

function MathInlineView({ node, updateAttributes }: NodeViewProps) {
	const latex = (node.attrs.latex as string) ?? ""
	return (
		<NodeViewWrapper as="span" className="inline" contentEditable={false}>
			<MathInlineChip
				latex={latex}
				onChange={(next) => updateAttributes({ latex: next })}
			/>
		</NodeViewWrapper>
	)
}

function MathInlineChip({ latex, onChange }: { latex: string; onChange: (s: string) => void }) {
	const [editing, setEditing] = useState(latex.length === 0)
	const [draft, setDraft] = useState(latex)
	const inputRef = useRef<HTMLInputElement | null>(null)

	useEffect(() => {
		if (!editing) setDraft(latex)
	}, [editing, latex])

	useEffect(() => {
		if (!editing) return
		inputRef.current?.focus()
		inputRef.current?.select()
	}, [editing])

	const commit = useCallback(
		(next: string) => {
			const normalized = next.trim()
			queueMicrotask(() => onChange(normalized))
			setEditing(false)
		},
		[onChange],
	)

	const html = renderKatex(latex, false)

	if (editing) {
		return (
			<span
				className="note-editor__inline-math-editor mx-0.5 inline-flex items-center rounded-md border border-border-subtle bg-bg-primary px-1 py-0.5 align-baseline"
				contentEditable={false}
				onMouseDown={(e) => {
					e.preventDefault()
					e.stopPropagation()
				}}
			>
				<input
					className="note-editor__inline-math-input min-w-[5ch] border-0 bg-transparent font-mono text-sm text-text-primary outline-none"
					onBlur={() => commit(draft)}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault()
							e.stopPropagation()
							commit(draft)
							return
						}
						if (e.key === "Escape") {
							e.preventDefault()
							e.stopPropagation()
							setDraft(latex)
							setEditing(false)
						}
					}}
					placeholder="LaTeX"
					ref={inputRef}
					size={Math.max(5, draft.length || 0)}
					value={draft}
				/>
			</span>
		)
	}

	return (
		<button
			className="mx-0.5 inline-flex cursor-pointer items-center rounded-md border border-border-subtle/70 bg-transparent px-1 py-0.5 align-baseline text-sm text-text-primary hover:bg-surface-hover"
			contentEditable={false}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault()
					e.stopPropagation()
					setEditing(true)
				}
			}}
			onMouseDown={(e) => {
				e.preventDefault()
				e.stopPropagation()
			}}
			onClick={(e) => {
				e.stopPropagation()
				setEditing(true)
			}}
			title={latex || "Empty inline math — click to edit"}
			type="button"
		>
			{latex.length === 0 ? (
				<span className="italic text-text-tertiary">math</span>
			) : html ? (
				// biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output is sanitized; latex source is user-owned content
				<span dangerouslySetInnerHTML={{ __html: html }} />
			) : (
				<span className="text-text-error">{`$${latex}$`}</span>
			)}
		</button>
	)
}

// Block math: KaTeX display mode, with a textarea/preview split when
// editing. Auto-enters edit mode if latex is empty (just inserted via
// slash command or `$$` markdown shortcut).
export const MathBlockNode = Node.create({
	name: "mathBlock",
	group: "block",
	atom: true,
	draggable: true,
	selectable: true,

	addAttributes() {
		return {
			latex: { default: "" },
		}
	},

	parseHTML() {
		return [{ tag: "div[data-math-block]" }]
	},

	renderHTML({ HTMLAttributes }) {
		return [
			"div",
			mergeAttributes(HTMLAttributes, { "data-math-block": "" }),
			"",
		]
	},

	addNodeView() {
		return ReactNodeViewRenderer(MathBlockView)
	},
})

function MathBlockView({ node, updateAttributes }: NodeViewProps) {
	const latex = (node.attrs.latex as string) ?? ""
	return (
		<NodeViewWrapper className="block" contentEditable={false}>
			<MathBlockBody latex={latex} onChange={(next) => updateAttributes({ latex: next })} />
		</NodeViewWrapper>
	)
}

function MathBlockBody({ latex, onChange }: { latex: string; onChange: (s: string) => void }) {
	const [editing, setEditing] = useState(latex.length === 0)
	const [draft, setDraft] = useState(latex)
	const textRef = useRef<HTMLTextAreaElement | null>(null)
	const draftRef = useRef(draft)
	const committingRef = useRef(false)
	draftRef.current = draft

	useEffect(() => {
		if (!editing) setDraft(latex)
	}, [editing, latex])

	useEffect(() => {
		if (editing) textRef.current?.focus()
	}, [editing])

	const commit = useCallback(
		(next: string) => {
			if (committingRef.current) return
			committingRef.current = true
			// Defer Tiptap mutation to the next tick so we don't collide with
			// any in-flight ProseMirror transaction.
			queueMicrotask(() => onChange(next))
			setEditing(false)
			queueMicrotask(() => {
				committingRef.current = false
			})
		},
		[onChange],
	)

	// Native capture-phase listener: blocks Cmd+Enter / Esc from reaching
	// Tiptap, AND swallows plain Enter so it stays a textarea newline
	// rather than splitting the surrounding block.
	useEffect(() => {
		if (!editing) return
		const ta = textRef.current
		if (!ta) return
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault()
				e.stopImmediatePropagation()
				commit(draftRef.current)
				return
			}
			if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault()
				e.stopImmediatePropagation()
				commit(draftRef.current)
				return
			}
			// Plain Enter: don't preventDefault (let textarea insert \n),
			// but stop propagation so Tiptap doesn't see it.
			if (e.key === "Enter") e.stopImmediatePropagation()
		}
		ta.addEventListener("keydown", handler, { capture: true })
		return () => ta.removeEventListener("keydown", handler, { capture: true })
	}, [editing, commit])

	const html = renderKatex(latex, true)

	return (
		<div className="my-2 rounded-md border border-border-subtle bg-bg-overlay/60">
			{editing ? (
				<div className="flex flex-col gap-2 p-3">
					<textarea
						className="min-h-[60px] w-full resize-y rounded-sm border border-border-subtle bg-bg-primary p-2 font-mono text-sm text-text-primary outline-none focus:border-accent-500"
						onBlur={() => commit(draft)}
						onChange={(e) => setDraft(e.target.value)}
						placeholder="LaTeX (e.g. \\sum_{i=1}^n x_i)"
						ref={textRef}
						value={draft}
					/>
					<div className="text-xs text-text-tertiary">
						Cmd/Ctrl+Enter to save · Esc to save · click outside to save
					</div>
				</div>
			) : (
				<button
					className="flex w-full cursor-pointer items-center justify-center px-3 py-3 text-text-primary hover:bg-surface-hover"
					onClick={(e) => {
						e.stopPropagation()
						setDraft(latex)
						setEditing(true)
					}}
					title="Click to edit"
					type="button"
				>
					{latex.length === 0 ? (
						<span className="italic text-text-tertiary">Empty math block — click to edit</span>
					) : html ? (
						// biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX renders user content; we don't trust it as HTML beyond what KaTeX sanitizes
						<span dangerouslySetInnerHTML={{ __html: html }} />
					) : (
						<pre className="font-mono text-sm text-text-error">{latex}</pre>
					)}
				</button>
			)}
		</div>
	)
}
