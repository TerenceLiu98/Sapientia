import { createFileRoute } from "@tanstack/react-router"
import { useNote } from "@/api/hooks/notes"
import { ProtectedRoute } from "@/components/auth/ProtectedRoute"
import { AppShell } from "@/components/layout/AppShell"
import { NoteEditor } from "@/components/notes/NoteEditor"

export const Route = createFileRoute("/notes/$noteId")({
	component: NoteEditorPage,
})

function NoteEditorPage() {
	const { noteId } = Route.useParams()
	const { data: note } = useNote(noteId)
	const title = note?.title?.trim() || (note?.paperId ? "Marginalia note" : "Note")

	return (
		<ProtectedRoute>
			<AppShell title={title}>
				<div className="mx-auto h-full max-w-[var(--content-default)] px-4 sm:px-6 lg:px-10">
					<NoteEditor noteId={noteId} />
				</div>
			</AppShell>
		</ProtectedRoute>
	)
}
