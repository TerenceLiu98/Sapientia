import { Link } from "@tanstack/react-router"
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { type Block, useBlocks } from "@/api/hooks/blocks"
import {
	useNotesForBlock,
	usePaperCitationCounts,
	usePaperNoteCitations,
} from "@/api/hooks/citations"
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
import { PdfViewer, type PdfRailLayout } from "@/components/reader/PdfViewer"
import { paletteVisualTokens, usePalette } from "@/lib/highlight-palette"
import {
	annotationBodyBoundingBox,
	type ReaderAnnotationBody,
	type ReaderAnnotationKind,
} from "@/lib/reader-annotations"

type ViewMode = "pdf-only" | "md-only"

const VIEW_MODE_KEY = "paperWorkspace.viewMode"
const AUTO_FOLLOW_LOCK_MS = 1400

function loadViewMode(): ViewMode {
	if (typeof window === "undefined") return "pdf-only"
	const v = window.localStorage.getItem(VIEW_MODE_KEY)
	return v === "pdf-only" || v === "md-only" ? v : "pdf-only"
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
	const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null)
	const [optimisticNotes, setOptimisticNotes] = useState<Note[]>([])
	const [pdfRailLayout, setPdfRailLayout] = useState<PdfRailLayout | null>(null)
	const editorRef = useRef<NoteEditorRef | null>(null)
	const [editorReadyVersion, setEditorReadyVersion] = useState(0)
	const [pendingCiteBlock, setPendingCiteBlock] = useState<Block | null>(null)
	const [pendingCiteAnnotation, setPendingCiteAnnotation] = useState<ReaderAnnotation | null>(null)
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
		setOptimisticNotes([])
		setPdfRailLayout(null)
	}, [paperId, workspace?.id])

	const upsertOptimisticNote = useCallback((note: Note) => {
		setOptimisticNotes((current) => [note, ...current.filter((candidate) => candidate.id !== note.id)])
	}, [])

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
			selectedBlockId
				? ((blocks ?? []).find((block) => block.blockId === selectedBlockId) ?? null)
				: null,
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

	// `flashedAnnotationId` triggers a brief pulse on the matching markup
	// shape after a citation chip jumps the viewport. The visual cue is the
	// whole point of citing an annotation — without it the reader lands on
	// the page but has no idea which highlight/underline they were supposed
	// to be looking at. Auto-clears after 1.5s; consecutive clicks reset
	// the timer so a quick second click doesn't strand a stale flash.
	const [flashedAnnotationId, setFlashedAnnotationId] = useState<string | null>(null)
	const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const flashAnnotation = useCallback((annotationId: string) => {
		setFlashedAnnotationId(annotationId)
		if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
		flashTimerRef.current = setTimeout(() => {
			setFlashedAnnotationId(null)
			flashTimerRef.current = null
		}, 1500)
	}, [])
	useEffect(() => {
		return () => {
			if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
		}
	}, [])

	const handleOpenCitationAnnotation = useCallback(
		(
			targetPaperId: string,
			annotationId: string,
			fallbackPage?: number,
			fallbackYRatio?: number,
		) => {
			if (targetPaperId !== paperId) return
			const annotation =
				readerAnnotations.find((candidate) => candidate.id === annotationId) ?? null
			if (!annotation) {
				if (fallbackPage) {
					setRequestedPage(fallbackPage)
					setRequestedBlockY(fallbackYRatio)
					setRequestNonce((n) => n + 1)
				}
				return
			}
			const bbox = annotationBodyBoundingBox(annotation.kind, annotation.body)
			setAutoFollowLockUntil(Date.now() + AUTO_FOLLOW_LOCK_MS)
			setRequestedPage(annotation.page)
			setRequestedBlockY(bbox?.y ?? fallbackYRatio)
			setRequestNonce((n) => n + 1)
			flashAnnotation(annotation.id)
		},
		[flashAnnotation, paperId, readerAnnotations],
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
			const editor = editorRef.current
			if (!editor || !expandedNoteId) return false
			const blockNumber = block.blockIndex + 1
			// Tiptap's selection always has a position even before first focus.
			// Force-focus to end of doc only if the editor was never focused —
			// otherwise we'd yank the cursor away from where the user is mid-
			// edit.
			if (!editor.isFocused) {
				editor.chain().focus("end").run()
			} else {
				editor.chain().focus().run()
			}
			editor
				.chain()
				.insertContent([
					{
						type: "blockCitation",
						attrs: {
							paperId,
							blockId: block.blockId,
							blockNumber,
							snapshot: blockCitationSnapshot(block),
						},
					},
					{ type: "text", text: " " },
				])
				.run()
			return true
		},
		[expandedNoteId, paperId],
	)

	const insertAnnotationCitation = useCallback(
		(annotation: ReaderAnnotation) => {
			const editor = editorRef.current
			if (!editor || !expandedNoteId) return false
			if (annotation.kind !== "highlight" && annotation.kind !== "underline") return false
			const bbox = annotationBodyBoundingBox(annotation.kind, annotation.body)
			const overlappingBlock = bbox
				? findOverlappingBlock(blocks ?? [], annotation.page, bbox)
				: null
			if (!editor.isFocused) {
				editor.chain().focus("end").run()
			} else {
				editor.chain().focus().run()
			}
			editor
				.chain()
				.insertContent([
					{
						type: "annotationCitation",
						attrs: {
							paperId,
							annotationId: annotation.id,
							annotationKind: annotation.kind,
							page: annotation.page,
							yRatio: bbox?.y ?? 0.5,
							color: annotation.color,
							snapshot: annotationCitationSnapshot(
								annotation,
								overlappingBlock,
								readerAnnotations,
								blocks ?? [],
							),
						},
					},
					{ type: "text", text: " " },
				])
				.run()
			return true
		},
		[blocks, expandedNoteId, paperId, readerAnnotations],
	)

	// "Cite or create": if the user already has a note expanded, append the
	// chip to that note. Otherwise create a brand-new note anchored to the
	// block's position, expand it, and queue a citation insert for once the
	// editor mounts (handled by the effect at the bottom).
	// Cite-only: insert a `@[block N]` chip into the currently open note.
	// No-op if no note is open — the toolbar disables the button in that
	// case so this branch is just a safety net.
	const handleCiteBlock = useCallback(
		(block: Block) => {
			if (!expandedNoteId) return
			handleSelectBlock(block)
			if (!insertCitation(block)) setPendingCiteBlock(block)
		},
		[expandedNoteId, handleSelectBlock, insertCitation],
	)

	// New-note-only: always create a fresh block-anchored note. If a
	// note is already open we close it first so the new one slides in
	// cleanly.
	const handleNewNoteForBlock = useCallback(
		async (block: Block) => {
			if (!workspace) return
			if (expandedNoteId) setExpandedNoteId(null)
			const note = await createNote.mutateAsync({
				paperId,
				blocknoteJson: [],
				anchorPage: block.page,
				anchorYRatio: block.bbox?.y ?? null,
				anchorKind: "block",
				anchorBlockId: block.blockId,
			})
			upsertOptimisticNote(note)
			handleSelectBlock(block)
			setExpandedNoteId(note.id)
			setPendingCiteBlock(block)
		},
		[createNote, expandedNoteId, handleSelectBlock, paperId, upsertOptimisticNote, workspace],
	)

	const handleCiteAnnotation = useCallback(
		(annotation: ReaderAnnotation) => {
			if (!expandedNoteId) return
			if (annotation.kind !== "highlight" && annotation.kind !== "underline") return
			if (!insertAnnotationCitation(annotation)) setPendingCiteAnnotation(annotation)
		},
		[expandedNoteId, insertAnnotationCitation],
	)

	const handleNewNoteForAnnotation = useCallback(
		async (annotation: ReaderAnnotation) => {
			if (annotation.kind !== "highlight" && annotation.kind !== "underline") return
			if (!workspace) return
			if (expandedNoteId) setExpandedNoteId(null)
			const bbox = annotationBodyBoundingBox(annotation.kind, annotation.body)
			// Resolve the block this annotation visually overlaps so the
			// note carries a stable structural anchor — block ids survive
			// re-parse, annotation ids don't.
			const overlappingBlock = bbox
				? findOverlappingBlock(blocks ?? [], annotation.page, bbox)
				: null
			const note = await createNote.mutateAsync({
				paperId,
				blocknoteJson: [],
				anchorPage: annotation.page,
				anchorYRatio: bbox?.y ?? 0.5,
				anchorKind: annotation.kind,
				anchorAnnotationId: annotation.id,
				anchorBlockId: overlappingBlock?.blockId ?? null,
			})
			upsertOptimisticNote(note)
			setExpandedNoteId(note.id)
			setPendingCiteAnnotation(annotation)
		},
		[blocks, createNote, expandedNoteId, paperId, upsertOptimisticNote, workspace],
	)

	// Single action per state so block + markup stay consistent:
	//   • No note open  -> Add note
	//   • Note open     -> Cite into that note
	const renderActions = useCallback(
		(block: Block) => (
			<button
				aria-label={
					expandedNoteId ? "Cite this block in the open note" : "Add a new note for this block"
				}
				className="flex h-7 w-7 items-center justify-center rounded-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-accent"
				onClick={(e) => {
					e.stopPropagation()
					if (expandedNoteId) {
						handleCiteBlock(block)
						return
					}
					void handleNewNoteForBlock(block)
				}}
				title={expandedNoteId ? "Cite in open note" : "New note"}
				type="button"
			>
				{expandedNoteId ? <CiteIcon /> : <NoteIcon />}
			</button>
		),
		[expandedNoteId, handleCiteBlock, handleNewNoteForBlock],
	)

	const renderAnnotationActions = useCallback(
		(annotation: ReaderAnnotation) => {
			if (annotation.kind !== "highlight" && annotation.kind !== "underline") return null
			return (
				<button
					aria-label={
						expandedNoteId
							? "Cite this annotation in the open note"
							: "Add a new note for this annotation"
					}
					className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-accent"
					onClick={(e) => {
						e.stopPropagation()
						if (expandedNoteId) {
							handleCiteAnnotation(annotation)
							return
						}
						void handleNewNoteForAnnotation(annotation)
					}}
					title={expandedNoteId ? "Cite in open note" : "New note"}
					type="button"
				>
					{expandedNoteId ? <CiteIcon /> : <NoteIcon />}
				</button>
			)
		},
		[expandedNoteId, handleCiteAnnotation, handleNewNoteForAnnotation],
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

	// Resolve a block highlight's palette key into a CSS color via
	// `paletteVisualTokens`. The block_highlights table stores the
	// palette key (e.g. "questioning"), not a CSS color, so the
	// marginalia rail can't paint dots straight from `colorByBlock`.
	const cssColorByBlock = useMemo(() => {
		const map = new Map<string, string>()
		for (const [blockId, key] of colorByBlock.entries()) {
			map.set(blockId, paletteVisualTokens(palette, key).fillBg)
		}
		return map
	}, [colorByBlock, palette])

	// annotationId → its display color. Reader annotations store their
	// color directly as a CSS string, so this is a straight pass-through.
	const colorByAnnotation = useMemo(() => {
		const map = new Map<string, string>()
		for (const annotation of readerAnnotations) map.set(annotation.id, annotation.color)
		return map
	}, [readerAnnotations])

	// All cited blocks + annotations per note, grouped by note. Drives
	// the marginalia rail dot's pie-chart fill when a note cites
	// multiple sources.
	const { data: noteCitations } = usePaperNoteCitations(paperId)
	const dotColorsByNote = useMemo(() => {
		const map = new Map<string, string[]>()
		for (const row of noteCitations ?? []) {
			const colors: string[] = []
			const seen = new Set<string>()
			for (const blockId of row.blockIds) {
				const css = cssColorByBlock.get(blockId)
				if (css && !seen.has(css)) {
					seen.add(css)
					colors.push(css)
				}
			}
			for (const annotation of row.annotations) {
				const css = colorByAnnotation.get(annotation.id)
				if (css && !seen.has(css)) {
					seen.add(css)
					colors.push(css)
				}
			}
			if (colors.length > 0) map.set(row.noteId, colors)
		}
		return map
	}, [colorByAnnotation, cssColorByBlock, noteCitations])

	const previewedAnnotationId = useMemo(() => {
		if (!expandedNoteId) return null
		const expandedNote = paperNotes.find((candidate) => candidate.id === expandedNoteId) ?? null
		if (!expandedNote) return null
		if (expandedNote.anchorKind !== "highlight" && expandedNote.anchorKind !== "underline") return null
		return expandedNote.anchorAnnotationId ?? null
	}, [expandedNoteId, paperNotes])

	// Total page count for the marginalia rail, so each dot can land at
	// `((page-1) + yRatio) / numPages` along the rail. Falls back to 1 so
	// notes still render reasonably while the paper is mid-parse.
	const numPages = useMemo(() => {
		if (!blocks || blocks.length === 0) return 1
		let max = 1
		for (const block of blocks) {
			if (block.page > max) max = block.page
		}
		return max
	}, [blocks])

	const blockAnchorsById = useMemo(() => {
		const map = new Map<string, { page: number; yRatio: number }>()
		for (const block of blocks ?? []) {
			map.set(block.blockId, {
				page: block.page,
				yRatio: block.bbox?.y ?? 0.5,
			})
		}
		return map
	}, [blocks])

	// blockId → 1-based blockIndex. Drives the marginalia kicker tags so a
	// block-anchored slip reads "block 7" instead of just "block". Lookup
	// only — never store; the index changes on re-parse.
	const blockNumberByBlockId = useMemo(() => {
		const map = new Map<string, number>()
		for (const block of blocks ?? []) map.set(block.blockId, block.blockIndex + 1)
		return map
	}, [blocks])

	// Toolbar `+ Note` — creates a note anchored to the user's current reading
	// position in the main pane.
	const handleCreateAtCurrent = useCallback(async () => {
		if (!workspace) return
		const note = await createNote.mutateAsync({
			paperId,
			blocknoteJson: [],
			anchorPage: currentPage,
			anchorYRatio: currentAnchorYRatio,
		})
		upsertOptimisticNote(note)
		setExpandedNoteId(note.id)
	}, [createNote, currentAnchorYRatio, currentPage, paperId, upsertOptimisticNote, workspace])

	const handleDeleteNote = useCallback(
		async (noteId: string) => {
			await deleteNote.mutateAsync(noteId)
			setOptimisticNotes((current) => current.filter((note) => note.id !== noteId))
			if (expandedNoteId === noteId) setExpandedNoteId(null)
		},
		[deleteNote, expandedNoteId],
	)

	const handleJumpToPage = useCallback((page: number, yRatio?: number) => {
		setRequestedPage(page)
		setRequestedBlockY(yRatio)
		setRequestNonce((n) => n + 1)
	}, [])

	const handleEditorReady = useCallback((editor: NoteEditorRef) => {
		const shouldSignalReady = editorRef.current == null
		editorRef.current = editor
		if (shouldSignalReady) {
			setEditorReadyVersion((version) => version + 1)
		}
	}, [])

	useEffect(() => {
		editorRef.current = null
	}, [expandedNoteId])

	// Newly-created notes mount their editor a tick after we set
	// `expandedNoteId`. Wait for `onEditorReady` to signal readiness,
	// then drop the queued citation chip.
	useEffect(() => {
		if (!expandedNoteId || !editorRef.current || !pendingCiteBlock) return
		if (insertCitation(pendingCiteBlock)) {
			setPendingCiteBlock(null)
		}
	}, [editorReadyVersion, expandedNoteId, insertCitation, pendingCiteBlock])

	useEffect(() => {
		if (!expandedNoteId || !editorRef.current || !pendingCiteAnnotation) return
		if (insertAnnotationCitation(pendingCiteAnnotation)) {
			setPendingCiteAnnotation(null)
		}
	}, [editorReadyVersion, expandedNoteId, insertAnnotationCitation, pendingCiteAnnotation])

	const notes = useMemo(() => notesPaneFor(paperNotes, optimisticNotes), [paperNotes, optimisticNotes])

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
			renderAnnotationActions={renderAnnotationActions}
			renderActions={renderActions}
			requestedBlockY={requestedBlockY}
			requestedPage={requestedPage}
			requestNonce={requestNonce}
			selectedBlockId={selectedBlockId}
			selectedBlockRequestNonce={selectedBlockRequestNonce}
			handleCreateReaderAnnotation={handleCreateReaderAnnotation}
			handleDeleteReaderAnnotation={handleDeleteReaderAnnotation}
			handleOpenCitationAnnotation={handleOpenCitationAnnotation}
			handleUpdateReaderAnnotationColor={handleUpdateReaderAnnotationColor}
			flashedAnnotationId={flashedAnnotationId}
			onRailLayoutChange={setPdfRailLayout}
			previewedAnnotationId={previewedAnnotationId}
			viewMode={viewMode}
		/>
	)

	return (
		<AppShell title={paper?.title ?? "Paper"}>
			<WorkspaceContent
				activeCitingNoteIds={activeCitingNoteIds}
				blockNumberByBlockId={blockNumberByBlockId}
				blockAnchorsById={blockAnchorsById}
				colorByAnnotation={colorByAnnotation}
				colorByBlock={cssColorByBlock}
				dotColorsByNote={dotColorsByNote}
				numPages={numPages}
				pdfRailLayout={pdfRailLayout}
				currentAnchorYRatio={currentAnchorYRatio}
				currentPage={currentPage}
				expandedNoteId={expandedNoteId}
				autoFollowLockUntil={autoFollowLockUntil}
				isLoading={isLoading}
				main={main}
				notes={notes}
				onCreateAtCurrent={handleCreateAtCurrent}
				onDeleteNote={handleDeleteNote}
				onEditorReady={handleEditorReady}
				onExpand={setExpandedNoteId}
				onJumpToPage={handleJumpToPage}
				onOpenCitationBlock={handleOpenCitationBlock}
				onOpenCitationAnnotation={handleOpenCitationAnnotation}
				paper={paper}
				viewMode={viewMode}
				onChangeViewMode={setViewMode}
			/>
		</AppShell>
	)
}

function notesPaneFor(notes: ReturnType<typeof useNotes>["data"], optimisticNotes: Note[]) {
	const persisted = notes ?? []
	if (optimisticNotes.length === 0) return persisted
	const persistedIds = new Set(persisted.map((note) => note.id))
	return [...optimisticNotes.filter((note) => !persistedIds.has(note.id)), ...persisted]
}

// Pick the block whose bbox the annotation's center falls inside on the
// given page. Used at note-creation time so a highlight/underline note
// carries the structural block as a secondary anchor — block ids are
// stable across re-parse, annotation ids aren't, so this is the
// jump-to-anchor fallback when the user later deletes the markup.
function findOverlappingBlock(
	blocks: Block[],
	page: number,
	bbox: { x: number; y: number; w: number; h: number },
): Block | null {
	const cx = bbox.x + bbox.w / 2
	const cy = bbox.y + bbox.h / 2
	const onPage = blocks.filter((block) => block.page === page && block.bbox != null)
	for (const block of onPage) {
		if (!block.bbox) continue
		const { x, y, w, h } = block.bbox
		if (cx >= x && cx <= x + w && cy >= y && cy <= y + h) {
			return block
		}
	}
	return null
}

function blockCitationSnapshot(block: Block) {
	const raw = (block.caption ?? block.text ?? "").replace(/\s+/g, " ").trim()
	if (!raw) return ""
	return raw.length > 160 ? `${raw.slice(0, 157)}...` : raw
}

function annotationCitationSnapshot(
	annotation: ReaderAnnotation,
	block: Block | null,
	annotations: ReaderAnnotation[],
	blocks: Block[],
) {
	const kind = annotation.kind === "underline" ? "underline" : "highlight"
	const ordinal = annotationOrdinal(annotation, block, annotations, blocks)
	const prefix: string[] = []
	if (annotation.page > 0) prefix.push(`p${annotation.page}`)
	if (block) prefix.push(`blk${block.blockIndex + 1}`)
	prefix.push(kind)
	return `${prefix.join(".")} ${ordinal}`
}

function annotationOrdinal(
	annotation: ReaderAnnotation,
	block: Block | null,
	annotations: ReaderAnnotation[],
	blocks: Block[],
) {
	if (!block) return 1
	const peers = annotations
		.filter((candidate) => {
			if (candidate.kind !== annotation.kind) return false
			if (candidate.page !== annotation.page) return false
			const bbox = annotationBodyBoundingBox(candidate.kind, candidate.body)
			const candidateBlock = bbox ? findOverlappingBlock(blocks, candidate.page, bbox) : null
			return candidateBlock?.blockId === block.blockId
		})
		.sort((a, b) => {
			const createdDelta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
			if (createdDelta !== 0) return createdDelta
			return a.id.localeCompare(b.id)
		})
	const index = peers.findIndex((candidate) => candidate.id === annotation.id)
	return index >= 0 ? index + 1 : peers.length + 1
}

interface WorkspaceContentProps {
	activeCitingNoteIds: Set<string>
	autoFollowLockUntil: number
	blockAnchorsById: Map<string, { page: number; yRatio: number }>
	blockNumberByBlockId: Map<string, number>
	colorByAnnotation: Map<string, string>
	colorByBlock: Map<string, string>
	dotColorsByNote: Map<string, string[]>
	numPages: number
	pdfRailLayout: PdfRailLayout | null
	currentAnchorYRatio: number
	currentPage: number
	expandedNoteId: string | null
	isLoading: boolean
	main: React.ReactNode
	notes: Note[]
	onChangeViewMode: (mode: ViewMode) => void
	onCreateAtCurrent: () => void
	onDeleteNote: (noteId: string) => Promise<void> | void
	onEditorReady: (editor: NoteEditorRef) => void
	onExpand: (noteId: string | null) => void
	onJumpToPage: (page: number, yRatio?: number) => void
	onOpenCitationBlock: (paperId: string, blockId: string) => void
	onOpenCitationAnnotation: (
		paperId: string,
		annotationId: string,
		page?: number,
		yRatio?: number,
	) => void
	paper: Paper | undefined
	viewMode: ViewMode
}

function WorkspaceContent({
	activeCitingNoteIds,
	autoFollowLockUntil,
	blockAnchorsById,
	blockNumberByBlockId,
	colorByAnnotation,
	colorByBlock,
	dotColorsByNote,
	numPages,
	pdfRailLayout,
	currentAnchorYRatio,
	currentPage,
	expandedNoteId,
	isLoading,
	main,
	notes,
	onChangeViewMode,
	onCreateAtCurrent,
	onDeleteNote,
	onEditorReady,
	onExpand,
	onJumpToPage,
	onOpenCitationBlock,
	onOpenCitationAnnotation,
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
				<SidebarToggleButtons leftOpen={isLeftNavOpen} onToggleLeft={toggleLeftNav} />
			</div>

			<div className="min-h-0 flex-1 p-6">
				<MainNotesSplit
					activeCitingNoteIds={activeCitingNoteIds}
					blockNumberByBlockId={blockNumberByBlockId}
					blockAnchorsById={blockAnchorsById}
					colorByAnnotation={colorByAnnotation}
					colorByBlock={colorByBlock}
					dotColorsByNote={dotColorsByNote}
					numPages={numPages}
					pdfRailLayout={pdfRailLayout}
					currentAnchorYRatio={currentAnchorYRatio}
					currentPage={currentPage}
					expandedNoteId={expandedNoteId}
					autoFollowLockUntil={autoFollowLockUntil}
					main={main}
					notes={notes}
					onCreateAtCurrent={onCreateAtCurrent}
					onDeleteNote={onDeleteNote}
					onEditorReady={onEditorReady}
					onExpand={onExpand}
					onJumpToPage={onJumpToPage}
					onOpenCitationBlock={onOpenCitationBlock}
					onOpenCitationAnnotation={onOpenCitationAnnotation}
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
			<path
				d="M30 98V30h20l20 25 20-25h20v68H90V59L70 84 50 59v39H30Z"
				fill="currentColor"
				stroke="none"
			/>
			<path d="M150 98V30h20v40h20l-30 33-30-33h20" fill="currentColor" stroke="none" />
		</svg>
	)
}

function SidebarToggleButtons({
	leftOpen,
	onToggleLeft,
}: {
	leftOpen: boolean
	onToggleLeft: () => void
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
				<SidebarIcon open={leftOpen} />
			</button>
		</div>
	)
}

function SidebarIcon({ open }: { open: boolean }) {
	return (
		<span
			className={`flex h-4 w-5 overflow-hidden rounded-[5px] border transition-colors ${
				open ? "border-current/55 bg-transparent" : "border-current/35 bg-current/10"
			}`}
		>
			<span className={`transition-colors ${open ? "w-2 bg-current/80" : "w-2 bg-transparent"}`} />
			<span className={`w-px transition-colors ${open ? "bg-current/45" : "bg-current/30"}`} />
			<span className={`flex-1 transition-colors ${open ? "bg-transparent" : "bg-current/20"}`} />
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
	handleOpenCitationAnnotation: (
		paperId: string,
		annotationId: string,
		page?: number,
		yRatio?: number,
	) => void
	handleUpdateReaderAnnotationColor: (
		annotationId: string,
		color: string,
	) => Promise<unknown> | unknown
	onRailLayoutChange: (layout: PdfRailLayout | null) => void
	onViewportAnchorChange: (page: number, yRatio: number) => void
	palette: ReturnType<typeof usePalette>["palette"]
	paperId: string
	readerAnnotations: ReaderAnnotation[]
	renderAnnotationActions: (annotation: ReaderAnnotation) => React.ReactNode
	renderActions: (block: Block) => React.ReactNode
	requestedBlockY: number | undefined
	requestedPage: number | undefined
	requestNonce: number
	selectedBlockId: string | null
	selectedBlockRequestNonce: number
	flashedAnnotationId: string | null
	previewedAnnotationId: string | null
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
						flashedAnnotationId={props.flashedAnnotationId}
						onClearHighlight={props.handleClearBlockHighlight}
						onCreateReaderAnnotation={props.handleCreateReaderAnnotation}
						onDeleteReaderAnnotation={props.handleDeleteReaderAnnotation}
						onUpdateReaderAnnotationColor={props.handleUpdateReaderAnnotationColor}
						onClearSelectedBlock={props.handleClearSelectedBlock}
						onInteract={props.handleMainInteract}
						onRailLayoutChange={props.onRailLayoutChange}
						onViewportAnchorChange={props.onViewportAnchorChange}
						onSelectBlock={props.handleSelectBlock}
						onSetHighlight={props.handleSetBlockHighlight}
						palette={props.palette}
						paperId={props.paperId}
						previewedAnnotationId={props.previewedAnnotationId}
						readerAnnotations={props.readerAnnotations}
						renderAnnotationActions={props.renderAnnotationActions}
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
	blockAnchorsById: Map<string, { page: number; yRatio: number }>
	blockNumberByBlockId: Map<string, number>
	colorByAnnotation: Map<string, string>
	colorByBlock: Map<string, string>
	dotColorsByNote: Map<string, string[]>
	numPages: number
	pdfRailLayout: PdfRailLayout | null
	main: React.ReactNode
	notes: Note[]
	expandedNoteId: string | null
	currentAnchorYRatio: number
	currentPage: number
	onExpand: (noteId: string | null) => void
	onJumpToPage: (page: number, yRatio?: number) => void
	onCreateAtCurrent: () => void
	onDeleteNote: (noteId: string) => Promise<void> | void
	onEditorReady: (editor: NoteEditorRef) => void
	onOpenCitationBlock: (paperId: string, blockId: string) => void
	onOpenCitationAnnotation: (
		paperId: string,
		annotationId: string,
		page?: number,
		yRatio?: number,
	) => void
}

function MainNotesSplit({
	activeCitingNoteIds,
	autoFollowLockUntil,
	blockAnchorsById,
	blockNumberByBlockId,
	colorByAnnotation,
	colorByBlock,
	dotColorsByNote,
	numPages,
	pdfRailLayout,
	main,
	notes,
	expandedNoteId,
	currentAnchorYRatio,
	currentPage,
	onExpand,
	onJumpToPage,
	onCreateAtCurrent,
	onDeleteNote,
	onEditorReady,
	onOpenCitationBlock,
	onOpenCitationAnnotation,
}: MainNotesSplitProps) {
	// Rail is a fixed-width strip glued to the main pane's right edge —
	// no draggable splitter, no per-user width, no framed column. The
	// note popover is portaled and expands left over the PDF, so the
	// rail itself only needs room for its dots.
	return (
		<div className="flex h-full min-h-0 min-w-0">
			<div className="min-h-0 min-w-0 flex-1">{main}</div>
			<NotesPanel
				activeCitingNoteIds={activeCitingNoteIds}
				blockAnchorsById={blockAnchorsById}
				blockNumberByBlockId={blockNumberByBlockId}
				colorByAnnotation={colorByAnnotation}
				colorByBlock={colorByBlock}
				dotColorsByNote={dotColorsByNote}
				numPages={numPages}
				pdfRailLayout={pdfRailLayout}
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
				onOpenCitationAnnotation={onOpenCitationAnnotation}
			/>
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
