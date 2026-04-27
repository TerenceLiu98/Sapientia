import { createFileRoute } from "@tanstack/react-router"
import { ProtectedRoute } from "@/components/auth/ProtectedRoute"
import { PaperWorkspace } from "@/components/reader/PaperWorkspace"

export const Route = createFileRoute("/papers/$paperId/notes/$noteId")({
	component: PaperNoteRoute,
})

function PaperNoteRoute() {
	const { paperId, noteId } = Route.useParams()

	return (
		<ProtectedRoute>
			<PaperWorkspace activeNoteId={noteId} paperId={paperId} />
		</ProtectedRoute>
	)
}
