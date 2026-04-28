import "@blocknote/mantine/style.css"
import { type Block, filterSuggestionItems } from "@blocknote/core"
import { BlockNoteView } from "@blocknote/mantine"
import {
	type DefaultReactSuggestionItem,
	getDefaultReactSlashMenuItems,
	SuggestionMenuController,
	useCreateBlockNote,
} from "@blocknote/react"
import type { ReactNode } from "react"
import { useEffect, useRef, useState } from "react"
import { useNote, useUpdateNote } from "@/api/hooks/notes"
import { usePalette } from "@/lib/highlight-palette"
import { NoteCitationThemeProvider, noteSchema } from "./citation-schema"

type SaveStatus = "idle" | "saving" | "saved" | "failed"

const AUTOSAVE_DEBOUNCE_MS = 1500

// Loose alias — BlockNote's editor type fully parametrized by our schema is
// noisy and only the paper-side note route actually consumes it. We expose
// the schema's BlockNoteEditor instead of trying to chase
// useCreateBlockNote's generics.
export type NoteEditorRef = typeof noteSchema.BlockNoteEditor

// Markdown-shortcut: the user types "$$" in a paragraph block, and we
// replace that paragraph with an empty math block (which auto-enters edit
// mode because its latex is empty). Triggered from the editor's onChange so
// it fires the moment the second `$` lands, not on Enter.
//
// We type the editor loosely (`unknown`) here because BlockNote's generics
// don't flow through `useCreateBlockNote` cleanly with our custom schema.
// The runtime contract — `replaceBlocks([Block], [PartialBlock])` — is
// stable across BlockNote versions; the wrapper just narrows what we touch.
function tryUpgradeMathShortcut(editor: unknown) {
	const ed = editor as {
		getTextCursorPosition: () => {
			block: { type?: string; content?: unknown }
		}
		replaceBlocks: (existing: unknown[], next: unknown[]) => void
	}
	const block = ed.getTextCursorPosition().block
	if (!block || block.type !== "paragraph") return
	const content = Array.isArray(block.content)
		? (block.content as Array<{ type?: string; text?: string }>)
		: []
	if (content.length !== 1) return
	const item = content[0]
	if (!item || item.type !== "text" || item.text !== "$$") return
	ed.replaceBlocks([block], [{ type: "mathBlock", props: { latex: "" } }])
}

// Default slash items + our math additions. The `aliases` are what the user
// can type after `/` to filter; e.g. /math, /equation, /latex all match.
//
// We defer the actual insert via queueMicrotask: BlockNote's
// SuggestionMenuController is mid-transaction (deleting the "/query" trigger
// text) when onItemClick fires synchronously. Mutating the editor at that
// moment can race with the cleanup transaction and throw "Block doesn't have
// id". One microtask later, the slash text is gone and the cursor position
// is stable, so the insert lands cleanly.
function getMathSlashItems(editor: NoteEditorRef): DefaultReactSuggestionItem[] {
	const defaults = getDefaultReactSlashMenuItems(editor as never)
	const ed = editor as {
		getTextCursorPosition: () => { block: unknown }
		insertBlocks: (
			blocks: unknown[],
			reference: unknown,
			placement: "before" | "after" | "nested",
		) => void
		insertInlineContent: (content: unknown[]) => void
	}

	const insertMathBlock: DefaultReactSuggestionItem = {
		title: "Math block",
		subtext: "Display LaTeX equation",
		aliases: ["math", "equation", "latex", "$$"],
		group: "Other",
		icon: <span className="font-serif text-sm">∑</span>,
		onItemClick: () => {
			queueMicrotask(() => {
				const cursor = ed.getTextCursorPosition()
				ed.insertBlocks([{ type: "mathBlock", props: { latex: "" } }], cursor.block, "after")
			})
		},
	}
	const insertInlineMath: DefaultReactSuggestionItem = {
		title: "Inline math",
		subtext: "Inline LaTeX expression",
		aliases: ["imath", "inline-math", "$"],
		group: "Other",
		icon: <span className="font-serif text-sm">∫</span>,
		onItemClick: () => {
			queueMicrotask(() => {
				ed.insertInlineContent([{ type: "math", props: { latex: "" } }, " "])
			})
		},
	}
	return [...defaults, insertMathBlock, insertInlineMath]
}

interface Props {
	noteId: string
	onEditorReady?: (editor: NoteEditorRef) => void
	onOpenCitationBlock?: (paperId: string, blockId: string) => void
	headerActions?: ReactNode
}

export function NoteEditor({ noteId, onEditorReady, onOpenCitationBlock, headerActions }: Props) {
	const { data: note, isLoading } = useNote(noteId)
	const updateNote = useUpdateNote()

	const [initialContent, setInitialContent] = useState<Block[] | null>(null)
	const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle")
	const [titleDraft, setTitleDraft] = useState("")
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	useEffect(() => {
		if (!note) return
		setTitleDraft(note.title)
	}, [note?.id, note])

	// Pull the JSON document from the presigned URL once we have it. We
	// deliberately use a separate fetch (not the API JSON body) so the
	// document doesn't pass through our backend twice.
	useEffect(() => {
		if (!note?.jsonUrl) return
		let cancelled = false
		fetch(note.jsonUrl)
			.then((r) => (r.ok ? r.json() : []))
			.then((data) => {
				if (cancelled) return
				setInitialContent(Array.isArray(data) && data.length > 0 ? (data as Block[]) : [])
			})
			.catch(() => {
				if (!cancelled) setInitialContent([])
			})
		return () => {
			cancelled = true
		}
	}, [note?.jsonUrl])

	if (isLoading || !note || initialContent === null) {
		return <div className="p-6 text-sm text-text-tertiary">Loading note…</div>
	}

	return (
		<NoteEditorInner
			note={note}
			initialContent={initialContent}
			saveStatus={saveStatus}
			setSaveStatus={setSaveStatus}
			titleDraft={titleDraft}
			setTitleDraft={setTitleDraft}
			updateNote={updateNote}
			debounceRef={debounceRef}
			onEditorReady={onEditorReady}
			onOpenCitationBlock={onOpenCitationBlock}
			headerActions={headerActions}
		/>
	)
}

function NoteEditorInner({
	note,
	initialContent,
	saveStatus,
	setSaveStatus,
	titleDraft,
	setTitleDraft,
	updateNote,
	debounceRef,
	onEditorReady,
	onOpenCitationBlock,
	headerActions,
}: {
	note: { id: string; title: string; workspaceId: string }
	initialContent: Block[]
	saveStatus: SaveStatus
	setSaveStatus: (s: SaveStatus) => void
	titleDraft: string
	setTitleDraft: (s: string) => void
	updateNote: ReturnType<typeof useUpdateNote>
	debounceRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>
	onEditorReady?: (editor: NoteEditorRef) => void
	onOpenCitationBlock?: (paperId: string, blockId: string) => void
	headerActions?: ReactNode
}) {
	const { palette } = usePalette()
	// BlockNote's schema generics don't flow cleanly into useCreateBlockNote,
	// so we keep the runtime call right and silence TS at the boundary.
	const editor = useCreateBlockNote({
		schema: noteSchema as never,
		initialContent: initialContent.length > 0 ? (initialContent as never) : undefined,
		// BlockNote's default drop cursor (`#ddeeff`, 5px) reads as teal/green
		// over our cream reading background. Tone it down to a subtle gray
		// pill that stays readable while dragging without screaming for
		// attention when hovered.
		dropCursor: { color: "rgba(15, 23, 42, 0.22)", width: 2 },
	})

	// Hand the editor up to whichever pane wants to insert citations.
	useEffect(() => {
		if (editor && onEditorReady) onEditorReady(editor as unknown as NoteEditorRef)
	}, [editor, onEditorReady])

	// We deliberately re-bind onChange only when editor identity or note id
	// changes; callbacks (setSaveStatus, updateNote) are stable in practice
	// and listing them here would trigger spurious re-binds during typing.
	// biome-ignore lint/correctness/useExhaustiveDependencies: stable callbacks intentionally omitted
	useEffect(() => {
		if (!editor) return
		const handle = (e: { document: unknown }) => {
			// Markdown shortcut: paragraph that is *just* "$$" gets replaced
			// with an empty math block. We do this on every change so it
			// triggers as soon as the user finishes typing the second `$`.
			tryUpgradeMathShortcut(editor)

			setSaveStatus("saving")
			if (debounceRef.current) clearTimeout(debounceRef.current)
			debounceRef.current = setTimeout(async () => {
				try {
					await updateNote.mutateAsync({
						noteId: note.id,
						blocknoteJson: e.document as unknown as Block[],
					})
					setSaveStatus("saved")
				} catch {
					setSaveStatus("failed")
				}
			}, AUTOSAVE_DEBOUNCE_MS)
		}
		editor.onChange(handle)
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current)
		}
	}, [editor, note.id])

	async function commitTitle() {
		if (titleDraft.trim().length === 0 || titleDraft === note.title) return
		setSaveStatus("saving")
		try {
			await updateNote.mutateAsync({ noteId: note.id, title: titleDraft.trim() })
			setSaveStatus("saved")
		} catch {
			setSaveStatus("failed")
		}
	}

	return (
		<div className="note-editor flex h-full flex-col bg-[var(--color-reading-bg)]">
			<div className="flex items-start justify-between gap-3 border-b border-border-subtle/80 px-5 py-2.5 text-sm">
				<input
					className="min-w-0 flex-1 bg-transparent font-serif text-lg text-text-primary outline-none"
					onBlur={commitTitle}
					onChange={(e) => setTitleDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault()
							commitTitle()
							e.currentTarget.blur()
						}
					}}
					type="text"
					value={titleDraft}
				/>
				<div className="flex max-w-[65%] flex-wrap items-center justify-end gap-x-3 gap-y-1 text-right">
					{headerActions}
					<div className="text-xs text-text-tertiary">
						{saveStatus === "saving" && "Saving…"}
						{saveStatus === "saved" && "Saved"}
						{saveStatus === "failed" && <span className="text-text-error">Save failed</span>}
					</div>
				</div>
			</div>
			<div className="note-editor__body flex-1 overflow-y-auto">
				<NoteCitationThemeProvider
					onOpenBlock={onOpenCitationBlock}
					palette={palette}
					workspaceId={note.workspaceId}
				>
					<BlockNoteView className="note-editor__blocknote" editor={editor} slashMenu={false}>
						<SuggestionMenuController
							getItems={async (query) =>
								filterSuggestionItems(getMathSlashItems(editor as never), query)
							}
							triggerCharacter="/"
						/>
					</BlockNoteView>
				</NoteCitationThemeProvider>
			</div>
		</div>
	)
}
