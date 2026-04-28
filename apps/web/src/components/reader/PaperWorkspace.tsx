import { Link } from "@tanstack/react-router"
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { type Block, useBlocks } from "@/api/hooks/blocks"
import { useNotesForBlock, usePaperCitationCounts } from "@/api/hooks/citations"
import { useClearBlockHighlight, useHighlights, useSetBlockHighlight } from "@/api/hooks/highlights"
import { useCreateNote, useDeleteNote, useNotes } from "@/api/hooks/notes"
import { type Paper, usePaper } from "@/api/hooks/papers"
import {
	type ReaderAnnotation,
	useCreateReaderAnnotation,
	useDeleteReaderAnnotation,
	useReaderAnnotations,
	useUpdateReaderAnnotationColor,
} from "@/api/hooks/reader-annotations"
import { useCurrentWorkspace } from "@/api/hooks/workspaces"
import { AppShell, useAppShellLayout } from "@/components/layout/AppShell"
import type { NoteEditorRef } from "@/components/notes/NoteEditor"
import { BlocksPanel } from "@/components/reader/BlocksPanel"
import { NotesPanel } from "@/components/reader/NotesPanel"
import { PdfViewer } from "@/components/reader/PdfViewer"
import { usePalette } from "@/lib/highlight-palette"
import type { ReaderAnnotationBody, ReaderAnnotationKind } from "@/lib/reader-annotations"

type ViewMode = "pdf-only" | "md-only"

const VIEW_MODE_KEY = "paperWorkspace.viewMode"
const NOTES_WIDTH_KEY = "paperWorkspace.notesWidthPct.v2"
const NOTES_VISIBILITY_KEY = "paperWorkspace.notesVisible"
const AUTO_FOLLOW_LOCK_MS = 1400

function loadViewMode(): ViewMode {
	if (typeof window === "undefined") return "pdf-only"
	const v = window.localStorage.getItem(VIEW_MODE_KEY)
	return v === "pdf-only" || v === "md-only" ? v : "pdf-only"
}

function loadNotesVisible() {
	if (typeof window === "undefined") return true
	const v = window.localStorage.getItem(NOTES_VISIBILITY_KEY)
	return v === null ? true : v !== "false"
}

export function PaperWorkspace({ paperId }: { paperId: string }) {
	const { data: paper, isLoading } = usePaper(paperId)
	const { data: workspace } = useCurrentWorkspace()
	const { data: paperNotes = [] } = useNotes(workspace?.id ?? "", paperId)
	const createNote = useCreateNote(workspace?.id ?? "")
	const deleteNote = useDeleteNote(workspace?.id ?? "")

	const [requestedPage, setRequestedPage] = useState<number | undefined>()
	const [requestedBlockY, setRequestedBlockY] = useState<number | undefined>()
	const [requestNonce, setRequestNonce] = useState(0)
	const [selectedBlockRequestNonce, setSelectedBlockRequestNonce] = useState(0)
	const [currentPage, setCurrentPage] = useState(1)
	const [currentAnchorYRatio, setCurrentAnchorYRatio] = useState(0.5)
	const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
	const [viewMode, setViewMode] = useState<ViewMode>(() => loadViewMode())
	const [notesVisible, setNotesVisible] = useState<boolean>(() => loadNotesVisible())
	const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null)
	const [editor, setEditor] = useState<NoteEditorRef | null>(null)
	const [pendingCiteBlock, setPendingCiteBlock] = useState<Block | null>(null)
	const [autoFollowLockUntil, setAutoFollowLockUntil] = useState(0)

	const { data: blocks } = useBlocks(paperId)
	const { data: counts } = usePaperCitationCounts(paperId)
	const { data: notesCitingSelectedBlock = [] } = useNotesForBlock(paperId, selectedBlockId)
	const { data: highlights = [] } = useHighlights(paperId, workspace?.id)
	const { data: readerAnnotations = [] } = useReaderAnnotations(paperId, workspace?.id)
	const setBlockHighlight = useSetBlockHighlight(paperId)
	const clearBlockHighlight = useClearBlockHighlight(paperId)
	const createReaderAnnotation = useCreateReaderAnnotation(paperId)
	const deleteReaderAnnotation = useDeleteReaderAnnotation(paperId, workspace?.id)
	const updateReaderAnnotationColor = useUpdateReaderAnnotationColor(paperId, workspace?.id)
	const { palette } = usePalette()

	useEffect(() => {
		if (typeof window !== "undefined") {
			window.localStorage.setItem(VIEW_MODE_KEY, viewMode)
		}
	}, [viewMode])

	useEffect(() => {
		if (typeof window !== "undefined") {
			window.localStorage.setItem(NOTES_VISIBILITY_KEY, String(notesVisible))
		}
	}, [notesVisible])

	const countsMap = useMemo(() => {
		const m = new Map<string, number>()
		for (const row of counts ?? []) m.set(row.blockId, row.count)
		return m
	}, [counts])

	const activeCitingNoteIds = useMemo(
		() => new Set(notesCitingSelectedBlock.map((note) => note.noteId)),
		[notesCitingSelectedBlock],
	)

	const selectedBlock = useMemo(
		() =>
			selectedBlockId ? (blocks ?? []).find((block) => block.blockId === selectedBlockId) ?? null : null,
		[blocks, selectedBlockId],
	)
	const previousViewModeRef = useRef<ViewMode | null>(null)

	const requestMainPaneFocus = useCallback((block: Block) => {
		setRequestedPage(block.page)
		setRequestedBlockY(block.bbox?.y)
		setRequestNonce((n) => n + 1)
	}, [])

	// Bbox/card clicks in the active pane just record the selection — the
	// block is by definition visible (the user clicked it), so we don't
	// fire a scroll request. Cross-view follow on PDF↔Markdown toggle is
	// handled by the `viewMode` change effect below; citation chip jumps
	// route through `handleJumpToBlock` which explicitly re-centers.
	const handleSelectBlock = useCallback((block: Block) => {
		setSelectedBlockId(block.blockId)
		setSelectedBlockRequestNonce((n) => n + 1)
	}, [])

	const handleSelectBlockFromPane = useCallback(
		(block: Block) => {
			if (selectedBlockId === block.blockId) {
				setSelectedBlockId(null)
				return
			}
			setSelectedBlockId(block.blockId)
		},
		[selectedBlockId],
	)

	// Used for navigation actions where the target may be off-screen
	// (citation chip click): records selection AND scrolls the active pane
	// to the block.
	const handleJumpToBlock = useCallback(
		(block: Block) => {
			setSelectedBlockId(block.blockId)
			setSelectedBlockRequestNonce((n) => n + 1)
			requestMainPaneFocus(block)
		},
		[requestMainPaneFocus],
	)

	const handleClearSelectedBlock = useCallback(() => {
		setSelectedBlockId(null)
	}, [])

	const handleOpenCitationBlock = useCallback(
		(targetPaperId: string, blockId: string) => {
			if (targetPaperId !== paperId) return
			const block = blocks?.find((candidate) => candidate.blockId === blockId)
			if (!block) return
			setAutoFollowLockUntil(Date.now() + AUTO_FOLLOW_LOCK_MS)
			handleJumpToBlock(block)
		},
		[blocks, handleJumpToBlock, paperId],
	)

	const handleMainInteract = useCallback(() => {
		setExpandedNoteId(null)
	}, [])

	const handleViewportAnchorChange = useCallback((page: number, yRatio: number) => {
		startTransition(() => {
			setCurrentPage((prev) => (prev === page ? prev : page))
			setCurrentAnchorYRatio((prev) => (Math.abs(prev - yRatio) < 0.02 ? prev : yRatio))
		})
	}, [])

	useEffect(() => {
		if (previousViewModeRef.current == null) {
			previousViewModeRef.current = viewMode
			return
		}
		if (previousViewModeRef.current === viewMode) return
		previousViewModeRef.current = viewMode
		if (!selectedBlock) return
		// Cross-view follow is a one-shot jump on mode switch, not a live
		// coupling between panes. This preserves "same selected block" across
		// PDF/Markdown without reintroducing the old scroll feedback loop.
		setAutoFollowLockUntil(Date.now() + AUTO_FOLLOW_LOCK_MS)
		requestMainPaneFocus(selectedBlock)
	}, [requestMainPaneFocus, selectedBlock, viewMode])

	// Insert a `@[block N]` chip at the cursor of the currently focused note's
	// editor. Returns false if the editor isn't ready (e.g. a card was just
	// expanded and the editor is still mounting), so the caller can stash the
	// block and retry from a `useEffect`.
	const insertCitation = useCallback(
		(block: Block) => {
			if (!editor || !expandedNoteId) return false
			const blockNumber = block.blockIndex + 1
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
				{
					type: "blockCitation",
					props: { paperId, blockId: block.blockId, blockNumber },
				},
				" ",
			])
			return true
		},
		[editor, expandedNoteId, paperId],
	)

	// "Cite or create": if the user already has a note expanded, append the
	// chip to that note. Otherwise create a brand-new note anchored to the
	// block's position, expand it, and queue a citation insert for once the
	// editor mounts (handled by the effect at the bottom).
	const handleBlockAction = useCallback(
		async (block: Block) => {
			if (expandedNoteId) {
				handleSelectBlock(block)
				if (!insertCitation(block)) {
					setPendingCiteBlock(block)
				}
				return
			}
			if (!workspace) return
			const note = await createNote.mutateAsync({
				paperId,
				title: `Page ${block.page}`,
				blocknoteJson: [],
				anchorPage: block.page,
				anchorYRatio: block.bbox?.y ?? null,
				anchorBlockId: block.blockId,
			})
			handleSelectBlock(block)
			setExpandedNoteId(note.id)
			setPendingCiteBlock(block)
		},
		[createNote, expandedNoteId, handleSelectBlock, insertCitation, paperId, workspace],
	)

	const renderActions = useCallback(
		(block: Block) => (
			<button
				aria-label={expandedNoteId ? "Cite this block" : "Add note for this block"}
				className="flex h-7 w-7 items-center justify-center rounded-sm text-text-secondary hover:bg-surface-hover hover:text-text-accent"
				onClick={(e) => {
					e.stopPropagation()
					void handleBlockAction(block)
				}}
				title={expandedNoteId ? "Cite" : "Add note"}
				type="button"
			>
				{expandedNoteId ? <CiteIcon /> : <NoteIcon />}
			</button>
		),
		[expandedNoteId, handleBlockAction],
	)

	const handleSetBlockHighlight = useCallback(
		async (blockId: string, color: string) => {
			if (!workspace) return
			await setBlockHighlight.mutateAsync({ workspaceId: workspace.id, blockId, color })
		},
		[setBlockHighlight, workspace],
	)

	const handleClearBlockHighlight = useCallback(
		async (blockId: string) => {
			if (!workspace) return
			await clearBlockHighlight.mutateAsync({ workspaceId: workspace.id, blockId })
		},
		[clearBlockHighlight, workspace],
	)

	const handleCreateReaderAnnotation = useCallback(
		async (input: {
			page: number
			kind: ReaderAnnotationKind
			color: string
			body: ReaderAnnotationBody
		}) => {
			if (!workspace) return
			await createReaderAnnotation.mutateAsync({ workspaceId: workspace.id, ...input })
		},
		[createReaderAnnotation, workspace],
	)

	const handleDeleteReaderAnnotation = useCallback(
		async (annotationId: string) => {
			await deleteReaderAnnotation.mutateAsync(annotationId)
		},
		[deleteReaderAnnotation],
	)

	const handleUpdateReaderAnnotationColor = useCallback(
		async (annotationId: string, color: string) => {
			await updateReaderAnnotationColor.mutateAsync({ annotationId, color })
		},
		[updateReaderAnnotationColor],
	)

	const colorByBlock = useMemo(() => {
		const map = new Map<string, string>()
		for (const highlight of highlights) map.set(highlight.blockId, highlight.color)
		return map
	}, [highlights])

	// Toolbar `+ Note` — creates a note anchored to the user's current reading
	// position in the main pane.
	const handleCreateAtCurrent = useCallback(async () => {
		if (!workspace) return
		const note = await createNote.mutateAsync({
			paperId,
			title: `Page ${currentPage}`,
			blocknoteJson: [],
			anchorPage: currentPage,
			anchorYRatio: currentAnchorYRatio,
		})
		setExpandedNoteId(note.id)
	}, [createNote, currentAnchorYRatio, currentPage, paperId, workspace])

	const handleDeleteNote = useCallback(
		async (noteId: string) => {
			await deleteNote.mutateAsync(noteId)
			if (expandedNoteId === noteId) setExpandedNoteId(null)
		},
		[deleteNote, expandedNoteId],
	)

	const handleJumpToPage = useCallback((page: number, yRatio?: number) => {
		setRequestedPage(page)
		setRequestedBlockY(yRatio)
		setRequestNonce((n) => n + 1)
	}, [])

	useEffect(() => {
		if (!expandedNoteId) setEditor(null)
	}, [expandedNoteId])

	// Newly-created notes mount their editor a tick after we set
	// `expandedNoteId`. Wait for `onEditorReady` to land via `setEditor`,
	// then drop the queued citation chip.
	useEffect(() => {
		if (!expandedNoteId || !editor || !pendingCiteBlock) return
		if (insertCitation(pendingCiteBlock)) {
			setPendingCiteBlock(null)
		}
	}, [editor, expandedNoteId, insertCitation, pendingCiteBlock])

	const main = (
		<MainView
			autoFollowLockUntil={autoFollowLockUntil}
			blocks={blocks}
			colorByBlock={colorByBlock}
			countsMap={countsMap}
			currentPage={currentPage}
			handleClearBlockHighlight={handleClearBlockHighlight}
			handleClearSelectedBlock={handleClearSelectedBlock}
			handleMainInteract={handleMainInteract}
			handleSelectBlock={handleSelectBlock}
			handleSelectBlockFromPane={handleSelectBlockFromPane}
			handleSetBlockHighlight={handleSetBlockHighlight}
			onViewportAnchorChange={handleViewportAnchorChange}
			palette={palette}
			paperId={paperId}
			readerAnnotations={readerAnnotations}
			renderActions={renderActions}
			requestedBlockY={requestedBlockY}
			requestedPage={requestedPage}
			requestNonce={requestNonce}
			selectedBlockId={selectedBlockId}
			selectedBlockRequestNonce={selectedBlockRequestNonce}
			handleCreateReaderAnnotation={handleCreateReaderAnnotation}
			handleDeleteReaderAnnotation={handleDeleteReaderAnnotation}
			handleUpdateReaderAnnotationColor={handleUpdateReaderAnnotationColor}
			viewMode={viewMode}
		/>
	)

	return (
		<AppShell title={paper?.title ?? "Paper"}>
			<WorkspaceContent
				activeCitingNoteIds={activeCitingNoteIds}
				currentAnchorYRatio={currentAnchorYRatio}
				currentPage={currentPage}
				expandedNoteId={expandedNoteId}
				autoFollowLockUntil={autoFollowLockUntil}
				isLoading={isLoading}
				main={main}
				notes={notesPaneFor(paperNotes)}
				notesVisible={notesVisible}
				onCreateAtCurrent={handleCreateAtCurrent}
				onDeleteNote={handleDeleteNote}
				onEditorReady={setEditor}
				onExpand={setExpandedNoteId}
				onJumpToPage={handleJumpToPage}
				onOpenCitationBlock={handleOpenCitationBlock}
				onToggleNotes={() =>
					setNotesVisible((value) => {
						if (value) setExpandedNoteId(null)
						return !value
					})
				}
				paper={paper}
				viewMode={viewMode}
				onChangeViewMode={setViewMode}
			/>
		</AppShell>
	)
}

function notesPaneFor(notes: ReturnType<typeof useNotes>["data"]) {
	return notes ?? []
}

interface WorkspaceContentProps {
	activeCitingNoteIds: Set<string>
	autoFollowLockUntil: number
	currentAnchorYRatio: number
	currentPage: number
	expandedNoteId: string | null
	isLoading: boolean
	main: React.ReactNode
	notes: Note[]
	notesVisible: boolean
	onChangeViewMode: (mode: ViewMode) => void
	onCreateAtCurrent: () => void
	onDeleteNote: (noteId: string) => Promise<void> | void
	onEditorReady: (editor: NoteEditorRef) => void
	onExpand: (noteId: string | null) => void
	onJumpToPage: (page: number, yRatio?: number) => void
	onOpenCitationBlock: (paperId: string, blockId: string) => void
	onToggleNotes: () => void
	paper: Paper | undefined
	viewMode: ViewMode
}

function WorkspaceContent({
	activeCitingNoteIds,
	autoFollowLockUntil,
	currentAnchorYRatio,
	currentPage,
	expandedNoteId,
	isLoading,
	main,
	notes,
	notesVisible,
	onChangeViewMode,
	onCreateAtCurrent,
	onDeleteNote,
	onEditorReady,
	onExpand,
	onJumpToPage,
	onOpenCitationBlock,
	onToggleNotes,
	paper,
	viewMode,
}: WorkspaceContentProps) {
	const { isLeftNavOpen, toggleLeftNav } = useAppShellLayout()

	return isLoading ? (
		<div className="p-8 text-sm text-text-tertiary">Loading…</div>
	) : !paper ? (
		<div className="p-8 text-sm text-text-tertiary">Not found.</div>
	) : (
		<div className="relative flex h-full min-h-0 flex-col">
			<ParseStatusBanner paper={paper} />

			<div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-subtle bg-bg-secondary px-4 py-2 text-sm">
				<ViewModeToggle current={viewMode} onChange={onChangeViewMode} />
				<SidebarToggleButtons
					leftOpen={isLeftNavOpen}
					onToggleLeft={toggleLeftNav}
					onToggleRight={onToggleNotes}
					rightOpen={notesVisible}
				/>
			</div>

			<div className="min-h-0 flex-1 p-6">
				<MainNotesSplit
					activeCitingNoteIds={activeCitingNoteIds}
					currentAnchorYRatio={currentAnchorYRatio}
					currentPage={currentPage}
					expandedNoteId={expandedNoteId}
					autoFollowLockUntil={autoFollowLockUntil}
					main={main}
					notes={notes}
					notesVisible={notesVisible}
					onCreateAtCurrent={onCreateAtCurrent}
					onDeleteNote={onDeleteNote}
					onEditorReady={onEditorReady}
					onExpand={onExpand}
					onJumpToPage={onJumpToPage}
					onOpenCitationBlock={onOpenCitationBlock}
				/>
			</div>
		</div>
	)
}

function ViewModeToggle({
	current,
	onChange,
}: {
	current: ViewMode
	onChange: (mode: ViewMode) => void
}) {
	const buttons: Array<{
		key: ViewMode
		ariaLabel: string
		content: React.ReactNode
	}> = [
		{ key: "pdf-only", ariaLabel: "Show PDF", content: <PdfIcon /> },
		{ key: "md-only", ariaLabel: "Show Markdown", content: <MarkdownIcon /> },
	]
	return (
		<div className="inline-flex overflow-hidden rounded-md border border-border-default text-xs">
			{buttons.map((b) => (
				<button
					aria-label={b.ariaLabel}
					aria-pressed={current === b.key}
					className={`flex h-7 min-w-[40px] items-center justify-center px-3 transition-colors ${
						current === b.key
							? "bg-accent-600 text-text-inverse"
							: "bg-transparent text-text-secondary hover:bg-surface-hover"
					}`}
					key={b.key}
					onClick={() => onChange(b.key)}
					type="button"
				>
					{b.content}
				</button>
			))}
		</div>
	)
}

function PdfIcon() {
	// Document with a folded corner + "PDF" label — matches the
	// rounded-rect aesthetic of the Markdown mark.
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
			<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
			<path d="M14 2v6h6" />
			<text
				fill="currentColor"
				fontFamily="ui-sans-serif, system-ui"
				fontSize="6"
				fontWeight="700"
				stroke="none"
				textAnchor="middle"
				x="12"
				y="17.4"
			>
				PDF
			</text>
		</svg>
	)
}

function MarkdownIcon() {
	// Official Markdown mark (CommonMark) — rounded rect + "M↓".
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="13"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.6"
			viewBox="0 0 208 128"
			width="20"
		>
			<rect height="120" rx="16" ry="16" width="200" x="4" y="4" />
			<path d="M30 98V30h20l20 25 20-25h20v68H90V59L70 84 50 59v39H30Z" fill="currentColor" stroke="none" />
			<path d="M150 98V30h20v40h20l-30 33-30-33h20" fill="currentColor" stroke="none" />
		</svg>
	)
}

function SidebarToggleButtons({
	leftOpen,
	rightOpen,
	onToggleLeft,
	onToggleRight,
}: {
	leftOpen: boolean
	rightOpen: boolean
	onToggleLeft: () => void
	onToggleRight: () => void
}) {
	return (
		<div className="inline-flex overflow-hidden rounded-lg border border-border-default bg-bg-primary/90 p-0.5 shadow-[var(--shadow-popover)]">
			<button
				aria-label={leftOpen ? "Collapse workspace sidebar" : "Expand workspace sidebar"}
				aria-pressed={leftOpen}
				className="flex h-7 w-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-accent"
				onClick={onToggleLeft}
				title={leftOpen ? "Collapse workspace sidebar" : "Expand workspace sidebar"}
				type="button"
			>
				<SidebarIcon open={leftOpen} side="left" />
			</button>
			<button
				aria-label={rightOpen ? "Collapse notes sidebar" : "Expand notes sidebar"}
				aria-pressed={rightOpen}
				className="flex h-7 w-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-accent"
				onClick={onToggleRight}
				title={rightOpen ? "Collapse notes sidebar" : "Expand notes sidebar"}
				type="button"
			>
				<SidebarIcon open={rightOpen} side="right" />
			</button>
		</div>
	)
}

function SidebarIcon({ side, open }: { side: "left" | "right"; open: boolean }) {
	if (side === "left") {
		return (
			<span
				className={`flex h-4 w-5 overflow-hidden rounded-[5px] border transition-colors ${
					open ? "border-current/55 bg-transparent" : "border-current/35 bg-current/10"
				}`}
			>
				<span
					className={`transition-colors ${open ? "w-2 bg-current/80" : "w-2 bg-transparent"}`}
				/>
				<span className={`w-px transition-colors ${open ? "bg-current/45" : "bg-current/30"}`} />
				<span className={`flex-1 transition-colors ${open ? "bg-transparent" : "bg-current/20"}`} />
			</span>
		)
	}
	return (
		<span
			className={`flex h-4 w-5 overflow-hidden rounded-[5px] border transition-colors ${
				open ? "border-current/55 bg-transparent" : "border-current/35 bg-current/10"
			}`}
		>
			<span className={`flex-1 transition-colors ${open ? "bg-transparent" : "bg-current/20"}`} />
			<span className={`w-px transition-colors ${open ? "bg-current/45" : "bg-current/30"}`} />
			<span className={`transition-colors ${open ? "w-2 bg-current/80" : "w-2 bg-transparent"}`} />
		</span>
	)
}

interface MainViewProps {
	autoFollowLockUntil: number
	blocks: Block[] | undefined
	colorByBlock: Map<string, string>
	countsMap: Map<string, number>
	currentPage: number
	handleClearBlockHighlight: (blockId: string) => Promise<void> | void
	handleClearSelectedBlock: () => void
	handleMainInteract: () => void
	handleSelectBlock: (block: Block) => void
	handleSelectBlockFromPane: (block: Block) => void
	handleSetBlockHighlight: (blockId: string, color: string) => Promise<void> | void
	handleCreateReaderAnnotation: (input: {
		page: number
		kind: ReaderAnnotationKind
		color: string
		body: ReaderAnnotationBody
	}) => Promise<unknown> | unknown
	handleDeleteReaderAnnotation: (annotationId: string) => Promise<unknown> | unknown
	handleUpdateReaderAnnotationColor: (
		annotationId: string,
		color: string,
	) => Promise<unknown> | unknown
	onViewportAnchorChange: (page: number, yRatio: number) => void
	palette: ReturnType<typeof usePalette>["palette"]
	paperId: string
	readerAnnotations: ReaderAnnotation[]
	renderActions: (block: Block) => React.ReactNode
	requestedBlockY: number | undefined
	requestedPage: number | undefined
	requestNonce: number
	selectedBlockId: string | null
	selectedBlockRequestNonce: number
	viewMode: ViewMode
}

// Lazy-mount + keep-mounted: each view mode is mounted the first time it
// becomes active and stays in the tree thereafter, hidden via `display: none`
// when inactive. Without this, every PDF↔Markdown toggle paid the cold-mount
// cost (BlocksPanel effects + KaTeX rendering, react-pdf re-init), which
// surfaced as a ~1s freeze on the first switch and noticeable jank on every
// switch after. Hidden panels still receive prop updates, so cross-view
// follow requests (`requestedPage`/nonce) leave the inactive panel scrolled
// to the right spot — toggling back is instant and already aligned.
const MainView = memo(function MainView(props: MainViewProps) {
	const visitedRef = useRef<Set<ViewMode>>(new Set([props.viewMode]))
	visitedRef.current.add(props.viewMode)

	const sectionClass =
		"h-full min-h-0 overflow-hidden rounded-lg border border-border-subtle bg-[var(--color-reading-bg)]"

	return (
		<>
			{visitedRef.current.has("pdf-only") ? (
				<section className={sectionClass} hidden={props.viewMode !== "pdf-only"}>
					<PdfViewer
						blocks={props.blocks}
						colorByBlock={props.colorByBlock}
						onClearHighlight={props.handleClearBlockHighlight}
						onCreateReaderAnnotation={props.handleCreateReaderAnnotation}
						onDeleteReaderAnnotation={props.handleDeleteReaderAnnotation}
						onUpdateReaderAnnotationColor={props.handleUpdateReaderAnnotationColor}
						onClearSelectedBlock={props.handleClearSelectedBlock}
						onInteract={props.handleMainInteract}
						onViewportAnchorChange={props.onViewportAnchorChange}
						onSelectBlock={props.handleSelectBlock}
						onSetHighlight={props.handleSetBlockHighlight}
						palette={props.palette}
						paperId={props.paperId}
						readerAnnotations={props.readerAnnotations}
						renderActions={props.renderActions}
						requestedBlockY={props.requestedBlockY}
						requestedPage={props.requestedPage}
						requestedPageNonce={props.requestNonce}
						selectedBlockId={props.selectedBlockId}
					/>
				</section>
			) : null}
			{visitedRef.current.has("md-only") ? (
				<section className={sectionClass} hidden={props.viewMode !== "md-only"}>
					<BlocksPanel
						citationCounts={props.countsMap}
						colorByBlock={props.colorByBlock}
						currentPage={props.currentPage}
						externalFollowLockUntil={props.autoFollowLockUntil}
						onClearHighlight={props.handleClearBlockHighlight}
						onInteract={props.handleMainInteract}
						onViewportAnchorChange={props.onViewportAnchorChange}
						onSelectBlock={props.handleSelectBlockFromPane}
						onSetHighlight={props.handleSetBlockHighlight}
						paperId={props.paperId}
						palette={props.palette}
						followCurrentPage={props.viewMode === "pdf-only"}
						requestedAnchorYRatio={props.requestedBlockY}
						requestedPage={props.requestedPage}
						requestedPageNonce={props.requestNonce}
						renderActions={props.renderActions}
						selectedBlockId={props.selectedBlockId}
						selectedBlockRequestNonce={props.selectedBlockRequestNonce}
					/>
				</section>
			) : null}
		</>
	)
})

MainView.displayName = "MainView"

import type { Note } from "@/api/hooks/notes"

interface MainNotesSplitProps {
	activeCitingNoteIds: Set<string>
	autoFollowLockUntil: number
	main: React.ReactNode
	notes: Note[]
	expandedNoteId: string | null
	currentAnchorYRatio: number
	currentPage: number
	notesVisible: boolean
	onExpand: (noteId: string | null) => void
	onJumpToPage: (page: number, yRatio?: number) => void
	onCreateAtCurrent: () => void
	onDeleteNote: (noteId: string) => Promise<void> | void
	onEditorReady: (editor: NoteEditorRef) => void
	onOpenCitationBlock: (paperId: string, blockId: string) => void
}

function MainNotesSplit({
	activeCitingNoteIds,
	autoFollowLockUntil,
	main,
	notes,
	expandedNoteId,
	currentAnchorYRatio,
	currentPage,
	notesVisible,
	onExpand,
	onJumpToPage,
	onCreateAtCurrent,
	onDeleteNote,
	onEditorReady,
	onOpenCitationBlock,
}: MainNotesSplitProps) {
	const wrapRef = useRef<HTMLDivElement | null>(null)
	const [leftPct, setLeftPct] = useState<number>(() => {
		if (typeof window === "undefined") return 83
		const stored = window.localStorage.getItem(NOTES_WIDTH_KEY)
		const n = stored ? Number(stored) : NaN
		return Number.isFinite(n) && n >= 55 && n <= 90 ? n : 83
	})
	const [dragging, setDragging] = useState(false)
	const dragRef = useRef<{ startX: number; startPct: number; wrapW: number } | null>(null)

	const onPointerDown = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			if (!wrapRef.current) return
			e.preventDefault()
			;(e.target as HTMLElement).setPointerCapture(e.pointerId)
			dragRef.current = {
				startX: e.clientX,
				startPct: leftPct,
				wrapW: wrapRef.current.getBoundingClientRect().width,
			}
			setDragging(true)
		},
		[leftPct],
	)
	const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
		const s = dragRef.current
		if (!s) return
		const deltaPct = ((e.clientX - s.startX) / s.wrapW) * 100
		setLeftPct(Math.max(55, Math.min(90, s.startPct + deltaPct)))
	}, [])
	const onPointerUp = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			if (!dragRef.current) return
			;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
			dragRef.current = null
			setDragging(false)
			if (typeof window !== "undefined") {
				window.localStorage.setItem(NOTES_WIDTH_KEY, String(leftPct))
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
			className={`grid h-full min-h-0 min-w-0 gap-0 ${
				notesVisible ? "grid-cols-[var(--left)_8px_minmax(280px,1fr)]" : "grid-cols-[minmax(0,1fr)]"
			}`}
			ref={wrapRef}
			style={{ ["--left" as string]: `${leftPct}%` }}
		>
			<div className="min-h-0 min-w-0">{main}</div>
			{notesVisible ? (
				<>
					{/* biome-ignore lint/a11y/useSemanticElements: <hr> can't host pointer handlers; role="separator" is the correct ARIA */}
					<div
						aria-label="Resize main / notes split"
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
					<div className="min-h-0 min-w-0 overflow-hidden rounded-lg border border-border-subtle bg-[var(--color-reading-bg)]">
						<NotesPanel
							activeCitingNoteIds={activeCitingNoteIds}
							currentAnchorYRatio={currentAnchorYRatio}
							currentPage={currentPage}
							externalFollowLockUntil={autoFollowLockUntil}
							expandedNoteId={expandedNoteId}
							notes={notes}
							onCreateAtCurrent={onCreateAtCurrent}
							onDelete={onDeleteNote}
							onEditorReady={onEditorReady}
							onExpand={onExpand}
							onJumpToPage={onJumpToPage}
							onOpenCitationBlock={onOpenCitationBlock}
						/>
					</div>
				</>
			) : null}
		</div>
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
		<div className="shrink-0 border-[oklch(0.45_0.13_25)] border-b bg-[oklch(0.93_0.035_25)] px-6 py-3 text-sm">
			<div className="text-text-error">Parsing failed. {paper.parseError ?? "Unknown error."}</div>
			{needsCredentials ? (
				<Link className="mt-1 inline-block text-text-accent hover:underline" to="/settings">
					Configure MinerU →
				</Link>
			) : null}
		</div>
	)
}

function CiteIcon() {
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
