import { createFileRoute, Link } from "@tanstack/react-router"
import { type Paper, usePaper } from "@/api/hooks/papers"
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
						<ParseStatusBanner paper={paper} />
						<div className="min-h-0 flex-1">
							<PdfViewer paperId={paperId} />
						</div>
					</div>
				)}
			</AppShell>
		</ProtectedRoute>
	)
}

function ParseStatusBanner({ paper }: { paper: Paper }) {
	if (paper.parseStatus === "done") return null

	if (paper.parseStatus === "pending" || paper.parseStatus === "parsing") {
		const { parseProgressExtracted: done, parseProgressTotal: total } = paper
		const detail =
			done != null && total != null
				? `${done} / ${total} pages`
				: paper.parseStatus === "pending"
					? "queued for parsing"
					: "starting…"
		return (
			<div className="border-b border-border-subtle bg-bg-secondary px-6 py-2 text-sm text-text-secondary">
				<span className="font-medium text-text-primary">Parsing</span> · {detail} — block-level
				structure will appear once it's done. You can keep reading the PDF.
			</div>
		)
	}

	// failed — surface the error and offer a route to fix it.
	const needsCredentials = paper.parseError
		?.toLowerCase()
		.includes("mineru api token not configured")
	return (
		<div className="border-b border-[oklch(0.45_0.13_25)] bg-[oklch(0.93_0.035_25)] px-6 py-3 text-sm">
			<div className="text-text-error">Parsing failed. {paper.parseError ?? "Unknown error."}</div>
			{needsCredentials ? (
				<Link className="mt-1 inline-block text-text-accent hover:underline" to="/settings">
					Configure MinerU →
				</Link>
			) : null}
		</div>
	)
}
