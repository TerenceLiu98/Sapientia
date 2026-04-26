import { createFileRoute } from "@tanstack/react-router"
import { usePaper } from "@/api/hooks/papers"
import { ProtectedRoute } from "@/components/auth/ProtectedRoute"
import { AppShell } from "@/components/layout/AppShell"
import { PdfViewer } from "@/components/reader/PdfViewer"

export const Route = createFileRoute("/papers/$paperId")({
	component: PaperDetail,
})

function PaperDetail() {
	const { paperId } = Route.useParams()
	const { data: paper, isLoading } = usePaper(paperId)

	return (
		<ProtectedRoute>
			<AppShell title={paper?.title ?? "Paper"}>
				{isLoading ? (
					<div className="p-8 text-sm text-text-tertiary">Loading…</div>
				) : !paper ? (
					<div className="p-8 text-sm text-text-tertiary">Not found.</div>
				) : (
					<div className="flex h-full flex-col">
						<PdfViewer paperId={paperId} />
					</div>
				)}
			</AppShell>
		</ProtectedRoute>
	)
}
