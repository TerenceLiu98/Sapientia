import { Link, useNavigate } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { type Block, useBlocks } from "@/api/hooks/blocks"
import { usePaperCitationCounts } from "@/api/hooks/citations"
import { type Note, useCreateNote, useNotes } from "@/api/hooks/notes"
import { type Paper, usePaper } from "@/api/hooks/papers"
import { useCurrentWorkspace } from "@/api/hooks/workspaces"
import { AppShell } from "@/components/layout/AppShell"
import { NoteEditor, type NoteEditorRef } from "@/components/notes/NoteEditor"
import { BlocksPanel } from "@/components/reader/BlocksPanel"
import { PdfViewer } from "@/components/reader/PdfViewer"

const MIN_PANE_PX = 120
const DEFAULT_NOTE_HEIGHT_PX = 280

export function PaperWorkspace({
	paperId,
	activeNoteId,
}: {
	paperId: string
	activeNoteId: string | null
}) {
	const { data: paper, isLoading } = usePaper(paperId)
	const { data: workspace } = useCurrentWorkspace()
	const { data: paperNotes } = useNotes(workspace?.id ?? "", paperId)
	const createNote = useCreateNote(workspace?.id ?? "")
	const navigate = useNavigate()

	const [requestedPage, setRequestedPage] = useState<number | undefined>()
	const [requestNonce, setRequestNonce] = useState(0)
	const [currentPage, setCurrentPage] = useState(1)
	const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
	const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null)
	const [showBlocks, setShowBlocks] = useState(true)
	const [editor, setEditor] = useState<NoteEditorRef | null>(null)
	const [pendingCiteBlock, setPendingCiteBlock] = useState<Block | null>(null)
	const { data: blocks } = useBlocks(paperId)
	const { data: counts } = usePaperCitationCounts(paperId)

	const countsMap = useMemo(() => {
		const m = new Map<string, number>()
		for (const row of counts ?? []) m.set(row.blockId, row.count)
		return m
	}, [counts])

	const existingNote = paperNotes && paperNotes.length > 0 ? paperNotes[0] : null
	const noteOpen = activeNoteId != null

	const handleSelectBlock = useCallback((block: Block) => {
		setSelectedBlockId(block.blockId)
		setRequestedPage(block.page)
		setRequestNonce((n) => n + 1)
	}, [])

	const handleHoverBlock = useCallback((blockId: string | null) => {
		setHoveredBlockId(blockId)
	}, [])

	const insertCitation = useCallback(
		(block: Block) => {
			if (!editor || !activeNoteId) return false
			const snapshot = (block.caption ?? block.text ?? "").slice(0, 80)
			editor.insertInlineContent([
				{
					type: "blockCitation",
					props: { paperId, blockId: block.blockId, snapshot },
				},
				" ",
			] as never)
			editor.focus()
			return true
		},
		[activeNoteId, editor, paperId],
	)

	const openOrCreatePaperNote = useCallback(
		async (block?: Block): Promise<Note | null> => {
			if (!workspace) return null
			const note =
				existingNote ??
				(await createNote.mutateAsync({
					paperId,
					title: paper?.title ?? "Untitled",
					blocknoteJson: [],
				}))

			if (block) {
				handleSelectBlock(block)
				setPendingCiteBlock(block)
			}

			if (activeNoteId !== note.id) {
				await navigate({
					to: "/papers/$paperId/notes/$noteId",
					params: { paperId, noteId: note.id },
				})
			}

			return note
		},
		[
			activeNoteId,
			createNote,
			existingNote,
			handleSelectBlock,
			navigate,
			paper?.title,
			paperId,
			workspace,
		],
	)

	const closeNote = useCallback(async () => {
		setPendingCiteBlock(null)
		await navigate({ to: "/papers/$paperId", params: { paperId } })
	}, [navigate, paperId])

	const handleBlockAction = useCallback(
		async (block: Block) => {
			if (noteOpen) {
				handleSelectBlock(block)
				if (!insertCitation(block)) {
					setPendingCiteBlock(block)
				}
				return
			}

			await openOrCreatePaperNote(block)
		},
		[handleSelectBlock, insertCitation, noteOpen, openOrCreatePaperNote],
	)

	const renderActions = useCallback(
		(block: Block) => (
			<button
				className="rounded-md border border-border-default px-1.5 py-0.5 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-accent"
				onClick={(e) => {
					e.stopPropagation()
					void handleBlockAction(block)
				}}
				type="button"
			>
				{noteOpen ? "Cite" : "Add note"}
			</button>
		),
		[handleBlockAction, noteOpen],
	)

	useEffect(() => {
		if (!noteOpen) {
			setEditor(null)
		}
	}, [noteOpen])

	useEffect(() => {
		if (!noteOpen || !editor || !pendingCiteBlock) return
		if (insertCitation(pendingCiteBlock)) {
			setPendingCiteBlock(null)
		}
	}, [editor, insertCitation, noteOpen, pendingCiteBlock])

	return (
		<AppShell title={paper?.title ?? "Paper"}>
			{isLoading ? (
				<div className="p-8 text-sm text-text-tertiary">Loading…</div>
			) : !paper ? (
				<div className="p-8 text-sm text-text-tertiary">Not found.</div>
			) : (
				<div className="flex h-full min-h-0 flex-col">
					<ParseStatusBanner paper={paper} />

					{noteOpen ? (
						<div className="flex shrink-0 items-center justify-end gap-2 border-b border-border-subtle bg-bg-secondary px-4 py-2 text-sm">
							<button
								className="rounded-md border border-border-default px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-hover"
								onClick={() => void closeNote()}
								type="button"
							>
								Hide note
							</button>
							<button
								aria-pressed={showBlocks}
								className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
									showBlocks
										? "border-accent-600 bg-accent-600 text-text-inverse hover:bg-accent-700"
										: "border-border-default text-text-secondary hover:bg-surface-hover"
								}`}
								onClick={() => setShowBlocks((v) => !v)}
								type="button"
							>
								{showBlocks ? "Hide blocks" : "Blocks"}
							</button>
						</div>
					) : null}

					<div className="min-h-0 flex-1 p-6">
						<VerticalSplit
							bottom={
								activeNoteId ? (
									<section className="h-full min-h-0 overflow-hidden border-t border-border-subtle bg-[var(--color-reading-bg)]">
										<NoteEditor
											headerActions={
												<button
													className="rounded-md border border-border-default px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-hover"
													onClick={() => void closeNote()}
													type="button"
												>
													Collapse
												</button>
											}
											noteId={activeNoteId}
											onEditorReady={setEditor}
										/>
									</section>
								) : null
							}
							isBottomOpen={noteOpen}
							top={
								showBlocks ? (
									<div className="grid h-full min-h-0 gap-4 xl:grid-cols-2">
										<section className="min-h-0 overflow-hidden rounded-lg border border-border-subtle bg-[var(--color-reading-bg)]">
											<PdfViewer
												blocks={blocks}
												hoveredBlockId={hoveredBlockId}
												onPageChange={setCurrentPage}
												onHoverBlock={handleHoverBlock}
												onSelectBlock={handleSelectBlock}
												paperId={paperId}
												requestedPage={requestedPage}
												requestedPageNonce={requestNonce}
												selectedBlockId={selectedBlockId}
											/>
										</section>
										<section className="min-h-0 overflow-hidden rounded-lg border border-border-subtle bg-[var(--color-reading-bg)]">
											<BlocksPanel
												citationCounts={countsMap}
												currentPage={currentPage}
												hoveredBlockId={hoveredBlockId}
												onHoverBlock={handleHoverBlock}
												onSelectBlock={handleSelectBlock}
												paperId={paperId}
												renderActions={renderActions}
												selectedBlockId={selectedBlockId}
											/>
										</section>
									</div>
								) : (
									<div className="h-full min-h-0 overflow-hidden rounded-lg border border-border-subtle bg-[var(--color-reading-bg)]">
										<PdfViewer
											blocks={blocks}
											hoveredBlockId={hoveredBlockId}
											onPageChange={setCurrentPage}
											onHoverBlock={handleHoverBlock}
											onSelectBlock={handleSelectBlock}
											paperId={paperId}
											requestedPage={requestedPage}
											requestedPageNonce={requestNonce}
											selectedBlockId={selectedBlockId}
										/>
									</div>
								)
							}
						/>
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

function VerticalSplit(props: {
	top: React.ReactNode
	bottom: React.ReactNode
	isBottomOpen: boolean
}) {
	const wrapRef = useRef<HTMLDivElement | null>(null)
	const [bottomPx, setBottomPx] = useState(DEFAULT_NOTE_HEIGHT_PX)
	const [dragging, setDragging] = useState(false)
	const dragStateRef = useRef<{ startY: number; startBottom: number; wrapH: number } | null>(null)
	const effectiveBottomPx = props.isBottomOpen ? bottomPx : 0

	const onPointerDown = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			if (!props.isBottomOpen) return
			if (!wrapRef.current) return
			e.preventDefault()
			;(e.target as HTMLElement).setPointerCapture(e.pointerId)
			dragStateRef.current = {
				startY: e.clientY,
				startBottom: bottomPx,
				wrapH: wrapRef.current.getBoundingClientRect().height,
			}
			setDragging(true)
		},
		[bottomPx, props.isBottomOpen],
	)

	const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
		const s = dragStateRef.current
		if (!s) return
		const delta = s.startY - e.clientY
		const max = Math.max(MIN_PANE_PX, s.wrapH - MIN_PANE_PX - 6)
		const next = Math.min(max, Math.max(MIN_PANE_PX, s.startBottom + delta))
		setBottomPx(next)
	}, [])

	const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
		if (!dragStateRef.current) return
		;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
		dragStateRef.current = null
		setDragging(false)
	}, [])

	useEffect(() => {
		if (!dragging) return
		const prev = document.body.style.cursor
		document.body.style.cursor = "row-resize"
		return () => {
			document.body.style.cursor = prev
		}
	}, [dragging])

	return (
		<div
			ref={wrapRef}
			className="grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_6px_var(--bottom)] gap-0"
			style={{ ["--bottom" as string]: `${effectiveBottomPx}px` }}
		>
			<div className="min-h-0 min-w-0">{props.top}</div>
			{/* biome-ignore lint/a11y/useSemanticElements: <hr> can't host pointer handlers; role="separator" is the correct ARIA for a draggable splitter */}
			<div
				aria-label="Resize note pane"
				aria-orientation="horizontal"
				aria-valuenow={effectiveBottomPx}
				className={`group relative select-none ${props.isBottomOpen ? "cursor-row-resize" : "pointer-events-none opacity-0"}`}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				role="separator"
				tabIndex={0}
			>
				<div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-border-subtle transition-colors group-hover:bg-accent-600" />
			</div>
			<div className="min-h-0 min-w-0 overflow-hidden">{props.bottom}</div>
		</div>
	)
}
