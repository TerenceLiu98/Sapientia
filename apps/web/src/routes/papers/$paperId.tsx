import { createFileRoute, useLocation } from "@tanstack/react-router"
import { useMemo } from "react"
import { ProtectedRoute } from "@/components/auth/ProtectedRoute"
import { PaperWorkspace } from "@/components/reader/PaperWorkspace"

export const Route = createFileRoute("/papers/$paperId")({
	component: PaperLayout,
})

function PaperLayout() {
	const { paperId } = Route.useParams()
	const location = useLocation()
	const activeNoteId = useMemo(() => {
		const prefix = `/papers/${paperId}/notes/`
		if (!location.pathname.startsWith(prefix)) return null
		const segment = location.pathname.slice(prefix.length).split("/")[0]
		return segment ? decodeURIComponent(segment) : null
	}, [location.pathname, paperId])

	return (
		<ProtectedRoute>
			<PaperWorkspace activeNoteId={activeNoteId} paperId={paperId} />
		</ProtectedRoute>
	)
}
