import { Link } from "@tanstack/react-router"
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { streamAskAgentForNote } from "@/api/hooks/agent"
import { type Block, useBlocks } from "@/api/hooks/blocks"
import {
	useNotesForBlock,
	usePaperCitationCounts,
	usePaperNoteCitations,
} from "@/api/hooks/citations"
import { useClearBlockHighlight, useHighlights, useSetBlockHighlight } from "@/api/hooks/highlights"
import { useCreateNote, useDeleteNote, useNotes, useUpdateNote } from "@/api/hooks/notes"
import {
	type Paper,
	usePaper,
	useRetryPaperKnowledge,
	useRetryPaperParse,
} from "@/api/hooks/papers"
import {
	type ReaderAnnotation,
	useCreateReaderAnnotation,
	useDeleteReaderAnnotation,
	useReaderAnnotations,
	useRestoreReaderAnnotation,
	useUpdateReaderAnnotationColor,
} from "@/api/hooks/reader-annotations"
import { useCurrentWorkspace } from "@/api/hooks/workspaces"
import { AppShell } from "@/components/layout/AppShell"
import {
	buildAiAskDocument,
	buildAiAskErrorDocument,
	buildAiAskPendingDocument,
	buildAiAskStreamingDocument,
} from "@/components/notes/ai-note-content"
import { type NoteEditorRef, setNoteEditorCachedContent } from "@/components/notes/NoteEditor"
import { BlockConceptLensPanel } from "@/components/reader/BlockConceptLensPanel"
import { BlocksPanel, type BlocksRailLayout } from "@/components/reader/BlocksPanel"
import { NotesPanel } from "@/components/reader/NotesPanel"
import { type PdfRailLayout, PdfViewer } from "@/components/reader/PdfViewer"
import {
	ReaderAnnotationActionToast,
	type ReaderAnnotationRecallState,
} from "@/components/reader/ReaderAnnotationActionToast"
import {
	clearBrowserSelection,
	type ReaderSelectionContext,
} from "@/components/reader/reader-selection"
import { SelectedTextToolbar } from "@/components/reader/SelectedTextToolbar"
import { copyTextToClipboard } from "@/lib/clipboard"
import { paletteVisualTokens, usePalette } from "@/lib/highlight-palette"
import {
	annotationBodyBoundingBox,
	READER_ANNOTATION_COLORS,
	type ReaderAnnotationBody,
	type ReaderAnnotationTool,
} from "@/lib/reader-annotations"

type ViewMode = "pdf-only" | "md-only"
const VIEW_MODE_KEY = "paperWorkspace.viewMode"
const READER_ANNOTATION_COLOR_KEY = "paperWorkspace.readerAnnotationColor"
const AUTO_FOLLOW_LOCK_MS = 1400
const READER_ASK_MAX_CHARS = 1800
const READER_ANNOTATION_RECALL_MS = 5000

function loadViewMode(): ViewMode {
	if (typeof window === "undefined") return "pdf-only"
	const v = window.localStorage.getItem(VIEW_MODE_KEY)
	return v === "pdf-only" || v === "md-only" ? v : "pdf-only"
}

function loadReaderAnnotationColor() {
	if (typeof window === "undefined") return READER_ANNOTATION_COLORS[0]?.value ?? "#f4c84f"
	const saved = window.localStorage.getItem(READER_ANNOTATION_COLOR_KEY)
	if (!saved) return READER_ANNOTATION_COLORS[0]?.value ?? "#f4c84f"
	return READER_ANNOTATION_COLORS.some((entry) => entry.value === saved)
		? saved
		: (READER_ANNOTATION_COLORS[0]?.value ?? "#f4c84f")
}

export function PaperWorkspace({
	paperId,
	initialBlockId,
}: {
	paperId: string
	initialBlockId?: string
}) {
	const { data: paper, isLoading } = usePaper(paperId)
	const { data: workspace } = useCurrentWorkspace()
	const { data: paperNotes = [] } = useNotes(workspace?.id ?? "", paperId)
	const createNote = useCreateNote(workspace?.id ?? "")
	const updateNote = useUpdateNote()
	const deleteNote = useDeleteNote(workspace?.id ?? "")

	const [requestedPage, setRequestedPage] = useState<number | undefined>()
	const [requestedBlockY, setRequestedBlockY] = useState<number | undefined>()
	const [requestNonce, setRequestNonce] = useState(0)
	const [selectedBlockRequestNonce, setSelectedBlockRequestNonce] = useState(0)
	const [currentPage, setCurrentPage] = useState(1)
	const [currentAnchorYRatio, setCurrentAnchorYRatio] = useState(0.5)
	const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
	const [readerSelection, setReaderSelection] = useState<ReaderSelectionContext | undefined>(
		undefined,
	)
	const [readerAnnotationColor, setReaderAnnotationColor] = useState<string>(() =>
		loadReaderAnnotationColor(),
	)
	const [readerAnnotationRecall, setReaderAnnotationRecall] =
		useState<ReaderAnnotationRecallState | null>(null)
	const [isUndoingReaderAnnotationRecall, setIsUndoingReaderAnnotationRecall] = useState(false)
	const [viewMode, setViewMode] = useState<ViewMode>(() => loadViewMode())
	const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null)
	const [optimisticNotes, setOptimisticNotes] = useState<Note[]>([])
	const [pdfRailLayout, setPdfRailLayout] = useState<PdfRailLayout | null>(null)
	const [blocksRailLayout, setBlocksRailLayout] = useState<BlocksRailLayout | null>(null)
	const editorRef = useRef<NoteEditorRef | null>(null)
	const expandedNoteIdRef = useRef<string | null>(null)
	const askAbortControllersRef = useRef(new Set<AbortController>())
	const readerAnnotationRecallTimeoutRef = useRef<number | null>(null)
	const readerAnnotationRecallExpiresAtRef = useRef<number | null>(null)
	const readerAnnotationRecallRemainingMsRef = useRef(READER_ANNOTATION_RECALL_MS)
	const [editorReadyVersion, setEditorReadyVersion] = useState(0)
	const [pendingCiteBlock, setPendingCiteBlock] = useState<Block | null>(null)
	const [pendingCiteAnnotation, setPendingCiteAnnotation] = useState<ReaderAnnotation | null>(null)
	const [autoFollowLockUntil, setAutoFollowLockUntil] = useState(0)

	useEffect(() => {
		expandedNoteIdRef.current = expandedNoteId
	}, [expandedNoteId])

	useEffect(() => {
		return () => {
			for (const controller of askAbortControllersRef.current) controller.abort()
			askAbortControllersRef.current.clear()
		}
	}, [])

	const { data: blocks } = useBlocks(paperId)
	const { data: counts } = usePaperCitationCounts(paperId)
	const { data: notesCitingSelectedBlock = [] } = useNotesForBlock(paperId, selectedBlockId)
	const { data: highlights = [] } = useHighlights(paperId, workspace?.id)
	const { data: readerAnnotations = [] } = useReaderAnnotations(paperId, workspace?.id)
	const setBlockHighlight = useSetBlockHighlight(paperId)
	const clearBlockHighlight = useClearBlockHighlight(paperId)
	const createReaderAnnotation = useCreateReaderAnnotation(paperId)
	const deleteReaderAnnotation = useDeleteReaderAnnotation(paperId, workspace?.id)
	const restoreReaderAnnotation = useRestoreReaderAnnotation(paperId, workspace?.id)
	const updateReaderAnnotationColor = useUpdateReaderAnnotationColor(paperId, workspace?.id)
	const { palette } = usePalette()
	useEffect(() => {
		if (typeof window !== "undefined") {
			window.localStorage.setItem(VIEW_MODE_KEY, viewMode)
		}
	}, [viewMode])

	useEffect(() => {
		if (typeof window !== "undefined") {
			window.localStorage.setItem(READER_ANNOTATION_COLOR_KEY, readerAnnotationColor)
		}
	}, [readerAnnotationColor])

	useEffect(() => {
		setOptimisticNotes([])
		setPdfRailLayout(null)
		setBlocksRailLayout(null)
	}, [paperId, workspace?.id])

	useEffect(() => {
		return () => {
			if (readerAnnotationRecallTimeoutRef.current != null) {
				window.clearTimeout(readerAnnotationRecallTimeoutRef.current)
			}
		}
	}, [])

	const upsertOptimisticNote = useCallback((note: Note) => {
		setOptimisticNotes((current) => [
			note,
			...current.filter((candidate) => candidate.id !== note.id),
		])
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

	useEffect(() => {
		setReaderSelection(undefined)
	}, [paperId, viewMode])

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
	const initialBlockJumpKeyRef = useRef<string | null>(null)

	useEffect(() => {
		if (!initialBlockId || !blocks) return
		const jumpKey = `${paperId}:${initialBlockId}`
		if (initialBlockJumpKeyRef.current === jumpKey) return
		const block = blocks.find((candidate) => candidate.blockId === initialBlockId)
		if (!block) return
		initialBlockJumpKeyRef.current = jumpKey
		setAutoFollowLockUntil(Date.now() + AUTO_FOLLOW_LOCK_MS)
		handleJumpToBlock(block)
	}, [blocks, handleJumpToBlock, initialBlockId, paperId])

	const handleClearSelectedBlock = useCallback(() => {
		setSelectedBlockId(null)
	}, [])

	const handleReaderSelectionChange = useCallback(
		(selection: ReaderSelectionContext | undefined) => {
			setReaderSelection(selection)
		},
		[],
	)

	const handleDismissReaderSelection = useCallback(() => {
		setReaderSelection(undefined)
		clearBrowserSelection()
	}, [])

	const dismissReaderAnnotationRecall = useCallback(() => {
		if (readerAnnotationRecallTimeoutRef.current != null) {
			window.clearTimeout(readerAnnotationRecallTimeoutRef.current)
			readerAnnotationRecallTimeoutRef.current = null
		}
		readerAnnotationRecallExpiresAtRef.current = null
		readerAnnotationRecallRemainingMsRef.current = READER_ANNOTATION_RECALL_MS
		setReaderAnnotationRecall(null)
		setIsUndoingReaderAnnotationRecall(false)
	}, [])

	const scheduleReaderAnnotationRecallDismiss = useCallback((delayMs: number) => {
		if (readerAnnotationRecallTimeoutRef.current != null) {
			window.clearTimeout(readerAnnotationRecallTimeoutRef.current)
		}
		const boundedDelay = Math.max(0, delayMs)
		readerAnnotationRecallRemainingMsRef.current = boundedDelay
		readerAnnotationRecallExpiresAtRef.current = Date.now() + boundedDelay
		readerAnnotationRecallTimeoutRef.current = window.setTimeout(() => {
			readerAnnotationRecallTimeoutRef.current = null
			readerAnnotationRecallExpiresAtRef.current = null
			readerAnnotationRecallRemainingMsRef.current = READER_ANNOTATION_RECALL_MS
			setReaderAnnotationRecall(null)
			setIsUndoingReaderAnnotationRecall(false)
		}, boundedDelay)
	}, [])

	const queueReaderAnnotationRecall = useCallback(
		(recall: ReaderAnnotationRecallState) => {
			setIsUndoingReaderAnnotationRecall(false)
			setReaderAnnotationRecall(recall)
			scheduleReaderAnnotationRecallDismiss(READER_ANNOTATION_RECALL_MS)
		},
		[scheduleReaderAnnotationRecallDismiss],
	)

	const pauseReaderAnnotationRecall = useCallback(() => {
		if (!readerAnnotationRecall || isUndoingReaderAnnotationRecall) return
		if (readerAnnotationRecallTimeoutRef.current != null) {
			window.clearTimeout(readerAnnotationRecallTimeoutRef.current)
			readerAnnotationRecallTimeoutRef.current = null
		}
		const expiresAt = readerAnnotationRecallExpiresAtRef.current
		readerAnnotationRecallRemainingMsRef.current = expiresAt
			? Math.max(0, expiresAt - Date.now())
			: READER_ANNOTATION_RECALL_MS
		readerAnnotationRecallExpiresAtRef.current = null
	}, [isUndoingReaderAnnotationRecall, readerAnnotationRecall])

	const resumeReaderAnnotationRecall = useCallback(() => {
		if (!readerAnnotationRecall || isUndoingReaderAnnotationRecall) return
		if (readerAnnotationRecallTimeoutRef.current != null) return
		scheduleReaderAnnotationRecallDismiss(readerAnnotationRecallRemainingMsRef.current)
	}, [
		isUndoingReaderAnnotationRecall,
		readerAnnotationRecall,
		scheduleReaderAnnotationRecallDismiss,
	])

	const handleCopyReaderSelection = useCallback((selection: ReaderSelectionContext) => {
		void copyTextToClipboard(selection.selectedText)
	}, [])

	const replaceAiAskNoteDocument = useCallback(
		async (noteId: string, document: unknown) => {
			setNoteEditorCachedContent(noteId, document)
			if (expandedNoteIdRef.current === noteId && editorRef.current) {
				editorRef.current.commands.setContent(document as never, false)
			}
			await updateNote.mutateAsync({ noteId, blocknoteJson: document })
		},
		[updateNote],
	)

	const previewAiAskNoteDocument = useCallback((noteId: string, document: unknown) => {
		setNoteEditorCachedContent(noteId, document)
		if (expandedNoteIdRef.current === noteId && editorRef.current) {
			editorRef.current.commands.setContent(document as never, false)
		}
	}, [])

	const handleAskReaderSelection = useCallback(
		async (selection: ReaderSelectionContext) => {
			if (!workspace) return
			const selectedText = normalizeReaderAskText(selection.selectedText)
			if (!selectedText) return
			const selectedBlock =
				selection.blockIds
					.map((blockId) => blocks?.find((block) => block.blockId === blockId) ?? null)
					.find((block): block is Block => block != null) ?? null
			const blocksById = new Map((blocks ?? []).map((block) => [block.blockId, block]))
			setReaderSelection(undefined)
			clearBrowserSelection()
			const pendingDocument = buildAiAskPendingDocument({
				question: selectedText,
				selectedText,
			})
			const note = await createNote.mutateAsync({
				paperId,
				blocknoteJson: pendingDocument,
				anchorPage: selectedBlock?.page ?? selection.annotationTarget?.page ?? currentPage,
				anchorYRatio: selectedBlock?.bbox?.y ?? currentAnchorYRatio,
				anchorKind: selectedBlock ? "block" : "page",
				anchorBlockId: selectedBlock?.blockId ?? selection.blockIds[0] ?? null,
			})
			setNoteEditorCachedContent(note.id, pendingDocument)
			upsertOptimisticNote(note)
			if (selectedBlock) handleSelectBlock(selectedBlock)
			setExpandedNoteId(note.id)

			const controller = new AbortController()
			askAbortControllersRef.current.add(controller)
			try {
				const answer = await streamAskAgentForNote(
					{
						paperId,
						workspaceId: workspace.id,
						question: selectedText,
						selectionContext: {
							blockIds: selection.blockIds,
							selectedText,
						},
					},
					{
						signal: controller.signal,
						onChunk: (_chunk, accumulated) => {
							previewAiAskNoteDocument(
								note.id,
								buildAiAskStreamingDocument({
									question: selectedText,
									selectedText,
									answer: accumulated,
								}),
							)
						},
					},
				)
				await replaceAiAskNoteDocument(
					note.id,
					buildAiAskDocument({
						question: selectedText,
						selectedText,
						answer,
						paperId,
						blocksById,
					}),
				)
			} catch (error) {
				await replaceAiAskNoteDocument(
					note.id,
					buildAiAskErrorDocument({
						question: selectedText,
						selectedText,
						error: error instanceof Error ? error.message : "Unknown error",
					}),
				)
			} finally {
				askAbortControllersRef.current.delete(controller)
			}
		},
		[
			blocks,
			createNote,
			currentAnchorYRatio,
			currentPage,
			handleSelectBlock,
			paperId,
			previewAiAskNoteDocument,
			replaceAiAskNoteDocument,
			upsertOptimisticNote,
			workspace,
		],
	)

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
			// Text blocks keep the existing "select while note opens" cue,
			// but media blocks should not flash their focused preview just
			// because the user clicked the note action in the hover toolbar.
			if (block.type !== "figure" && block.type !== "table") {
				handleSelectBlock(block)
			}
			setExpandedNoteId(note.id)
			setPendingCiteBlock(block)
		},
		[createNote, expandedNoteId, handleSelectBlock, paperId, upsertOptimisticNote, workspace],
	)

	const handleAskBlock = useCallback(
		async (block: Block) => {
			if (!workspace) return
			const selectedText = normalizeReaderAskText(block.caption || block.text)
			const question = "Explain this block."
			const blocksById = new Map((blocks ?? []).map((candidate) => [candidate.blockId, candidate]))
			const pendingDocument = buildAiAskPendingDocument({ question, selectedText })
			const note = await createNote.mutateAsync({
				paperId,
				blocknoteJson: pendingDocument,
				anchorPage: block.page,
				anchorYRatio: block.bbox?.y ?? null,
				anchorKind: "block",
				anchorBlockId: block.blockId,
			})
			setNoteEditorCachedContent(note.id, pendingDocument)
			upsertOptimisticNote(note)
			if (block.type !== "figure" && block.type !== "table") handleSelectBlock(block)
			setExpandedNoteId(note.id)

			const controller = new AbortController()
			askAbortControllersRef.current.add(controller)
			try {
				const answer = await streamAskAgentForNote(
					{
						paperId,
						workspaceId: workspace.id,
						question,
						selectionContext: {
							blockIds: [block.blockId],
							selectedText,
						},
					},
					{
						signal: controller.signal,
						onChunk: (_chunk, accumulated) => {
							previewAiAskNoteDocument(
								note.id,
								buildAiAskStreamingDocument({
									question,
									selectedText,
									answer: accumulated,
								}),
							)
						},
					},
				)
				await replaceAiAskNoteDocument(
					note.id,
					buildAiAskDocument({
						question,
						selectedText,
						answer,
						paperId,
						blocksById,
					}),
				)
			} catch (error) {
				await replaceAiAskNoteDocument(
					note.id,
					buildAiAskErrorDocument({
						question,
						selectedText,
						error: error instanceof Error ? error.message : "Unknown error",
					}),
				)
			} finally {
				askAbortControllersRef.current.delete(controller)
			}
		},
		[
			blocks,
			createNote,
			handleSelectBlock,
			paperId,
			previewAiAskNoteDocument,
			replaceAiAskNoteDocument,
			upsertOptimisticNote,
			workspace,
		],
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
			<>
				<button
					aria-label="Ask AI in a note about this block"
					className="flex h-7 w-7 items-center justify-center rounded-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-accent"
					onClick={(e) => {
						e.stopPropagation()
						void handleAskBlock(block)
					}}
					title="Ask in note"
					type="button"
				>
					<AgentIcon />
				</button>
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
			</>
		),
		[expandedNoteId, handleAskBlock, handleCiteBlock, handleNewNoteForBlock],
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
		async (
			input: {
				page: number
				kind: ReaderAnnotationTool
				color: string
				body: ReaderAnnotationBody
			},
			options?: { suppressRecall?: boolean },
		) => {
			if (!workspace) return null
			const saved = await createReaderAnnotation.mutateAsync({
				workspaceId: workspace.id,
				...input,
			})
			if (!options?.suppressRecall) {
				queueReaderAnnotationRecall({
					action: "created",
					annotationId: saved.id,
					annotation: {
						kind: saved.kind,
						color: saved.color,
						body: saved.body,
					},
					page: saved.page,
				})
			}
			return saved
		},
		[createReaderAnnotation, queueReaderAnnotationRecall, workspace],
	)

	const handleCreateReaderSelectionAnnotation = useCallback(
		async (selection: ReaderSelectionContext, kind: ReaderAnnotationTool) => {
			if (selection.mode !== "pdf" || !selection.annotationTarget) return
			await handleCreateReaderAnnotation({
				page: selection.annotationTarget.page,
				kind,
				color: readerAnnotationColor,
				body: selection.annotationTarget.body,
			})
			setReaderSelection(undefined)
			clearBrowserSelection()
		},
		[handleCreateReaderAnnotation, readerAnnotationColor],
	)

	const handleDeleteReaderAnnotation = useCallback(
		async (annotationId: string, options?: { suppressRecall?: boolean }) => {
			const snapshot =
				readerAnnotations.find(
					(candidate) => candidate.id === annotationId && candidate.deletedAt == null,
				) ?? null
			const result = await deleteReaderAnnotation.mutateAsync(annotationId)
			if (!options?.suppressRecall && snapshot) {
				queueReaderAnnotationRecall({
					action: "deleted",
					annotationId: snapshot.id,
					annotation: {
						kind: snapshot.kind,
						color: snapshot.color,
						body: snapshot.body,
					},
					page: snapshot.page,
					softDeleted: result?.softDeleted === true,
				})
			}
			return {
				softDeleted: result?.softDeleted === true,
				snapshot,
			}
		},
		[deleteReaderAnnotation, queueReaderAnnotationRecall, readerAnnotations],
	)

	const handleRestoreReaderAnnotation = useCallback(
		async (annotationId: string) => {
			await restoreReaderAnnotation.mutateAsync(annotationId)
		},
		[restoreReaderAnnotation],
	)

	const handleUpdateReaderAnnotationColor = useCallback(
		async (annotationId: string, color: string) => {
			await updateReaderAnnotationColor.mutateAsync({ annotationId, color })
		},
		[updateReaderAnnotationColor],
	)

	const handleUndoReaderAnnotationRecall = useCallback(async () => {
		if (!readerAnnotationRecall || isUndoingReaderAnnotationRecall) return
		setIsUndoingReaderAnnotationRecall(true)
		try {
			if (readerAnnotationRecall.action === "created") {
				await handleDeleteReaderAnnotation(readerAnnotationRecall.annotationId, {
					suppressRecall: true,
				})
			} else {
				if (readerAnnotationRecall.softDeleted) {
					await handleRestoreReaderAnnotation(readerAnnotationRecall.annotationId)
				} else {
					await handleCreateReaderAnnotation(
						{
							page: readerAnnotationRecall.page,
							kind: readerAnnotationRecall.annotation.kind,
							color: readerAnnotationRecall.annotation.color,
							body: readerAnnotationRecall.annotation.body,
						},
						{ suppressRecall: true },
					)
				}
			}
			dismissReaderAnnotationRecall()
		} catch {
			setIsUndoingReaderAnnotationRecall(false)
		}
	}, [
		dismissReaderAnnotationRecall,
		handleCreateReaderAnnotation,
		handleDeleteReaderAnnotation,
		handleRestoreReaderAnnotation,
		isUndoingReaderAnnotationRecall,
		readerAnnotationRecall,
	])

	useEffect(() => {
		if (!readerAnnotationRecall) return
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key.toLowerCase() !== "z") return
			if (!event.metaKey && !event.ctrlKey) return
			if (event.shiftKey || event.altKey) return
			if (isEditableTarget(event.target)) return
			event.preventDefault()
			void handleUndoReaderAnnotationRecall()
		}
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [handleUndoReaderAnnotationRecall, readerAnnotationRecall])

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

	// annotationId → blockId of the structural block whose bbox the
	// annotation visually overlaps. Lets the canonical label include
	// `blk. N` even though annotations themselves don't store a block id
	// (the block id is stable across re-parse — annotation ids aren't —
	// so we don't store this; we recompute on demand).
	const annotationBlockIdById = useMemo(() => {
		const map = new Map<string, string>()
		for (const annotation of readerAnnotations) {
			if (annotation.kind !== "highlight" && annotation.kind !== "underline") continue
			const bbox = annotationBodyBoundingBox(annotation.kind, annotation.body)
			if (!bbox) continue
			const block = findOverlappingBlock(blocks ?? [], annotation.page, bbox)
			if (block) map.set(annotation.id, block.blockId)
		}
		return map
	}, [blocks, readerAnnotations])

	// annotationId → 1-based ordinal among the paper's annotations of
	// the same kind. Sorted by (page, yRatio, createdAt) so the numbering
	// follows reading order rather than creation order. Drives the
	// canonical "highlight 1 p. 12 blk. 7" label across the marginalia
	// rail, citation chips, and tooltips.
	const annotationOrdinalById = useMemo(() => {
		const byKind = new Map<string, ReaderAnnotation[]>()
		for (const annotation of readerAnnotations) {
			if (annotation.kind !== "highlight" && annotation.kind !== "underline") continue
			const list = byKind.get(annotation.kind) ?? []
			list.push(annotation)
			byKind.set(annotation.kind, list)
		}
		const map = new Map<string, number>()
		for (const list of byKind.values()) {
			const sorted = [...list].sort((a, b) => {
				if (a.page !== b.page) return a.page - b.page
				const ay = annotationBodyBoundingBox(a.kind, a.body)?.y ?? 0
				const by = annotationBodyBoundingBox(b.kind, b.body)?.y ?? 0
				if (ay !== by) return ay - by
				return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
			})
			for (const [index, annotation] of sorted.entries()) {
				map.set(annotation.id, index + 1)
			}
		}
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

	const expandedNote = useMemo(() => {
		if (!expandedNoteId) return null
		return (
			optimisticNotes.find((candidate) => candidate.id === expandedNoteId) ??
			paperNotes.find((candidate) => candidate.id === expandedNoteId) ??
			null
		)
	}, [expandedNoteId, optimisticNotes, paperNotes])

	const previewedAnnotationId = useMemo(() => {
		if (!expandedNote) return null
		if (expandedNote.anchorKind !== "highlight" && expandedNote.anchorKind !== "underline")
			return null
		return expandedNote.anchorAnnotationId ?? null
	}, [expandedNote])

	const previewedBlockId = useMemo(() => expandedNote?.anchorBlockId ?? null, [expandedNote])

	// While any note is open, suppress all image/table preview popups.
	// The expanded note slip already occupies the same right-edge visual
	// territory as the zoomed figure/table card; letting both appear at
	// once creates overlapping interaction models (selected block vs
	// active note) and quickly gets noisy. Naturally clears when the note
	// closes.
	const previewSuppressedBlockId = useMemo(() => {
		return expandedNoteId ? "__all__" : null
	}, [expandedNoteId])

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

	// blockId → block source text. Folded slips in the marginalia gutter
	// surface this as a 2-line excerpt below the source tag, so a glance
	// at the rail tells the reader which passage the note responds to —
	// without expanding the slip and without going back to the PDF.
	// (TASK-018 Phase A bonus: matches the demo wide-mode layout where
	// each slip card shows tag + excerpt.)
	const blockTextById = useMemo(() => {
		const map = new Map<string, string>()
		for (const block of blocks ?? []) {
			if (block.text) map.set(block.blockId, block.text)
		}
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

	const notes = useMemo(
		() => notesPaneFor(paperNotes, optimisticNotes),
		[paperNotes, optimisticNotes],
	)

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
			handleReaderSelectionChange={handleReaderSelectionChange}
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
			handleDeleteReaderAnnotation={handleDeleteReaderAnnotation}
			handleRestoreReaderAnnotation={handleRestoreReaderAnnotation}
			handleOpenCitationAnnotation={handleOpenCitationAnnotation}
			handleUpdateReaderAnnotationColor={handleUpdateReaderAnnotationColor}
			flashedAnnotationId={flashedAnnotationId}
			previewedBlockId={previewedBlockId}
			onRailLayoutChange={setPdfRailLayout}
			onBlocksRailLayoutChange={setBlocksRailLayout}
			previewedAnnotationId={previewedAnnotationId}
			previewSuppressedBlockId={previewSuppressedBlockId}
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
				annotationOrdinalById={annotationOrdinalById}
				annotationBlockIdById={annotationBlockIdById}
				blockTextById={blockTextById}
				colorByBlock={cssColorByBlock}
				dotColorsByNote={dotColorsByNote}
				numPages={numPages}
				pdfRailLayout={pdfRailLayout}
				blocksRailLayout={blocksRailLayout}
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
				workspaceId={workspace?.id}
				readerAnnotationActionToast={
					readerAnnotationRecall ? (
						<ReaderAnnotationActionToast
							isUndoing={isUndoingReaderAnnotationRecall}
							onDismiss={dismissReaderAnnotationRecall}
							onPause={pauseReaderAnnotationRecall}
							onResume={resumeReaderAnnotationRecall}
							onUndo={() => {
								void handleUndoReaderAnnotationRecall()
							}}
							recall={readerAnnotationRecall}
						/>
					) : null
				}
				selectedBlockId={selectedBlockId}
				selectedTextToolbar={
					readerSelection ? (
						<SelectedTextToolbar
							annotationColor={readerAnnotationColor}
							onChangeAnnotationColor={setReaderAnnotationColor}
							onAskAgent={(selection) => {
								void handleAskReaderSelection(selection)
							}}
							onCopy={handleCopyReaderSelection}
							onDismiss={handleDismissReaderSelection}
							onHighlight={(selection) => {
								void handleCreateReaderSelectionAnnotation(selection, "highlight")
							}}
							onUnderline={(selection) => {
								void handleCreateReaderSelectionAnnotation(selection, "underline")
							}}
							selection={readerSelection}
						/>
					) : null
				}
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

function isEditableTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return false
	const tagName = target.tagName.toLowerCase()
	return (
		target.isContentEditable ||
		tagName === "input" ||
		tagName === "textarea" ||
		tagName === "select"
	)
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
	annotationOrdinalById: Map<string, number>
	annotationBlockIdById: Map<string, string>
	blockTextById: Map<string, string>
	colorByBlock: Map<string, string>
	dotColorsByNote: Map<string, string[]>
	numPages: number
	pdfRailLayout: PdfRailLayout | null
	blocksRailLayout: BlocksRailLayout | null
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
	workspaceId?: string
	readerAnnotationActionToast?: React.ReactNode
	selectedBlockId: string | null
	selectedTextToolbar?: React.ReactNode
	viewMode: ViewMode
}

function WorkspaceContent({
	activeCitingNoteIds,
	autoFollowLockUntil,
	blockAnchorsById,
	blockNumberByBlockId,
	colorByAnnotation,
	annotationOrdinalById,
	annotationBlockIdById,
	blockTextById,
	colorByBlock,
	dotColorsByNote,
	numPages,
	pdfRailLayout,
	blocksRailLayout,
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
	workspaceId,
	readerAnnotationActionToast,
	selectedBlockId,
	selectedTextToolbar,
	viewMode,
}: WorkspaceContentProps) {
	return isLoading ? (
		<div className="p-8 text-sm text-text-tertiary">Loading…</div>
	) : !paper ? (
		<div className="p-8 text-sm text-text-tertiary">Not found.</div>
	) : (
		<div className="relative flex h-full min-h-0 flex-col">
			<ParseStatusBanner paper={paper} workspaceId={workspaceId ?? ""} />
			<KnowledgeStatusBanner paper={paper} workspaceId={workspaceId ?? ""} />

			<div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border-subtle bg-bg-secondary px-4 py-2 text-sm">
				<ViewModeToggle current={viewMode} onChange={onChangeViewMode} />
			</div>

			<div className="min-h-0 flex-1 p-3 sm:p-4 lg:p-6">
				<MainNotesSplit
					activeCitingNoteIds={activeCitingNoteIds}
					blockNumberByBlockId={blockNumberByBlockId}
					blockAnchorsById={blockAnchorsById}
					colorByAnnotation={colorByAnnotation}
					annotationOrdinalById={annotationOrdinalById}
					annotationBlockIdById={annotationBlockIdById}
					blockTextById={blockTextById}
					colorByBlock={colorByBlock}
					contextPanel={
						<BlockConceptLensPanel
							blockId={selectedBlockId}
							blockNumber={
								selectedBlockId ? (blockNumberByBlockId.get(selectedBlockId) ?? null) : null
							}
							paperId={paper.id}
							variant="marginalia"
							workspaceId={workspaceId}
						/>
					}
					dotColorsByNote={dotColorsByNote}
					numPages={numPages}
					pdfRailLayout={pdfRailLayout}
					blocksRailLayout={blocksRailLayout}
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
			{readerAnnotationActionToast}
			{selectedTextToolbar}
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

interface MainViewProps {
	autoFollowLockUntil: number
	blocks: Block[] | undefined
	colorByBlock: Map<string, string>
	countsMap: Map<string, number>
	currentPage: number
	handleClearBlockHighlight: (blockId: string) => Promise<void> | void
	handleClearSelectedBlock: () => void
	handleMainInteract: () => void
	handleReaderSelectionChange: (selection: ReaderSelectionContext | undefined) => void
	handleSelectBlock: (block: Block) => void
	handleSelectBlockFromPane: (block: Block) => void
	handleSetBlockHighlight: (blockId: string, color: string) => Promise<void> | void
	handleDeleteReaderAnnotation: (annotationId: string) => Promise<unknown> | unknown
	handleRestoreReaderAnnotation: (annotationId: string) => Promise<unknown> | unknown
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
	onBlocksRailLayoutChange: (layout: BlocksRailLayout | null) => void
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
	previewedBlockId: string | null
	previewedAnnotationId: string | null
	previewSuppressedBlockId: string | null
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
						onDeleteReaderAnnotation={props.handleDeleteReaderAnnotation}
						onRestoreReaderAnnotation={props.handleRestoreReaderAnnotation}
						onUpdateReaderAnnotationColor={props.handleUpdateReaderAnnotationColor}
						onClearSelectedBlock={props.handleClearSelectedBlock}
						onInteract={props.handleMainInteract}
						onRailLayoutChange={props.onRailLayoutChange}
						onSelectedTextChange={props.handleReaderSelectionChange}
						onViewportAnchorChange={props.onViewportAnchorChange}
						onSelectBlock={props.handleSelectBlock}
						onSetHighlight={props.handleSetBlockHighlight}
						palette={props.palette}
						paperId={props.paperId}
						previewedBlockId={props.previewedBlockId}
						previewedAnnotationId={props.previewedAnnotationId}
						previewSuppressedBlockId={props.previewSuppressedBlockId}
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
						onRailLayoutChange={props.onBlocksRailLayoutChange}
						onSelectedTextChange={props.handleReaderSelectionChange}
						onViewportAnchorChange={props.onViewportAnchorChange}
						onSelectBlock={props.handleSelectBlockFromPane}
						onSetHighlight={props.handleSetBlockHighlight}
						paperId={props.paperId}
						palette={props.palette}
						followCurrentPage={props.viewMode === "pdf-only"}
						previewedBlockId={props.previewedBlockId}
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
import { useGutterMode } from "@/components/reader/use-gutter-mode"

interface MainNotesSplitProps {
	activeCitingNoteIds: Set<string>
	autoFollowLockUntil: number
	blockAnchorsById: Map<string, { page: number; yRatio: number }>
	blockNumberByBlockId: Map<string, number>
	colorByAnnotation: Map<string, string>
	annotationOrdinalById: Map<string, number>
	annotationBlockIdById: Map<string, string>
	blockTextById: Map<string, string>
	colorByBlock: Map<string, string>
	contextPanel?: React.ReactNode
	dotColorsByNote: Map<string, string[]>
	numPages: number
	pdfRailLayout: PdfRailLayout | null
	blocksRailLayout: BlocksRailLayout | null
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
	annotationOrdinalById,
	annotationBlockIdById,
	blockTextById,
	colorByBlock,
	contextPanel,
	dotColorsByNote,
	numPages,
	pdfRailLayout,
	blocksRailLayout,
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
	// TASK-018 Phase A/B — gutter lives inside the PDF preview's right
	// whitespace (rather than as its own column to the right of the
	// reader). The panel is always absolutely positioned; the main
	// column reserves matching padding on the right at lg+ so PDF/MD
	// content stays out from underneath the slip lane.
	//
	// `gutterMode` is measured from this split's root element (NOT the
	// viewport — LeftNav / agent panel can shrink the workspace below
	// the wide threshold even on a 1920px monitor). It drives:
	//
	//   - the right padding reserved on the main column (324 wide,
	//     244 compact, 0 mobile),
	//   - which widths NotesPanel uses for its slip lane / rail,
	//   - whether an expanded note renders in-place (wide) or as an
	//     overlay card with backdrop (compact). Mobile is Phase C.
	const splitRef = useRef<HTMLDivElement | null>(null)
	const gutterMode = useGutterMode(splitRef)
	let lgGutterPadClass: string
	if (gutterMode === "compact") {
		// SLIP_LANE_WIDTH_COMPACT (196) + RAIL_STRIP_WIDTH_COMPACT (36) + 2×SIDEBAR_INSET_X (8) = 240
		lgGutterPadClass = "lg:pr-[240px]"
	} else {
		// wide & mobile (mobile uses absolute overlay so the padding
		// is harmless — Phase C will switch to drawer and reset this)
		// SLIP_LANE_WIDTH_WIDE (272) + RAIL_STRIP_WIDTH_WIDE (44) + 2×SIDEBAR_INSET_X (8) = 324
		lgGutterPadClass = "lg:pr-[324px]"
	}
	return (
		<div className="relative h-full min-h-0 min-w-0" ref={splitRef}>
			<div
				className={`h-full min-h-0 min-w-0 transition-[padding] duration-200 ease-out ${lgGutterPadClass}`}
			>
				{main}
			</div>
			<div className="absolute inset-y-0 right-0 z-[5]">
				<NotesPanel
					gutterMode={gutterMode}
					activeCitingNoteIds={activeCitingNoteIds}
					blockAnchorsById={blockAnchorsById}
					blockNumberByBlockId={blockNumberByBlockId}
					colorByAnnotation={colorByAnnotation}
					annotationOrdinalById={annotationOrdinalById}
					annotationBlockIdById={annotationBlockIdById}
					blockTextById={blockTextById}
					colorByBlock={colorByBlock}
					contextPanel={contextPanel}
					dotColorsByNote={dotColorsByNote}
					numPages={numPages}
					pdfRailLayout={pdfRailLayout}
					blocksRailLayout={blocksRailLayout}
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
					isSidebarCollapsed={false}
					onRequestExpandSidebar={() => {}}
				/>
			</div>
		</div>
	)
}

function ParseStatusBanner({ paper, workspaceId }: { paper: Paper; workspaceId: string }) {
	const retryParse = useRetryPaperParse(workspaceId)

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
		<div className="shrink-0 border-[var(--color-status-error-text)] border-b bg-[var(--color-status-error-bg)] px-6 py-3 text-sm">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="min-w-0">
					<div className="text-text-error">
						Parsing failed. {paper.parseError ?? "Unknown error."}
					</div>
					{retryParse.error instanceof Error ? (
						<div className="mt-1 text-xs text-text-error">{retryParse.error.message}</div>
					) : null}
					{needsCredentials ? (
						<Link className="mt-1 inline-block text-text-accent hover:underline" to="/settings">
							Configure MinerU →
						</Link>
					) : null}
				</div>
				<button
					className="shrink-0 rounded-md border border-border-default bg-bg-primary px-3 py-1.5 text-xs font-medium text-text-primary transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
					disabled={retryParse.isPending}
					onClick={() => retryParse.mutate(paper.id)}
					type="button"
				>
					{retryParse.isPending ? "Queueing..." : "Retry parsing"}
				</button>
			</div>
		</div>
	)
}

function KnowledgeStatusBanner({ paper, workspaceId }: { paper: Paper; workspaceId: string }) {
	const retryKnowledge = useRetryPaperKnowledge(workspaceId)

	if (paper.parseStatus !== "done") return null
	if (paper.summaryStatus !== "failed" && paper.summaryStatus !== "no-credentials") return null

	const needsCredentials = paper.summaryStatus === "no-credentials"
	const message = needsCredentials
		? "Concepts and links need an LLM credential before they can be generated."
		: `Concepts and links failed to build. ${paper.summaryError ?? "Unknown error."}`

	return (
		<div className="shrink-0 border-[var(--color-status-warning-text)] border-b bg-[var(--color-status-warning-bg)] px-6 py-3 text-sm">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="min-w-0">
					<div className="text-[var(--color-status-warning-text)]">{message}</div>
					{retryKnowledge.error instanceof Error ? (
						<div className="mt-1 text-xs text-text-error">{retryKnowledge.error.message}</div>
					) : null}
					{needsCredentials ? (
						<Link className="mt-1 inline-block text-text-accent hover:underline" to="/settings">
							Configure LLM →
						</Link>
					) : null}
				</div>
				<button
					className="shrink-0 rounded-md border border-border-default bg-bg-primary px-3 py-1.5 text-xs font-medium text-text-primary transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
					disabled={retryKnowledge.isPending}
					onClick={() => retryKnowledge.mutate(paper.id)}
					type="button"
				>
					{retryKnowledge.isPending ? "Queueing..." : "Retry concepts & links"}
				</button>
			</div>
		</div>
	)
}

function normalizeReaderAskText(text: string) {
	const normalized = text.replace(/\s+/g, " ").trim()
	if (normalized.length <= READER_ASK_MAX_CHARS) return normalized
	return `${normalized.slice(0, READER_ASK_MAX_CHARS)}…`
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

function AgentIcon() {
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
			<path d="M12 4a8 8 0 0 1 8 8c0 4.4-3.6 8-8 8H5l-1 1v-9a8 8 0 0 1 8-8Z" />
			<path d="M8 11h8M8 15h5" />
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
