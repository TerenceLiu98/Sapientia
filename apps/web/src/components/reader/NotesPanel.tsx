import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Note } from "@/api/hooks/notes"
import { NoteEditor, type NoteEditorRef } from "@/components/notes/NoteEditor"

interface NotesPanelProps {
	activeCitingNoteIds: Set<string>
	notes: Note[]
	currentPage: number
	currentAnchorYRatio: number
	externalFollowLockUntil?: number
	expandedNoteId: string | null
	onExpand: (noteId: string | null) => void
	onJumpToPage: (page: number, yRatio?: number) => void
	onCreateAtCurrent: () => void
	onDelete?: (noteId: string) => Promise<void> | void
	onEditorReady?: (editor: NoteEditorRef) => void
	onOpenCitationBlock?: (paperId: string, blockId: string) => void
}

// Right-pane stream of position-anchored note cards. Following the PHILOSOPHY
// commitment "notes are spatial, not abstract" — cards are grouped by page
// and the pane scrolls to keep the current PDF page in view. One card may be
// expanded into an inline editor at a time.
export function NotesPanel({
	activeCitingNoteIds,
	notes,
	currentPage,
	currentAnchorYRatio,
	externalFollowLockUntil,
	expandedNoteId,
	onExpand,
	onJumpToPage,
	onCreateAtCurrent,
	onDelete,
	onEditorReady,
	onOpenCitationBlock,
}: NotesPanelProps) {
	const scrollRef = useRef<HTMLDivElement | null>(null)
	const cardRefs = useRef(new Map<string, HTMLElement>())
	const headerRefs = useRef(new Map<number | "unanchored", HTMLDivElement>())
	const [cardRefsVersion, setCardRefsVersion] = useState(0)
	const previousPageRef = useRef<number | null>(null)
	// Soft-lock for the page-driven follow effect: if the user just scrolled
	// inside the pane themselves, we skip auto-scroll for ~500ms so the two
	// scroll sources don't fight. Same pattern as BlocksPanel.
	const lockUntilRef = useRef(0)

	const grouped = useGrouped(notes)

	// Auto-expand the first note anchored to the current page; collapse
	// when the page has none. Critically, this should only fire when the
	// *page changes* — not whenever the notes array mutates — otherwise a
	// user-driven expand/create can get overwritten and the pane flickers.
	const autoExpandTargetId = useMemo(
		() => notes.find((note) => note.anchorPage === currentPage)?.id ?? null,
		[currentPage, notes],
	)
	useEffect(() => {
		if (previousPageRef.current === null) {
			previousPageRef.current = currentPage
			if (expandedNoteId !== autoExpandTargetId) onExpand(autoExpandTargetId)
			return
		}
		if (previousPageRef.current === currentPage) return
		previousPageRef.current = currentPage
		if (expandedNoteId === autoExpandTargetId) return
		onExpand(autoExpandTargetId)
	}, [autoExpandTargetId, currentPage, expandedNoteId, onExpand])

	useEffect(() => {
		if (!externalFollowLockUntil) return
		lockUntilRef.current = Math.max(lockUntilRef.current, externalFollowLockUntil)
	}, [externalFollowLockUntil])

	const registerCardRef = useCallback((noteId: string, el: HTMLElement | null) => {
		const previous = cardRefs.current.get(noteId)
		if (el) {
			if (previous === el) return
			cardRefs.current.set(noteId, el)
			setCardRefsVersion((value) => value + 1)
			return
		}
		if (!previous) return
		cardRefs.current.delete(noteId)
		setCardRefsVersion((value) => value + 1)
	}, [])

	// Page changes from the PDF/parsed view → scroll the pane to that page's
	// closest note anchor. Skipped while locked.
	useEffect(() => {
		if (expandedNoteId) return
		if (Date.now() < lockUntilRef.current) return
		const container = scrollRef.current
		if (!container) return
		const anchoredOnPage = notes.filter((note) => note.anchorPage === currentPage)
		const targetNote =
			anchoredOnPage.length > 0
				? anchoredOnPage.reduce((best, note) => {
						const bestDelta = Math.abs((best.anchorYRatio ?? 0.5) - currentAnchorYRatio)
						const nextDelta = Math.abs((note.anchorYRatio ?? 0.5) - currentAnchorYRatio)
						return nextDelta < bestDelta ? note : best
					})
				: null
		const targetEl = targetNote
			? (cardRefs.current.get(targetNote.id) ?? null)
			: (headerRefs.current.get(currentPage) ?? null)
		if (!targetEl) return
		const targetRect = targetEl.getBoundingClientRect()
		const containerRect = container.getBoundingClientRect()
		const offset = targetRect.top - containerRect.top + container.scrollTop - 8
		const max = container.scrollHeight - container.clientHeight
		const top = Math.max(0, Math.min(max, offset))
		if (typeof container.scrollTo === "function") {
			container.scrollTo({ top, behavior: "smooth" })
		} else {
			container.scrollTop = top
		}
	}, [cardRefsVersion, currentAnchorYRatio, currentPage, expandedNoteId, notes])

	const onUserScroll = useCallback(() => {
		lockUntilRef.current = Date.now() + 500
	}, [])

	const handleOpenCitationBlock = useCallback(
		(paperId: string, blockId: string) => {
			// Clicking a cite chip from inside an expanded note should keep the
			// note pane visually stable while the main reader jumps.
			lockUntilRef.current = Date.now() + 900
			onOpenCitationBlock?.(paperId, blockId)
		},
		[onOpenCitationBlock],
	)

	return (
		<div className="flex h-full min-h-0 flex-col bg-[var(--color-reading-bg)]">
			<div className="flex shrink-0 items-center justify-between border-b border-border-subtle bg-bg-primary/75 px-4 py-3">
				<div>
					<div className="text-text-secondary text-xs uppercase tracking-[0.16em]">Notes</div>
					<div className="mt-1 text-sm text-text-tertiary">
						{notes.length === 0
							? "No notes yet"
							: `${notes.length} note${notes.length === 1 ? "" : "s"}`}
					</div>
				</div>
				<button
					className="rounded-md border border-border-default px-2.5 py-1 font-medium text-text-secondary text-xs transition-colors hover:bg-surface-hover"
					onClick={onCreateAtCurrent}
					title="Add a note at the current scroll position"
					type="button"
				>
					+ Note
				</button>
			</div>
			<div
				className="scrollbar-none min-h-0 flex-1 overflow-y-auto p-3"
				onWheel={onUserScroll}
				onTouchMove={onUserScroll}
				ref={scrollRef}
			>
				{notes.length === 0 ? (
					<div className="px-2 py-8 text-center text-sm text-text-tertiary">
						Add a note to start building marginalia for this paper.
					</div>
				) : (
					grouped.map((group) => {
						const key = group.page ?? "unanchored"
						const isCurrentPage = group.page != null && group.page === currentPage
						return (
							<div className="mb-4" key={String(key)}>
								<div
									className={`-mx-1 sticky top-0 z-[1] mb-2 inline-flex rounded-full px-2.5 py-1 font-medium text-xs ${
										isCurrentPage
											? "bg-surface-selected text-text-accent"
											: "bg-bg-secondary text-text-secondary"
									}`}
									ref={(el) => {
										if (el) headerRefs.current.set(key, el)
										else headerRefs.current.delete(key)
									}}
								>
									{group.page == null ? (
										"Unanchored"
									) : (
										<button
											className="cursor-pointer"
											onClick={() => onJumpToPage(group.page as number)}
											type="button"
										>
											Page {group.page}
										</button>
									)}
								</div>
								<NoteGroupBody
									activeCitingNoteIds={activeCitingNoteIds}
									expandedNoteId={expandedNoteId}
									group={group}
									onCollapseNote={() => onExpand(null)}
									onDelete={onDelete}
									onEditorReady={onEditorReady}
									onExpandNote={onExpand}
									onJumpToPage={onJumpToPage}
									onOpenCitationBlock={handleOpenCitationBlock}
									onRegisterCardRef={registerCardRef}
								/>
							</div>
						)
					})
				)}
			</div>
		</div>
	)
}

interface NoteGroup {
	page: number | null
	notes: Note[]
}

function useGrouped(notes: Note[]): NoteGroup[] {
	const groups: NoteGroup[] = []
	let currentGroup: NoteGroup | null = null
	for (const note of notes) {
		const page = note.anchorPage
		if (!currentGroup || currentGroup.page !== page) {
			currentGroup = { page, notes: [] }
			groups.push(currentGroup)
		}
		currentGroup.notes.push(note)
	}
	return groups
}

interface NoteGroupBodyProps {
	activeCitingNoteIds: Set<string>
	expandedNoteId: string | null
	group: NoteGroup
	onCollapseNote: () => void
	onDelete?: (noteId: string) => Promise<void> | void
	onEditorReady?: (editor: NoteEditorRef) => void
	onExpandNote: (noteId: string | null) => void
	onJumpToPage: (page: number, yRatio?: number) => void
	onOpenCitationBlock?: (paperId: string, blockId: string) => void
	onRegisterCardRef: (noteId: string, el: HTMLElement | null) => void
}

const NoteGroupBody = memo(function NoteGroupBody({
	activeCitingNoteIds,
	expandedNoteId,
	group,
	onCollapseNote,
	onDelete,
	onEditorReady,
	onExpandNote,
	onJumpToPage,
	onOpenCitationBlock,
	onRegisterCardRef,
}: NoteGroupBodyProps) {
	return (
		<div className="space-y-2">
			{group.notes.map((note) => {
				const anchorPage = note.anchorPage
				return (
					<NoteCard
						expanded={expandedNoteId === note.id}
						isCitingSelectedBlock={activeCitingNoteIds.has(note.id)}
						key={note.id}
						note={note}
						onCollapse={onCollapseNote}
						onDelete={onDelete}
						onEditorReady={onEditorReady}
						onOpenCitationBlock={onOpenCitationBlock}
						onExpand={() => onExpandNote(note.id)}
						onJumpToAnchor={
							anchorPage != null
								? () => onJumpToPage(anchorPage, note.anchorYRatio ?? undefined)
								: undefined
						}
						onRegisterCardRef={onRegisterCardRef}
					/>
				)
			})}
		</div>
	)
})

function NoteCard({
	note,
	expanded,
	isCitingSelectedBlock,
	onExpand,
	onCollapse,
	onJumpToAnchor,
	onDelete,
	onEditorReady,
	onOpenCitationBlock,
	onRegisterCardRef,
}: {
	note: Note
	expanded: boolean
	isCitingSelectedBlock: boolean
	onExpand: () => void
	onCollapse: () => void
	onJumpToAnchor?: () => void
	onDelete?: (noteId: string) => Promise<void> | void
	onEditorReady?: (editor: NoteEditorRef) => void
	onOpenCitationBlock?: (paperId: string, blockId: string) => void
	onRegisterCardRef: (noteId: string, el: HTMLElement | null) => void
}) {
	const setRef = useCallback(
		(el: HTMLElement | null) => {
			onRegisterCardRef(note.id, el)
		},
		[note.id, onRegisterCardRef],
	)

	if (expanded) {
		return (
			<div
				className={`rounded-md border bg-bg-overlay shadow-[var(--shadow-popover)] ${
					isCitingSelectedBlock
						? "border-accent-600/55 ring-1 ring-accent-600/20"
						: "border-border-default"
				}`}
				ref={setRef as (el: HTMLDivElement | null) => void}
			>
				<div className="flex h-[420px] min-h-0 flex-col">
					<NoteEditor
						headerActions={
							<div className="flex items-center justify-end gap-0.5">
								{onJumpToAnchor ? (
									<button
										aria-label="Jump to note anchor"
										className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-accent"
										onClick={onJumpToAnchor}
										title="Jump to this note's anchor in the reader"
										type="button"
									>
										<NoteJumpIcon />
									</button>
								) : null}
								{onDelete ? (
									<button
										aria-label="Delete note"
										className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-error"
										onClick={() => void onDelete(note.id)}
										title="Delete note"
										type="button"
									>
										<NoteTrashIcon />
									</button>
								) : null}
								<button
									aria-label="Collapse note"
									className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-primary"
									onClick={onCollapse}
									title="Collapse"
									type="button"
								>
									<NoteCloseIcon />
								</button>
							</div>
						}
						noteId={note.id}
						onEditorReady={onEditorReady}
						onOpenCitationBlock={onOpenCitationBlock}
					/>
				</div>
			</div>
		)
	}

	return (
		<button
			className={`block w-full cursor-pointer rounded-md border p-2.5 text-left transition-colors hover:bg-bg-overlay ${
				isCitingSelectedBlock
					? "border-accent-600/45 bg-surface-selected/40"
					: "border-border-subtle bg-bg-primary/60"
			}`}
			onClick={onExpand}
			ref={setRef as (el: HTMLButtonElement | null) => void}
			type="button"
		>
			<div className="flex items-start justify-between gap-2">
				<div className="font-medium text-sm text-text-primary">{note.title || "Untitled"}</div>
				{isCitingSelectedBlock ? (
					<span className="shrink-0 rounded-full bg-surface-selected px-2 py-0.5 text-[11px] text-text-accent">
						Linked
					</span>
				) : null}
			</div>
			<div className="mt-0.5 text-text-tertiary text-xs">
				v{note.currentVersion} ·{" "}
				{note.anchorBlockId ? "block-anchored" : note.anchorPage ? "page" : "unanchored"}
			</div>
		</button>
	)
}

function NoteJumpIcon() {
	// Arrow heading up-and-out — "go to" the anchor.
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="14"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.7"
			viewBox="0 0 24 24"
			width="14"
		>
			<path d="M7 17 17 7" />
			<path d="M9 7h8v8" />
		</svg>
	)
}

function NoteTrashIcon() {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="14"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.7"
			viewBox="0 0 24 24"
			width="14"
		>
			<path d="M3 6h18" />
			<path d="M8 6V4h8v2" />
			<path d="M19 6l-1 14H6L5 6" />
			<path d="M10 11v6M14 11v6" />
		</svg>
	)
}

function NoteCloseIcon() {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="14"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.7"
			viewBox="0 0 24 24"
			width="14"
		>
			<path d="m6 6 12 12M18 6 6 18" />
		</svg>
	)
}
