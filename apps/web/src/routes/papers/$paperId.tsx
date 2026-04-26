import { createFileRoute } from "@tanstack/react-router"
import { usePaper } from "@/api/hooks/papers"
import { ProtectedRoute } from "@/components/auth/ProtectedRoute"
import { AppShell } from "@/components/layout/AppShell"

export const Route = createFileRoute("/papers/$paperId")({
	component: PaperDetail,
})

function PaperDetail() {
	const { paperId } = Route.useParams()
	const { data: paper, isLoading } = usePaper(paperId)

	return (
		<ProtectedRoute>
			<AppShell title={paper?.title ?? "Paper"}>
				<div className="mx-auto max-w-[800px] px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
					{isLoading ? (
						<div className="text-sm text-text-tertiary">Loading…</div>
					) : !paper ? (
						<div className="text-sm text-text-tertiary">Not found.</div>
					) : (
						<>
							<h1 className="font-serif text-3xl text-text-primary">{paper.title}</h1>
							<p className="mt-2 text-text-secondary">Status: {paper.parseStatus}</p>
							<p className="mt-6 text-sm text-text-tertiary">PDF viewer comes in TASK-008.</p>
						</>
					)}
				</div>
			</AppShell>
		</ProtectedRoute>
	)
}
