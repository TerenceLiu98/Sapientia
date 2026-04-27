import { Link, useNavigate } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { type Block, useBlocks } from "@/api/hooks/blocks"
import { usePaperCitationCounts } from "@/api/hooks/citations"
import {
	type HighlightColor,
	type HighlightInput,
	useCreateHighlightBatch,
	useDeleteHighlight,
	useDeleteHighlightsByRange,
	useHighlights,
} from "@/api/hooks/highlights"
import { type Note, useCreateNote, useNotes } from "@/api/hooks/notes"
import { type Paper, usePaper } from "@/api/hooks/papers"
import { useCurrentWorkspace } from "@/api/hooks/workspaces"
import { AppShell } from "@/components/layout/AppShell"
import type { NoteEditorRef } from "@/components/notes/NoteEditor"
import { BlocksPanel } from "@/components/reader/BlocksPanel"
import { FloatingNote } from "@/components/reader/FloatingNote"
import { PdfViewer } from "@/components/reader/PdfViewer"

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
	const [requestedBlockY, setRequestedBlockY] = useState<number | undefined>()
	const [requestNonce, setRequestNonce] = useState(0)
	const [selectedBlockRequestNonce, setSelectedBlockRequestNonce] = useState(0)
	const [currentPage, setCurrentPage] = useState(1)
	const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
	const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null)
	const [showBlocks, setShowBlocks] = useState(true)
	const [editor, setEditor] = useState<NoteEditorRef | null>(null)
	const [pendingCiteBlock, setPendingCiteBlock] = useState<Block | null>(null)
	const { data: blocks } = useBlocks(paperId)
	const { data: counts } = usePaperCitationCounts(paperId)
	const { data: highlights = [] } = useHighlights(paperId, workspace?.id)
	const createHighlightBatch = useCreateHighlightBatch(paperId)
	const deleteHighlight = useDeleteHighlight(paperId, workspace?.id)
	const deleteHighlightsByRange = useDeleteHighlightsByRange(paperId)

	const blocksById = useMemo(() => {
		const map = new Map<string, Block>()
		for (const block of blocks ?? []) map.set(block.blockId, block)
		return map
	}, [blocks])

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
		// Pass the bbox y-ratio so the PDF can land on the actual block, not
		// the page top — important at high zoom where most of the page is
		// off-screen and a "go to page top" jump would hide the target.
		setRequestedBlockY(block.bbox?.y)
		setRequestNonce((n) => n + 1)
		setSelectedBlockRequestNonce((n) => n + 1)
	}, [])

	const handleHoverBlock = useCallback((blockId: string | null) => {
		setHoveredBlockId(blockId)
	}, [])

	const insertCitation = useCallback(
		(block: Block) => {
			if (!editor || !activeNoteId) return false
			const snapshot = (block.caption ?? block.text ?? "").slice(0, 80)
			// Focus + position the cursor BEFORE inserting. With the floating
			// note panel (`position: fixed`) the editor frequently has no
			// cursor at the moment a citation lands — clicking "Cite" leaves
			// focus on the BlocksPanel button, not in the editor — and
			// `insertInlineContent` silently no-ops when the editor lacks a
			// text cursor. Falling back to the last block ensures every cite
			// has a target, even on a fresh note.
			const ed = editor as unknown as {
				focus: () => void
				document: Array<{ id: string }>
				getTextCursorPosition: () => { block?: { id?: string } }
				setTextCursorPosition: (
					target: string | { id: string },
					placement?: "start" | "end",
				) => void
				insertInlineContent: (content: unknown[]) => void
			}
			ed.focus()
			const cursor = ed.getTextCursorPosition()
			if (!cursor?.block?.id) {
				const last = ed.document?.[ed.document.length - 1]
				if (last) ed.setTextCursorPosition(last, "end")
			}
			ed.insertInlineContent([
				{ type: "blockCitation", props: { paperId, blockId: block.blockId, snapshot } },
				" ",
			])
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
				aria-label={noteOpen ? "Cite this block" : "Add note for this block"}
				className="flex h-7 w-7 items-center justify-center rounded-sm text-text-secondary hover:bg-surface-hover hover:text-text-accent"
				onClick={(e) => {
					e.stopPropagation()
					void handleBlockAction(block)
				}}
				title={noteOpen ? "Cite" : "Add note"}
				type="button"
			>
				{noteOpen ? <CiteIcon /> : <NoteIcon />}
			</button>
		),
		[handleBlockAction, noteOpen],
	)

	const handleCiteBlocks = useCallback(
		async (blockIds: string[]) => {
			const targets = [...new Set(blockIds)]
				.map((blockId) => blocksById.get(blockId) ?? null)
				.filter((block): block is Block => block != null)
			if (targets.length === 0) return

			if (!noteOpen) {
				await openOrCreatePaperNote(targets[0])
				return
			}

			for (const block of targets) {
				handleSelectBlock(block)
				if (!insertCitation(block)) {
					setPendingCiteBlock(block)
					break
				}
			}
		},
		[blocksById, handleSelectBlock, insertCitation, noteOpen, openOrCreatePaperNote],
	)

	const handleApplyHighlights = useCallback(
		async (color: HighlightColor, ranges: HighlightInput[]) => {
			if (!workspace || ranges.length === 0) return
			await deleteHighlightsByRange.mutateAsync({
				workspaceId: workspace.id,
				ranges: ranges.map((range) => ({
					blockId: range.blockId,
					charStart: range.charStart,
					charEnd: range.charEnd,
				})),
			})
			await createHighlightBatch.mutateAsync({
				workspaceId: workspace.id,
				color,
				highlights: ranges,
			})
		},
		[createHighlightBatch, deleteHighlightsByRange, workspace],
	)

	const handleDeleteHighlight = useCallback(
		async (highlightId: string) => {
			await deleteHighlight.mutateAsync(highlightId)
		},
		[deleteHighlight],
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
				<div className="relative flex h-full min-h-0 flex-col">
					<ParseStatusBanner paper={paper} />

					<div className="flex shrink-0 items-center justify-end gap-2 border-b border-border-subtle bg-bg-secondary px-4 py-2 text-sm">
						<button
							className="rounded-md border border-border-default px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-hover disabled:opacity-60"
							disabled={createNote.isPending || !workspace}
							onClick={() => {
								if (noteOpen) void closeNote()
								else void openOrCreatePaperNote()
							}}
							type="button"
						>
							{noteOpen
								? "Hide note"
								: existingNote
									? "Open note"
									: createNote.isPending
										? "Creating…"
										: "Create note"}
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

					<div className="min-h-0 flex-1 p-6">
						{showBlocks ? (
							<HorizontalSplit
								left={
									<section className="h-full min-h-0 overflow-hidden rounded-lg border border-border-subtle bg-[var(--color-reading-bg)]">
										<PdfViewer
											blocks={blocks}
											highlights={highlights}
											hoveredBlockId={hoveredBlockId}
											onApplyHighlights={handleApplyHighlights}
											onCiteBlocks={handleCiteBlocks}
											onDeleteHighlight={handleDeleteHighlight}
											onPageChange={setCurrentPage}
											onHoverBlock={handleHoverBlock}
											onSelectBlock={handleSelectBlock}
											paperId={paperId}
											requestedBlockY={requestedBlockY}
											requestedPage={requestedPage}
											requestedPageNonce={requestNonce}
											selectedBlockId={selectedBlockId}
										/>
									</section>
								}
								right={
									<section className="h-full min-h-0 overflow-hidden rounded-lg border border-border-subtle bg-[var(--color-reading-bg)]">
										<BlocksPanel
											citationCounts={countsMap}
											currentPage={currentPage}
											highlights={highlights}
											hoveredBlockId={hoveredBlockId}
											onHoverBlock={handleHoverBlock}
											onSelectBlock={handleSelectBlock}
											paperId={paperId}
											renderActions={renderActions}
											selectedBlockId={selectedBlockId}
											selectedBlockRequestNonce={selectedBlockRequestNonce}
										/>
									</section>
								}
							/>
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
						)}
					</div>

					{activeNoteId ? (
						<FloatingNote
							noteId={activeNoteId}
							onClose={() => void closeNote()}
							onEditorReady={setEditor}
						/>
					) : null}
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

// Resizable left|right split for the PDF + parsed-blocks panes. Stores the
// left pane's width in localStorage so the user's preferred ratio survives
// reloads. Both panes have a hard min so the divider can't be dragged off
// the edge.
function HorizontalSplit({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
	const wrapRef = useRef<HTMLDivElement | null>(null)
	const [leftPct, setLeftPct] = useState<number>(() => {
		if (typeof window === "undefined") return 50
		const stored = window.localStorage.getItem("paperWorkspace.leftPct")
		const n = stored ? Number(stored) : NaN
		return Number.isFinite(n) && n >= 20 && n <= 80 ? n : 50
	})
	const [dragging, setDragging] = useState(false)
	const dragStateRef = useRef<{ startX: number; startPct: number; wrapW: number } | null>(null)

	const onPointerDown = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			if (!wrapRef.current) return
			e.preventDefault()
			;(e.target as HTMLElement).setPointerCapture(e.pointerId)
			dragStateRef.current = {
				startX: e.clientX,
				startPct: leftPct,
				wrapW: wrapRef.current.getBoundingClientRect().width,
			}
			setDragging(true)
		},
		[leftPct],
	)

	const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
		const s = dragStateRef.current
		if (!s) return
		const deltaPct = ((e.clientX - s.startX) / s.wrapW) * 100
		// Each pane gets at least 20% so the divider always has somewhere to land.
		const next = Math.max(20, Math.min(80, s.startPct + deltaPct))
		setLeftPct(next)
	}, [])

	const onPointerUp = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			if (!dragStateRef.current) return
			;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
			dragStateRef.current = null
			setDragging(false)
			if (typeof window !== "undefined") {
				window.localStorage.setItem("paperWorkspace.leftPct", String(leftPct))
			}
		},
		[leftPct],
	)

	useEffect(() => {
		if (!dragging) return
		const prev = document.body.style.cursor
		document.body.style.cursor = "col-resize"
		return () => {
			document.body.style.cursor = prev
		}
	}, [dragging])

	return (
		<div
			ref={wrapRef}
			className="grid h-full min-h-0 min-w-0 grid-cols-[var(--left)_8px_minmax(0,1fr)] gap-0"
			style={{ ["--left" as string]: `${leftPct}%` }}
		>
			<div className="min-h-0 min-w-0">{left}</div>
			{/* biome-ignore lint/a11y/useSemanticElements: <hr> can't host pointer handlers; role="separator" is the correct ARIA for a draggable splitter */}
			<div
				aria-label="Resize PDF / parsed-blocks split"
				aria-orientation="vertical"
				aria-valuenow={leftPct}
				className="group relative cursor-col-resize select-none"
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				role="separator"
				tabIndex={0}
			>
				<div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-border-subtle transition-colors group-hover:bg-accent-600" />
			</div>
			<div className="min-h-0 min-w-0">{right}</div>
		</div>
	)
}

function CiteIcon() {
	// Quote-mark glyph: signals "drop a citation chip into the note".
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="14"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.6"
			viewBox="0 0 24 24"
			width="14"
		>
			<path d="M3 21c3 0 7-1 7-8V5H3v8h4" />
			<path d="M14 21c3 0 7-1 7-8V5h-7v8h4" />
		</svg>
	)
}

function NoteIcon() {
	// Pencil-on-paper glyph: signals "create a new note for this paper".
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="14"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.6"
			viewBox="0 0 24 24"
			width="14"
		>
			<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
			<path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5Z" />
		</svg>
	)
}
