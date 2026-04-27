import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useState } from "react"
import { ProtectedRoute } from "@/components/auth/ProtectedRoute"
import { AppShell } from "@/components/layout/AppShell"
import { NoteEditor } from "@/components/notes/NoteEditor"
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

	const onSelectBlock = useCallback((b: { page: number }) => {
		setRequestedPage(b.page)
		setRequestNonce((n) => n + 1)
	}, [])

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
						/>
					</aside>
					<section className="min-h-0">
						<NoteEditor noteId={noteId} />
					</section>
				</div>
			</AppShell>
		</ProtectedRoute>
	)
}
