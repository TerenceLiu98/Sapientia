import { useCallback, useEffect, useRef } from "react"
import type { Note } from "@/api/hooks/notes"
import { NoteEditor, type NoteEditorRef } from "@/components/notes/NoteEditor"

interface NotesPanelProps {
	activeCitingNoteIds: Set<string>
	notes: Note[]
	currentPage: number
	currentAnchorYRatio: number
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
	expandedNoteId,
	onExpand,
	onJumpToPage,
	onCreateAtCurrent,
	onDelete,
	onEditorReady,
	onOpenCitationBlock,
}: NotesPanelProps) {
	const scrollRef = useRef<HTMLDivElement | null>(null)
	const cardRefs = useRef(new Map<string, HTMLDivElement>())
	const headerRefs = useRef(new Map<number | "unanchored", HTMLDivElement>())
	// Soft-lock for the page-driven follow effect: if the user just scrolled
	// inside the pane themselves, we skip auto-scroll for ~500ms so the two
	// scroll sources don't fight. Same pattern as BlocksPanel.
	const lockUntilRef = useRef(0)

	const grouped = useGrouped(notes)

	// Page changes from the PDF/parsed view → scroll the pane to that page's
	// closest note anchor. Skipped while locked.
	useEffect(() => {
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
	}, [currentAnchorYRatio, currentPage, notes])

	const onUserScroll = useCallback(() => {
		lockUntilRef.current = Date.now() + 500
	}, [])

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
								<div className="space-y-2">
									{group.notes.map((note) => {
										const anchorPage = note.anchorPage
										return (
											<NoteCard
												cardRefs={cardRefs}
												expanded={expandedNoteId === note.id}
												isCitingSelectedBlock={activeCitingNoteIds.has(note.id)}
												key={note.id}
												note={note}
												onCollapse={() => onExpand(null)}
												onDelete={onDelete}
												onEditorReady={onEditorReady}
												onOpenCitationBlock={onOpenCitationBlock}
												onExpand={() => onExpand(note.id)}
												onJumpToAnchor={
													anchorPage != null
														? () => onJumpToPage(anchorPage, note.anchorYRatio ?? undefined)
														: undefined
												}
											/>
										)
									})}
								</div>
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

function NoteCard({
	note,
	expanded,
	isCitingSelectedBlock,
	cardRefs,
	onExpand,
	onCollapse,
	onJumpToAnchor,
	onDelete,
	onEditorReady,
	onOpenCitationBlock,
}: {
	note: Note
	expanded: boolean
	isCitingSelectedBlock: boolean
	cardRefs: React.MutableRefObject<Map<string, HTMLDivElement>>
	onExpand: () => void
	onCollapse: () => void
	onJumpToAnchor?: () => void
	onDelete?: (noteId: string) => Promise<void> | void
	onEditorReady?: (editor: NoteEditorRef) => void
	onOpenCitationBlock?: (paperId: string, blockId: string) => void
}) {
	const setRef = (el: HTMLDivElement | null) => {
		if (el) cardRefs.current.set(note.id, el)
		else cardRefs.current.delete(note.id)
	}

	if (expanded) {
		return (
			<div
				className={`rounded-md border bg-bg-overlay shadow-[var(--shadow-popover)] ${
					isCitingSelectedBlock
						? "border-accent-600/55 ring-1 ring-accent-600/20"
						: "border-border-default"
				}`}
				ref={setRef}
			>
				<div className="flex h-[420px] min-h-0 flex-col">
					<NoteEditor
						headerActions={
							<div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
								{onJumpToAnchor ? (
									<button
										className="shrink-0 whitespace-nowrap text-text-tertiary text-xs hover:text-text-accent"
										onClick={onJumpToAnchor}
										title="Jump to this note's anchor in the reader"
										type="button"
									>
										Jump
									</button>
								) : null}
								{onDelete ? (
									<button
										className="shrink-0 whitespace-nowrap text-text-tertiary text-xs hover:text-text-error"
										onClick={() => void onDelete(note.id)}
										title="Delete note"
										type="button"
									>
										Delete
									</button>
								) : null}
								<button
									className="shrink-0 whitespace-nowrap text-text-tertiary text-xs hover:text-text-primary"
									onClick={onCollapse}
									title="Collapse"
									type="button"
								>
									Close
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
			ref={(el) => setRef(el as unknown as HTMLDivElement | null)}
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
