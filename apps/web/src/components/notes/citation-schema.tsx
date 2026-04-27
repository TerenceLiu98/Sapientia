import "katex/dist/katex.min.css"
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core"
import { createReactBlockSpec, createReactInlineContentSpec } from "@blocknote/react"
import katex from "katex"
import { useCallback, useEffect, useRef, useState } from "react"

// Custom BlockNote inline content for "this note cites paper X block Y".
// `snapshot` is captured at insert time so the chip stays meaningful even
// if the underlying block is re-parsed away.
//
// We use `createReactInlineContentSpec` from `@blocknote/react` (vs the
// DOM-level helper in `@blocknote/core`) so we can render the chip with
// JSX and Tailwind classes.
export const blockCitationSpec = createReactInlineContentSpec(
	{
		type: "blockCitation",
		propSchema: {
			paperId: { default: "" },
			blockId: { default: "" },
			snapshot: { default: "" },
		},
		content: "none",
	},
	{
		render: ({ inlineContent }) => {
			const { paperId, blockId, snapshot } = inlineContent.props
			const label = snapshot && snapshot.length > 0 ? snapshot : `${blockId.slice(0, 6)}…`
			return (
				<span
					className="mx-0.5 inline-flex max-w-[280px] cursor-default items-center gap-1 rounded-md bg-accent-100 px-1.5 py-0.5 align-baseline text-sm text-accent-700"
					contentEditable={false}
					title={`${paperId}#${blockId}`}
				>
					<span className="text-accent-500">¶</span>
					<span className="truncate">{label}</span>
				</span>
			)
		},
	},
)

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
