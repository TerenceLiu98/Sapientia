import { createFileRoute } from "@tanstack/react-router"
import { ProtectedRoute } from "@/components/auth/ProtectedRoute"
import { PaperWorkspace } from "@/components/reader/PaperWorkspace"

export const Route = createFileRoute("/papers/$paperId")({
	validateSearch: (search: Record<string, unknown>) => ({
		blockId: typeof search.blockId === "string" ? search.blockId : undefined,
	}),
	component: PaperLayout,
})

function PaperLayout() {
	const { paperId } = Route.useParams()
	const { blockId } = Route.useSearch()
	return (
		<ProtectedRoute>
			<PaperWorkspace initialBlockId={blockId} paperId={paperId} />
		</ProtectedRoute>
	)
}
