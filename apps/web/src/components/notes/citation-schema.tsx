import "katex/dist/katex.min.css"
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core"
import { createReactBlockSpec, createReactInlineContentSpec } from "@blocknote/react"
import katex from "katex"
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { useHighlights } from "@/api/hooks/highlights"
import { type PaletteEntry, paletteVisualTokens } from "@/lib/highlight-palette"

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

// Custom BlockNote inline content for "this note cites paper X block Y".
// The chip displays `@[block N]` where N is the block's 1-based index in
// its paper — a precise pointer back to the source. The leading `@`
// hints "this is a reference, click for context" without needing a
// tutorial. Storing the number alongside the IDs keeps the chip stable
// and resolvable even if the paper isn't loaded when the note re-renders.
//
// `snapshot` is kept on the prop schema for backwards compatibility with
// notes saved before TASK-017's redesign — older chips will still carry
// it, and the renderer falls back to it if `blockNumber` isn't present.
export const blockCitationSpec = createReactInlineContentSpec(
	{
		type: "blockCitation",
		propSchema: {
			paperId: { default: "" },
			blockId: { default: "" },
			blockNumber: { default: 0 },
			snapshot: { default: "" },
		},
		content: "none",
	},
	{
		render: ({ inlineContent }) => {
			const { paperId, blockId, blockNumber, snapshot } = inlineContent.props
			return (
				<BlockCitationChip
					blockId={blockId}
					blockNumber={typeof blockNumber === "number" ? blockNumber : 0}
					paperId={paperId}
					snapshot={typeof snapshot === "string" ? snapshot : ""}
				/>
			)
		},
	},
)

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
		// biome-ignore lint/a11y/noStaticElementInteractions: chip behaves like a button but must be a span to live inside BlockNote inline content; keyboard activation handled below
		// biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handler is wired alongside the click
		// biome-ignore lint/a11y/useSemanticElements: BlockNote inline content cannot host a real <button>; role="button" on a span is the necessary escape hatch
		<span
			className={`relative mx-0.5 inline-flex cursor-pointer select-none items-center rounded-md px-1.5 py-0.5 align-baseline text-sm transition-colors ${
				chipColors
					? "ring-1 ring-inset ring-current/10 hover:brightness-[0.97]"
					: "bg-accent-100 text-accent-700 hover:bg-accent-200"
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
			<span className={chipColors ? "opacity-70" : "text-accent-500"}>@[</span>
			<span>{label}</span>
			<span className={chipColors ? "opacity-70" : "text-accent-500"}>]</span>
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

// Inline math: LaTeX rendered with KaTeX inline mode. Click the chip to edit
// the source in a popover-style input; blur saves. Empty source shows a
// placeholder so the chip never collapses to zero width.
export const mathInlineSpec = createReactInlineContentSpec(
	{
		type: "math",
		propSchema: {
			latex: { default: "" },
		},
		content: "none",
	},
	{
		render: ({ inlineContent, updateInlineContent }) => {
			const latex = inlineContent.props.latex
			return (
				<MathInlineChip
					latex={latex}
					onChange={(next) => updateInlineContent({ props: { latex: next } } as never)}
				/>
			)
		},
	},
)

function MathInlineChip({ latex, onChange }: { latex: string; onChange: (s: string) => void }) {
	const openEditor = useCallback(() => {
		const next = window.prompt("Inline math (LaTeX)", latex)
		if (next === null || next === latex) return
		queueMicrotask(() => onChange(next))
	}, [latex, onChange])

	const html = renderKatex(latex, false)
	return (
		<button
			className="mx-0.5 inline-flex cursor-pointer items-center rounded-md bg-accent-100 px-1 py-0.5 align-baseline text-sm text-accent-800 hover:bg-accent-200"
			contentEditable={false}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault()
					e.stopPropagation()
					openEditor()
				}
			}}
			onMouseDown={(e) => {
				e.preventDefault()
				e.stopPropagation()
			}}
			onClick={(e) => {
				e.stopPropagation()
				openEditor()
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

// Block math: KaTeX displayed mode, with a textarea/preview split when
// editing. Auto-enters edit mode if latex is empty (just inserted).
export const mathBlockSpec = createReactBlockSpec(
	{
		type: "mathBlock",
		propSchema: {
			latex: { default: "" },
		},
		content: "none",
	},
	{
		render: ({ block, editor }) => {
			const latex = (block.props as { latex?: string }).latex ?? ""
			const setLatex = (next: string) =>
				editor.updateBlock(block, { props: { latex: next } } as never)
			return <MathBlockBody latex={latex} onChange={setLatex} />
		},
	},
)

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
			// Same rationale as MathInlineChip — defer the BlockNote mutation past
			// the current event-loop tick so we don't collide with ProseMirror.
			queueMicrotask(() => onChange(next))
			setEditing(false)
			queueMicrotask(() => {
				committingRef.current = false
			})
		},
		[onChange],
	)

	// Native capture-phase listener: blocks Cmd+Enter / Esc from reaching
	// BlockNote, AND swallows plain Enter so it stays a textarea newline
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
			// but stop propagation so BlockNote doesn't see it.
			if (e.key === "Enter") e.stopImmediatePropagation()
		}
		ta.addEventListener("keydown", handler, { capture: true })
		return () => ta.removeEventListener("keydown", handler, { capture: true })
	}, [editing, commit])

	const html = renderKatex(latex, true)

	return (
		<div
			className="my-2 rounded-md border border-border-subtle bg-bg-overlay/60"
			contentEditable={false}
		>
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

// `createReactBlockSpec` returns a factory `(options?) => BlockSpec`; the
// schema wants the spec itself, so we invoke it once here. (Inline content
// helpers return the spec directly, no parens.)
export const noteSchema = BlockNoteSchema.create({
	inlineContentSpecs: {
		...defaultInlineContentSpecs,
		blockCitation: blockCitationSpec,
		math: mathInlineSpec,
	},
	blockSpecs: {
		...defaultBlockSpecs,
		mathBlock: mathBlockSpec(),
	},
})
