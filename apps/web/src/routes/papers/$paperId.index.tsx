import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useCallback, useState } from "react"
import { type Block, useBlocks } from "@/api/hooks/blocks"
import { usePaperCitationCounts } from "@/api/hooks/citations"
import { useCreateNote, useNotes } from "@/api/hooks/notes"
import { type Paper, usePaper } from "@/api/hooks/papers"
import { useCurrentWorkspace } from "@/api/hooks/workspaces"
import { AppShell } from "@/components/layout/AppShell"
import { OcrPane } from "@/components/reader/OcrPane"
import { PdfViewer } from "@/components/reader/PdfViewer"

export const Route = createFileRoute("/papers/$paperId/")({
	component: PaperReader,
})

function PaperReader() {
	const { paperId } = Route.useParams()
	const { data: paper, isLoading } = usePaper(paperId)
	const { data: workspace } = useCurrentWorkspace()
	const { data: paperNotes } = useNotes(workspace?.id ?? "", paperId)
	const { data: blocks, isLoading: blocksLoading, error: blocksError } = useBlocks(paperId)
	const { data: counts } = usePaperCitationCounts(paperId)
	const createNote = useCreateNote(workspace?.id ?? "")
	const navigate = useNavigate()

	const [requestedPage, setRequestedPage] = useState<number | undefined>()
	const [requestNonce, setRequestNonce] = useState(0)
	const [currentPage, setCurrentPage] = useState(1)
	const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
	const [openPopoverFor, setOpenPopoverFor] = useState<string | null>(null)

	const countsMap = (() => {
		const m = new Map<string, number>()
		for (const row of counts ?? []) m.set(row.blockId, row.count)
		return m
	})()

	const handleSelectBlock = useCallback((block: Block) => {
		setSelectedBlockId(block.blockId)
		setRequestedPage(block.page)
		setRequestNonce((n) => n + 1)
	}, [])

	const existingNote = paperNotes && paperNotes.length > 0 ? paperNotes[0] : null

	async function onOpenOrCreatePaperNote() {
		if (existingNote) {
			await navigate({
				to: "/papers/$paperId/notes/$noteId",
				params: { paperId, noteId: existingNote.id },
			})
			return
		}
		const created = await createNote.mutateAsync({
			paperId,
			title: paper?.title ?? "Untitled",
			blocknoteJson: [],
		})
		await navigate({
			to: "/papers/$paperId/notes/$noteId",
			params: { paperId, noteId: created.id },
		})
	}

	return (
		<AppShell title={paper?.title ?? "Paper"}>
			{isLoading ? (
				<div className="p-8 text-sm text-text-tertiary">Loading…</div>
			) : !paper ? (
				<div className="p-8 text-sm text-text-tertiary">Not found.</div>
			) : (
				<div className="flex h-full min-h-0 flex-col">
					<ParseStatusBanner paper={paper} />
					<div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-6 py-2 text-sm">
						<div className="text-text-secondary">
							{existingNote ? `Note: ${existingNote.title}` : "No note for this paper yet."}
						</div>
						<button
							className="h-8 rounded-md bg-accent-600 px-3 text-xs font-medium text-text-inverse transition-colors hover:bg-accent-700 disabled:opacity-60"
							disabled={createNote.isPending || !workspace}
							onClick={() => void onOpenOrCreatePaperNote()}
							type="button"
						>
							{createNote.isPending
								? "Creating…"
								: existingNote
									? "Open note"
									: "New note for this paper"}
						</button>
					</div>
					<div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
						<div className="min-h-0 overflow-hidden border-r border-border-subtle">
							<PdfViewer
								blocks={blocks}
								onPageChange={setCurrentPage}
								onSelectBlock={handleSelectBlock}
								paperId={paperId}
								requestedPage={requestedPage}
								requestedPageNonce={requestNonce}
								selectedBlockId={selectedBlockId}
							/>
						</div>
						<aside className="min-h-0 overflow-hidden bg-bg-secondary">
							<OcrPane
								blocks={blocks}
								citationCounts={countsMap}
								currentPage={currentPage}
								error={blocksError}
								isLoading={blocksLoading}
								onDismissPopover={() => setOpenPopoverFor(null)}
								onSelectBlock={handleSelectBlock}
								onTogglePopover={(id) => setOpenPopoverFor((cur) => (cur === id ? null : id))}
								openPopoverFor={openPopoverFor}
								paperId={paperId}
								selectedBlockId={selectedBlockId}
							/>
						</aside>
					</div>
				</div>
			)}
		</AppShell>
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
			<div className="shrink-0 border-b border-border-subtle bg-bg-secondary px-6 py-2 text-sm text-text-secondary">
				<span className="font-medium text-text-primary">Parsing</span> · {detail} — block-level
				structure will appear once it's done. You can keep reading the PDF.
			</div>
		)
	}

	const needsCredentials = paper.parseError
		?.toLowerCase()
		.includes("mineru api token not configured")
	return (
		<div className="shrink-0 border-b border-[oklch(0.45_0.13_25)] bg-[oklch(0.93_0.035_25)] px-6 py-3 text-sm">
			<div className="text-text-error">Parsing failed. {paper.parseError ?? "Unknown error."}</div>
			{needsCredentials ? (
				<Link className="mt-1 inline-block text-text-accent hover:underline" to="/settings">
					Configure MinerU →
				</Link>
			) : null}
		</div>
	)
}
