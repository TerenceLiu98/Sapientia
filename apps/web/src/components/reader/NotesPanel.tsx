import {
	memo,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import { createPortal } from "react-dom"
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
	onOpenCitationAnnotation?: (
		paperId: string,
		annotationId: string,
		page?: number,
		yRatio?: number,
	) => void
	// Total page count for the paper, used to normalize each dot's
	// position along the rail. Optional with a 1-page fallback so the
	// component renders cleanly while the paper is still parsing.
	numPages?: number
	// blockId → highlight color (when the user has tagged that block).
	// Used to tint block-anchored dots so the rail visually mirrors the
	// reader's color palette.
	colorByBlock?: Map<string, string>
	// annotationId → its display color. Drives the rail dot color when a
	// note is anchored to a highlight or underline.
	colorByAnnotation?: Map<string, string>
	// blockId → 1-based blockIndex. Surfaces "block 7" labels in the dot
	// tooltip; falls back to bare "block" when unknown.
	blockNumberByBlockId?: Map<string, number>
	// noteId → CSS colors of every block / reader-annotation cited in
	// the note's body. A single-color list paints a solid dot; two or
	// more paint a pie-chart conic gradient so the rail communicates
	// "this note pulls from these N highlights" at a glance. Falls
	// back to the anchor color when empty / missing.
	dotColorsByNote?: Map<string, string[]>
}

// Rail uses normalized 0..1 positions. Each note lands at
// `((page - 1) + yRatio) / numPages` of the rail's total height — the
// rail itself is a fixed-length progress bar that maps the entire paper
// onto the column's vertical extent. No scrolling.
//
// Dot anatomy (inspired by reading-app pin markers): a solid colored
// disc in the center, a thick white halo separating it from the rail,
// and a faint outer ring that gives it weight against light backgrounds.
// All three are layered via box-shadow so the dot stays a single
// circular element.
const DOT_RADIUS = 8
const ACTIVE_DOT_RADIUS = 10
// Two dots are considered to overlap when their normalized positions
// are within this fraction of the rail; the second one is shifted
// horizontally so both stay clickable. ≈ 16px on an 800px-tall rail —
// just enough to keep two ~20px dots from touching.
const OVERLAP_FRAC = 0.02
// Default popover proportions favor wide-and-short — a margin note is
// usually a paragraph or two, not a long-form essay, and a wider canvas
// lets sentences breathe without the user reaching for the resize
// handle. Bounds clamp the resize so a draft can grow into a paper
// without engulfing the viewport.
const POPOVER_DEFAULT_WIDTH = 640
const POPOVER_DEFAULT_HEIGHT = 360
const POPOVER_MIN_WIDTH = 320
const POPOVER_MAX_WIDTH = 960
const POPOVER_MIN_HEIGHT = 240
const POPOVER_MAX_HEIGHT = 900
const POPOVER_GAP = 12
const NEUTRAL_DOT_COLOR = "var(--color-neutral-400)"

// Right pane is no longer a stack of cards — it's a vertical rail that
// echoes the document's spine. Each note becomes a colored dot at its
// anchor's `(page, yRatio)`; clicking the dot summons the editor as an
// inline popover anchored to that dot. The pane stays mostly empty, the
// way real margin annotations stay quiet until the reader looks at them.
//
// `expandedNoteId` is repurposed as "popover open for this note" — we no
// longer auto-expand on page change because popping up a floating
// editor every time the reader turns a page is intrusive. The rail's
// active-page band gives the spatial cue instead.
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
	onOpenCitationAnnotation,
	numPages = 1,
	colorByBlock,
	colorByAnnotation,
	blockNumberByBlockId,
}: NotesPanelProps) {
	// Anchor element for the popover. Captured on click so we can place
	// the popover relative to the exact dot the user activated.
	const [popoverAnchor, setPopoverAnchor] = useState<HTMLButtonElement | null>(null)

	// `externalFollowLockUntil` no longer drives a local scroll lock —
	// the rail is fixed-length, nothing scrolls — but we still surface it
	// to the cite-chip handlers below so cross-pane jumps still chain
	// through the original gating semantics if anything reuses the lock.
	void externalFollowLockUntil
	void currentAnchorYRatio

	// Layout each dot at its normalized rail position (0..1). Two dots
	// whose positions are within OVERLAP_FRAC are bumped right by a
	// fixed step so both stay clickable.
	const placedDots = useMemo(() => {
		const total = Math.max(numPages, 1)
		const placed: Array<{
			note: Note
			top: number // 0..1
			rightOffset: number
			color: string | null
			tooltip: string
		}> = []
		const sorted = [...notes].sort((a, b) => {
			const at = ((a.anchorPage ?? 0) - 1) + (a.anchorYRatio ?? 0.5)
			const bt = ((b.anchorPage ?? 0) - 1) + (b.anchorYRatio ?? 0.5)
			return at - bt
		})
		for (const note of sorted) {
			const page = note.anchorPage ?? 1
			const yRatio = note.anchorYRatio ?? 0.5
			const top = ((page - 1) + yRatio) / total
			let rightOffset = 0
			for (let i = placed.length - 1; i >= 0; i--) {
				const prev = placed[i]
				if (top - prev.top > OVERLAP_FRAC) break
				if (Math.abs(top - prev.top) < OVERLAP_FRAC && prev.rightOffset >= rightOffset) {
					rightOffset = prev.rightOffset + 12
				}
			}
			placed.push({
				note,
				top,
				rightOffset,
				color: dotColorFor(note, colorByBlock, colorByAnnotation),
				tooltip: tooltipFor(note, blockNumberByBlockId),
			})
		}
		return placed
	}, [blockNumberByBlockId, colorByAnnotation, colorByBlock, notes, numPages])

	const handleOpenCitationBlock = useCallback(
		(paperId: string, blockId: string) => {
			onOpenCitationBlock?.(paperId, blockId)
		},
		[onOpenCitationBlock],
	)

	const handleOpenCitationAnnotation = useCallback(
		(paperId: string, annotationId: string, page?: number, yRatio?: number) => {
			onOpenCitationAnnotation?.(paperId, annotationId, page, yRatio)
		},
		[onOpenCitationAnnotation],
	)

	const handleDotClick = useCallback(
		(noteId: string, el: HTMLButtonElement) => {
			if (expandedNoteId === noteId) {
				onExpand(null)
				setPopoverAnchor(null)
				return
			}
			setPopoverAnchor(el)
			onExpand(noteId)
		},
		[expandedNoteId, onExpand],
	)

	const handleClosePopover = useCallback(() => {
		onExpand(null)
		setPopoverAnchor(null)
	}, [onExpand])

	const expandedNote = useMemo(
		() => (expandedNoteId ? notes.find((n) => n.id === expandedNoteId) ?? null : null),
		[expandedNoteId, notes],
	)
	const expandedAnchorPage = expandedNote?.anchorPage ?? null

	// Resolve the popover anchor element from the current note id. Runs
	// on `notes` change too so a freshly-created note's dot — which
	// mounts only after the TanStack Query invalidation refetches —
	// gets picked up. Without this the cite-from-block / cite-from-
	// markup flows set `expandedNoteId` to a brand-new id, the lookup
	// runs once before the dot exists, and the popover silently never
	// opens. We compare against the previous anchor so direct clicks
	// (which already set `popoverAnchor`) don't churn through extra
	// state updates.
	useEffect(() => {
		if (!expandedNoteId) {
			setPopoverAnchor(null)
			return
		}
		if (typeof document === "undefined") return
		const escapedId =
			typeof CSS !== "undefined" && CSS.escape ? CSS.escape(expandedNoteId) : expandedNoteId
		const el = document.querySelector(`[data-note-id="${escapedId}"]`)
		if (el instanceof HTMLButtonElement) {
			setPopoverAnchor((prev) => (prev === el ? prev : el))
		}
	}, [expandedNoteId, notes])

	// Progress-bar fill: from the top of the rail down to the user's
	// current reading position in the document. Mirrors a real progress
	// bar so the rail communicates "how far through the paper" at a
	// glance, without a separate page-band rectangle.
	const total = Math.max(numPages, 1)
	const progressFrac = Math.max(
		0,
		Math.min(1, ((currentPage - 1) + currentAnchorYRatio) / total),
	)

	// `onJumpToPage` and `onCreateAtCurrent` are no longer surfaced on
	// the rail itself — note creation flows through cite-on-highlight /
	// cite-on-block, and page navigation is left to the PDF's own scroll.
	// Kept in the prop bag for now in case a future affordance reuses
	// them.
	void onCreateAtCurrent
	void onJumpToPage

	return (
		// 28px-wide strip glued to the main pane's right edge: line +
		// dots only, no card / border / header / button.
		<aside aria-label="Marginalia rail" className="relative h-full w-9 shrink-0">
			<div className="absolute inset-y-6 right-4 left-0">
				{/* Background rail line. */}
				<div
					aria-hidden="true"
					className="pointer-events-none absolute top-0 bottom-0 right-0 w-px bg-border-subtle"
				/>
				{/* Progress fill — reading position from the top of the paper to
					the user's current spot. Communicates "how far in" the reader
					is at a glance, replacing any page-band rectangle. */}
				<div
					aria-hidden="true"
					className="pointer-events-none absolute right-0 top-0 w-px bg-accent-600/55"
					style={{ height: `${progressFrac * 100}%` }}
				/>
				{/* Reading-position pin: a small accent tick on the rail at the
					current (page, yRatio). */}
				<div
					aria-hidden="true"
					className="pointer-events-none absolute h-0.5 w-2.5 rounded-sm bg-accent-600"
					style={{
						top: `calc(${progressFrac * 100}% - 1px)`,
						right: 0,
					}}
				/>
				{placedDots.map((placed) => (
					<DotButton
						key={placed.note.id}
						active={expandedNoteId === placed.note.id}
						color={placed.color}
						isCitingSelectedBlock={activeCitingNoteIds.has(placed.note.id)}
						isCurrentPage={placed.note.anchorPage === currentPage}
						onClick={(el) => handleDotClick(placed.note.id, el)}
						rightOffset={placed.rightOffset}
						topPercent={placed.top * 100}
						tooltip={placed.tooltip}
						noteId={placed.note.id}
						noteTitle={placed.note.title}
					/>
				))}
			</div>
			{expandedNote && popoverAnchor ? (
				<NotePopover
					anchor={popoverAnchor}
					anchorPage={expandedAnchorPage}
					note={expandedNote}
					onClose={handleClosePopover}
					onDelete={onDelete}
					onEditorReady={onEditorReady}
					onJumpToAnchor={
						expandedAnchorPage != null
							? () =>
									onJumpToPage(
										expandedAnchorPage,
										expandedNote.anchorYRatio ?? undefined,
									)
							: undefined
					}
					onOpenCitationBlock={handleOpenCitationBlock}
					onOpenCitationAnnotation={handleOpenCitationAnnotation}
				/>
			) : null}
		</aside>
	)
}

function dotColorFor(
	note: Note,
	colorByBlock?: Map<string, string>,
	colorByAnnotation?: Map<string, string>,
): string | null {
	if (note.anchorAnnotationId) {
		return colorByAnnotation?.get(note.anchorAnnotationId) ?? null
	}
	if (note.anchorBlockId) {
		return colorByBlock?.get(note.anchorBlockId) ?? null
	}
	return null
}

function tooltipFor(note: Note, blockNumberByBlockId?: Map<string, number>): string {
	const parts: string[] = []
	if (note.title) parts.push(note.title)
	const sourceTag = (() => {
		switch (note.anchorKind) {
			case "highlight":
				return "highlight"
			case "underline":
				return "underline"
			case "block":
				if (note.anchorBlockId) {
					const n = blockNumberByBlockId?.get(note.anchorBlockId)
					return n ? `block ${n}` : "block"
				}
				return null
			default:
				if (note.anchorBlockId) {
					const n = blockNumberByBlockId?.get(note.anchorBlockId)
					return n ? `block ${n}` : "block"
				}
				return null
		}
	})()
	const pageTag = note.anchorPage ? `p.${note.anchorPage}` : null
	const meta = [sourceTag, pageTag].filter(Boolean).join(" · ")
	if (meta) parts.push(meta)
	return parts.join(" — ")
}

const DotButton = memo(function DotButton({
	active,
	color,
	isCitingSelectedBlock,
	isCurrentPage,
	noteId,
	noteTitle,
	onClick,
	rightOffset,
	topPercent,
	tooltip,
}: {
	active: boolean
	color: string | null
	isCitingSelectedBlock: boolean
	isCurrentPage: boolean
	noteId: string
	noteTitle: string
	onClick: (el: HTMLButtonElement) => void
	rightOffset: number
	topPercent: number
	tooltip: string
}) {
	const radius = active ? ACTIVE_DOT_RADIUS : DOT_RADIUS
	const fill = color ?? NEUTRAL_DOT_COLOR
	return (
		<button
			aria-label={tooltip}
			className={`absolute z-[2] flex items-center justify-center rounded-full transition-transform hover:scale-110 ${
				isCurrentPage ? "" : "opacity-75"
			}`}
			data-note-id={noteId}
			onClick={(e) => {
				e.stopPropagation()
				onClick(e.currentTarget)
			}}
			style={{
				top: `calc(${topPercent}% - ${radius}px)`,
				right: `calc(${-rightOffset}px - ${radius}px)`,
				width: `${radius * 2}px`,
				height: `${radius * 2}px`,
				backgroundColor: fill,
				// Layered halo: an inset darken to give the disc some
				// modeling, a thick white halo separating it from the rail,
				// and an outer faint ring so the dot reads even on light
				// backgrounds. Active gets a slightly fatter halo + soft
				// drop shadow; cited-by-selected gets an accent halo.
				boxShadow: active
					? "inset 0 0 0 1px rgba(15,23,42,0.06), 0 0 0 4px rgba(255,255,255,1), 0 0 0 5px rgba(15,23,42,0.18), 0 4px 14px rgba(15,23,42,0.22)"
					: isCitingSelectedBlock
						? "inset 0 0 0 1px rgba(15,23,42,0.06), 0 0 0 3px rgba(255,255,255,1), 0 0 0 5px var(--color-accent-600)"
						: "inset 0 0 0 1px rgba(15,23,42,0.06), 0 0 0 3px rgba(255,255,255,1), 0 0 0 4px rgba(15,23,42,0.16)",
			}}
			title={tooltip}
			type="button"
		>
			{/* Hidden text so screen readers + tests can match by note title.
				The visible affordance is the colored dot. */}
			<span className="sr-only">{noteTitle}</span>
			{isCitingSelectedBlock ? <span className="sr-only">Linked</span> : null}
		</button>
	)
})

function NotePopover({
	anchor,
	anchorPage,
	note,
	onClose,
	onDelete,
	onEditorReady,
	onJumpToAnchor,
	onOpenCitationBlock,
	onOpenCitationAnnotation,
}: {
	anchor: HTMLElement
	anchorPage: number | null
	note: Note
	onClose: () => void
	onDelete?: (noteId: string) => Promise<void> | void
	onEditorReady?: (editor: NoteEditorRef) => void
	onJumpToAnchor?: () => void
	onOpenCitationBlock?: (paperId: string, blockId: string) => void
	onOpenCitationAnnotation?: (
		paperId: string,
		annotationId: string,
		page?: number,
		yRatio?: number,
	) => void
}) {
	const popoverRef = useRef<HTMLDivElement | null>(null)
	const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
	// Popover dimensions are user-resizable now that the marginalia frame
	// is gone. Drag the bottom-left corner (the corner facing the PDF) to
	// resize; left edge stays anchored to where the popover currently
	// sits, so a wider popover grows further into the PDF rather than
	// pushing into the rail.
	const [size, setSize] = useState<{ width: number; height: number }>({
		width: POPOVER_DEFAULT_WIDTH,
		height: POPOVER_DEFAULT_HEIGHT,
	})
	const resizingRef = useRef<{
		startX: number
		startY: number
		startWidth: number
		startHeight: number
	} | null>(null)

	// Compute popover position relative to the anchor dot. The popover
	// hangs to the LEFT of the rail (toward the PDF), so the user's eye
	// travels back from the dot into the document where the cited
	// passage lives. Re-runs on resize so the editor stays in view if
	// the viewport reflows.
	useEffect(() => {
		const reposition = () => {
			const rect = anchor.getBoundingClientRect()
			const top = clamp(
				rect.top + rect.height / 2 - size.height / 2,
				12,
				window.innerHeight - size.height - 12,
			)
			let left = rect.left - size.width - POPOVER_GAP
			// If we'd run off the left edge (very narrow viewport or rail
			// pinned far left), fall back to the right side of the dot.
			if (left < 12) left = rect.right + POPOVER_GAP
			setPosition({ top, left })
		}
		reposition()
		window.addEventListener("scroll", reposition, true)
		window.addEventListener("resize", reposition)
		return () => {
			window.removeEventListener("scroll", reposition, true)
			window.removeEventListener("resize", reposition)
		}
	}, [anchor, size.height, size.width])

	// Click-outside / Esc to close. The popover itself is in a portal, so
	// "outside" means anywhere not inside `popoverRef` and not the anchor
	// dot (whose own click handler manages toggle state).
	useEffect(() => {
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node | null
			if (!target) return
			if (popoverRef.current?.contains(target)) return
			if (anchor.contains(target)) return
			onClose()
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose()
		}
		window.addEventListener("pointerdown", onPointerDown, true)
		window.addEventListener("keydown", onKeyDown)
		return () => {
			window.removeEventListener("pointerdown", onPointerDown, true)
			window.removeEventListener("keydown", onKeyDown)
		}
	}, [anchor, onClose])

	// Resize: drag bottom-left corner. dx is inverted because growing
	// the popover means the LEFT edge moves left (toward the PDF), which
	// looks like negative pointer-x delta from the corner's perspective.
	const onResizePointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			event.preventDefault()
			event.stopPropagation()
			;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
			resizingRef.current = {
				startX: event.clientX,
				startY: event.clientY,
				startWidth: size.width,
				startHeight: size.height,
			}
		},
		[size.height, size.width],
	)
	useEffect(() => {
		const onMove = (event: PointerEvent) => {
			const drag = resizingRef.current
			if (!drag) return
			const dx = event.clientX - drag.startX
			const dy = event.clientY - drag.startY
			setSize({
				width: clamp(drag.startWidth - dx, POPOVER_MIN_WIDTH, POPOVER_MAX_WIDTH),
				height: clamp(drag.startHeight + dy, POPOVER_MIN_HEIGHT, POPOVER_MAX_HEIGHT),
			})
		}
		const onUp = () => {
			resizingRef.current = null
		}
		window.addEventListener("pointermove", onMove)
		window.addEventListener("pointerup", onUp)
		window.addEventListener("pointercancel", onUp)
		return () => {
			window.removeEventListener("pointermove", onMove)
			window.removeEventListener("pointerup", onUp)
			window.removeEventListener("pointercancel", onUp)
		}
	}, [])

	if (typeof document === "undefined" || !position) return null

	return createPortal(
		<div
			className="fixed z-[40] flex flex-col rounded-md border border-border-default bg-bg-overlay shadow-[var(--shadow-popover)]"
			ref={popoverRef}
			style={{
				top: `${position.top}px`,
				left: `${position.left}px`,
				width: `${size.width}px`,
				height: `${size.height}px`,
			}}
		>
			<div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-2.5 py-1.5 text-xs text-text-tertiary">
				<span className="truncate">
					{anchorPage != null ? `Page ${anchorPage}` : "Unanchored"} · {note.title || "Untitled"}
				</span>
				<div className="flex items-center gap-0.5">
					{onJumpToAnchor ? (
						<button
							aria-label="Jump to note anchor"
							className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-accent"
							onClick={onJumpToAnchor}
							title="Jump to this note's anchor in the reader"
							type="button"
						>
							<JumpIcon />
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
							<TrashIcon />
						</button>
					) : null}
					<button
						aria-label="Close note"
						className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-primary"
						onClick={onClose}
						title="Close"
						type="button"
					>
						<CloseIcon />
					</button>
				</div>
			</div>
			<div className="min-h-0 flex-1">
				<NoteEditor
					noteId={note.id}
					onEditorReady={onEditorReady}
					onOpenCitationBlock={onOpenCitationBlock}
					onOpenCitationAnnotation={onOpenCitationAnnotation}
				/>
			</div>
			{/* Resize handle in the bottom-LEFT corner — the corner facing the
				PDF, since growing the popover should expand toward the
				document, not back into the rail. The chevron sits inside the
				corner padding so it never overlaps editor content. */}
			{/* biome-ignore lint/a11y/noStaticElementInteractions: drag handle, not a semantic control */}
			<div
				aria-label="Resize note"
				className="absolute bottom-0 left-0 z-[1] h-3.5 w-3.5 cursor-nesw-resize"
				onPointerDown={onResizePointerDown}
				title="Drag to resize"
			>
				<span className="absolute bottom-1 left-1 h-2 w-2 border-b-2 border-l-2 border-border-default/80" />
			</div>
		</div>,
		document.body,
	)
}

function clamp(n: number, lo: number, hi: number) {
	return Math.max(lo, Math.min(hi, n))
}

function JumpIcon() {
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

function TrashIcon() {
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

function CloseIcon() {
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
