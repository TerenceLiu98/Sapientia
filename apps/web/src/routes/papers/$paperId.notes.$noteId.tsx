import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useMemo, useState } from "react"
import type { Block } from "@/api/hooks/blocks"
import { usePaperCitationCounts } from "@/api/hooks/citations"
import { ProtectedRoute } from "@/components/auth/ProtectedRoute"
import { AppShell } from "@/components/layout/AppShell"
import { NoteEditor, type NoteEditorRef } from "@/components/notes/NoteEditor"
import { BlocksPanel } from "@/components/reader/BlocksPanel"
import { PdfViewer } from "@/components/reader/PdfViewer"

export const Route = createFileRoute("/papers/$paperId/notes/$noteId")({
	component: PaperSideNote,
})

function PaperSideNote() {
	const { paperId, noteId } = Route.useParams()
	const [requestedPage, setRequestedPage] = useState<number | undefined>()
	const [requestNonce, setRequestNonce] = useState(0)
	const [currentPage, setCurrentPage] = useState(1)
	const [editor, setEditor] = useState<NoteEditorRef | null>(null)

	const { data: counts } = usePaperCitationCounts(paperId)
	const countsMap = useMemo(() => {
		const m = new Map<string, number>()
		for (const row of counts ?? []) m.set(row.blockId, row.count)
		return m
	}, [counts])

	const onSelectBlock = useCallback((b: { page: number }) => {
		setRequestedPage(b.page)
		setRequestNonce((n) => n + 1)
	}, [])

	const onCiteBlock = useCallback(
		(block: Block) => {
			if (!editor) return
			const snapshot = (block.caption ?? block.text ?? "").slice(0, 80)
			editor.insertInlineContent([
				{
					type: "blockCitation",
					props: { paperId, blockId: block.blockId, snapshot },
				},
				" ",
			] as never)
			editor.focus()
		},
		[editor, paperId],
	)

	const renderActions = useCallback(
		(block: Block) => (
			<button
				className="rounded-md border border-border-default px-1.5 py-0.5 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-accent"
				onClick={(e) => {
					e.stopPropagation()
					onCiteBlock(block)
				}}
				type="button"
			>
				Cite
			</button>
		),
		[onCiteBlock],
	)

	return (
		<ProtectedRoute>
			<AppShell title="Note">
				<div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_320px_480px]">
					<div className="min-h-0 border-r border-border-subtle">
						<PdfViewer
							paperId={paperId}
							requestedPage={requestedPage}
							requestedPageNonce={requestNonce}
							onPageChange={setCurrentPage}
						/>
					</div>
					<aside className="min-h-0 border-r border-border-subtle bg-bg-secondary">
						<BlocksPanel
							paperId={paperId}
							currentPage={currentPage}
							onSelectBlock={onSelectBlock}
							renderActions={renderActions}
							citationCounts={countsMap}
						/>
					</aside>
					<section className="min-h-0">
						<NoteEditor noteId={noteId} onEditorReady={setEditor} />
					</section>
				</div>
			</AppShell>
		</ProtectedRoute>
	)
}
