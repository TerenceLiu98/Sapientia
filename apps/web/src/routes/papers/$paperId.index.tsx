import { createFileRoute } from "@tanstack/react-router"
import { ProtectedRoute } from "@/components/auth/ProtectedRoute"
import { PaperWorkspace } from "@/components/reader/PaperWorkspace"

export const Route = createFileRoute("/papers/$paperId/")({
	component: PaperReaderRoute,
})

function PaperReaderRoute() {
	const { paperId } = Route.useParams()

	return (
		<ProtectedRoute>
			<PaperWorkspace activeNoteId={null} paperId={paperId} />
		</ProtectedRoute>
	)
}
