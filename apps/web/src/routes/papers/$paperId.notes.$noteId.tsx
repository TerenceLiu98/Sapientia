import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { type Block, useBlocks } from "@/api/hooks/blocks"
import { usePaperCitationCounts } from "@/api/hooks/citations"
import { AppShell } from "@/components/layout/AppShell"
import { NoteEditor, type NoteEditorRef } from "@/components/notes/NoteEditor"
import { OcrPane } from "@/components/reader/OcrPane"
import { PdfViewer } from "@/components/reader/PdfViewer"

export const Route = createFileRoute("/papers/$paperId/notes/$noteId")({
	component: PaperSideNote,
})

const MIN_PANE_PX = 120
const DEFAULT_NOTE_HEIGHT_PX = 280

function PaperSideNote() {
	const { paperId, noteId } = Route.useParams()
	const [requestedPage, setRequestedPage] = useState<number | undefined>()
	const [requestNonce, setRequestNonce] = useState(0)
	const [currentPage, setCurrentPage] = useState(1)
	const [editor, setEditor] = useState<NoteEditorRef | null>(null)
	const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
	const [openPopoverFor, setOpenPopoverFor] = useState<string | null>(null)

	const { data: blocks, isLoading: blocksLoading, error: blocksError } = useBlocks(paperId)
	const { data: counts } = usePaperCitationCounts(paperId)
	const countsMap = useMemo(() => {
		const m = new Map<string, number>()
		for (const row of counts ?? []) m.set(row.blockId, row.count)
		return m
	}, [counts])

	const onSelectBlock = useCallback((b: Block) => {
		setSelectedBlockId(b.blockId)
		setRequestedPage(b.page)
		setRequestNonce((n) => n + 1)
	}, [])

	const onCiteBlock = useCallback(
		(block: Block) => {
			if (!editor) return
			const snapshot = (block.caption ?? block.text ?? "").slice(0, 80)
			editor.insertInlineContent([
				{
					type: "blockCitation",
					props: { paperId, blockId: block.blockId, snapshot },
				},
				" ",
			] as never)
			editor.focus()
		},
		[editor, paperId],
	)

	const renderActions = useCallback(
		(block: Block) => (
			<button
				className="rounded-md border border-border-default px-1.5 py-0.5 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-accent"
				onClick={(e) => {
					e.stopPropagation()
					onCiteBlock(block)
				}}
				type="button"
			>
				Cite
			</button>
		),
		[onCiteBlock],
	)

	// Layout: top row is a 2-column [PDF | OCR] split, bottom is the note
	// editor pinned terminal-style with a draggable horizontal divider, just
	// like the demo. Selection (selectedBlockId) is shared between the PDF
	// overlay and the OCR pane so clicks on either side highlight both.
	return (
		<AppShell title="Note">
			<VerticalSplit
				bottom={
					<section className="h-full min-h-0 overflow-hidden border-t border-border-subtle bg-bg-secondary">
						<NoteEditor noteId={noteId} onEditorReady={setEditor} />
					</section>
				}
				top={
					<div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
						<div className="min-h-0 overflow-hidden border-r border-border-subtle">
							<PdfViewer
								blocks={blocks}
								onPageChange={setCurrentPage}
								onSelectBlock={onSelectBlock}
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
								onSelectBlock={onSelectBlock}
								onTogglePopover={(id) => setOpenPopoverFor((cur) => (cur === id ? null : id))}
								openPopoverFor={openPopoverFor}
								paperId={paperId}
								renderActions={renderActions}
								selectedBlockId={selectedBlockId}
							/>
						</aside>
					</div>
				}
			/>
		</AppShell>
	)
}

function VerticalSplit(props: { top: React.ReactNode; bottom: React.ReactNode }) {
	const wrapRef = useRef<HTMLDivElement | null>(null)
	const [bottomPx, setBottomPx] = useState(DEFAULT_NOTE_HEIGHT_PX)
	const [dragging, setDragging] = useState(false)
	const dragStateRef = useRef<{ startY: number; startBottom: number; wrapH: number } | null>(null)

	const onPointerDown = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
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
		[bottomPx],
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
			className="grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_6px_var(--bottom)]"
			ref={wrapRef}
			style={{ ["--bottom" as string]: `${bottomPx}px` }}
		>
			<div className="min-h-0 min-w-0">{props.top}</div>
			{/* biome-ignore lint/a11y/useSemanticElements: <hr> can't host pointer handlers; role="separator" is the correct ARIA for a draggable splitter */}
			<div
				aria-label="Resize note pane"
				aria-orientation="horizontal"
				aria-valuenow={bottomPx}
				className="group relative cursor-row-resize select-none"
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				role="separator"
				tabIndex={0}
			>
				<div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-border-subtle transition-colors group-hover:bg-accent-600" />
			</div>
			<div className="min-h-0 min-w-0">{props.bottom}</div>
		</div>
	)
}
