import "@blocknote/mantine/style.css"
import type { Block, BlockNoteEditor } from "@blocknote/core"
import { BlockNoteView } from "@blocknote/mantine"
import { useCreateBlockNote } from "@blocknote/react"
import { useEffect, useRef, useState } from "react"
import { useNote, useUpdateNote } from "@/api/hooks/notes"

type SaveStatus = "idle" | "saving" | "saved" | "failed"

const AUTOSAVE_DEBOUNCE_MS = 1500

interface Props {
	noteId: string
}

export function NoteEditor({ noteId }: Props) {
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
}: {
	note: { id: string; title: string }
	initialContent: Block[]
	saveStatus: SaveStatus
	setSaveStatus: (s: SaveStatus) => void
	titleDraft: string
	setTitleDraft: (s: string) => void
	updateNote: ReturnType<typeof useUpdateNote>
	debounceRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>
}) {
	const editor = useCreateBlockNote({
		initialContent: initialContent.length > 0 ? initialContent : undefined,
	})

	// We deliberately re-bind onChange only when editor identity or note id
	// changes; callbacks (setSaveStatus, updateNote) are stable in practice
	// and listing them here would trigger spurious re-binds during typing.
	// biome-ignore lint/correctness/useExhaustiveDependencies: stable callbacks intentionally omitted
	useEffect(() => {
		if (!editor) return
		const handle = (e: BlockNoteEditor) => {
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
		<div className="flex h-full flex-col">
			<div className="flex items-center justify-between border-b border-border-subtle px-4 py-2 text-sm">
				<input
					className="mr-2 flex-1 bg-transparent font-serif text-lg text-text-primary outline-none"
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
				<div className="text-xs text-text-tertiary">
					{saveStatus === "saving" && "Saving…"}
					{saveStatus === "saved" && "Saved"}
					{saveStatus === "failed" && <span className="text-text-error">Save failed</span>}
				</div>
			</div>
			<div className="flex-1 overflow-y-auto">
				<BlockNoteView editor={editor} />
			</div>
		</div>
	)
}
