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

	return (
		<ProtectedRoute>
			<AppShell title={note?.title ?? "Note"}>
				<div className="mx-auto h-full max-w-[800px] px-4 sm:px-6 lg:px-10">
					<NoteEditor noteId={noteId} />
				</div>
			</AppShell>
		</ProtectedRoute>
	)
}
