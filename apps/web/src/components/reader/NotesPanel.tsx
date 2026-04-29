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
import type { PdfRailLayout } from "@/components/reader/PdfViewer"

interface NotesPanelProps {
	activeCitingNoteIds: Set<string>
	blockAnchorsById?: Map<string, { page: number; yRatio: number }>
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
	pdfRailLayout?: PdfRailLayout | null
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
const DOT_CENTER_OFFSET = 9
// Nearby note anchors should remain readable as distinct stops on the
// rail. We spread dense clusters vertically, but keep every dot on the
// same horizontal line so the rail reads as a clean single track.
const MIN_DOT_SPACING_FRAC = 0.028
const MINIMAP_FOCUS_STRENGTH = 5
const MINIMAP_NEAR_DOT_SCALE = 1.15
const MINIMAP_FAR_DOT_SCALE = 0.74
const MINIMAP_VIEWPORT_MIN_SPAN_FRAC = 0.06
const PROGRESS_BAR_WIDTH = 8
const PROGRESS_KNOB_WIDTH = 20
const PROGRESS_KNOB_HEIGHT = 6
// Default popover proportions should feel like a side-gloss, not a
// floating workspace. Keep it narrow enough that the PDF still carries
// the layout, with height doing most of the work.
const POPOVER_DEFAULT_WIDTH = 360
const POPOVER_DEFAULT_HEIGHT = 680
const POPOVER_MIN_WIDTH = 340
const POPOVER_MAX_WIDTH = 720
const POPOVER_MIN_HEIGHT = 420
const POPOVER_MAX_HEIGHT = 960
const POPOVER_GAP = 12
const POPOVER_VIEWPORT_WIDTH_FRACTION = 0.28
const POPOVER_VIEWPORT_HEIGHT_FRACTION = 0.78
const POPOVER_ANCHOR_MARGIN = 28
const POPOVER_CONNECTOR_SPAN = 72
const POPOVER_CONNECTOR_DOT = 14
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
	blockAnchorsById,
	colorByBlock,
	colorByAnnotation,
	blockNumberByBlockId,
	dotColorsByNote,
	pdfRailLayout,
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

	// The rail behaves like a minimap rather than a raw progress bar:
	// anchors near the live viewport are visually magnified, while far
	// regions get compressed so local structure reads more clearly.
	const minimapActive = (pdfRailLayout?.scrollHeight ?? 0) > 0
	const progressFrac = railProgressForViewport(currentPage, currentAnchorYRatio, pdfRailLayout, numPages)
	const viewportWindow = useMemo(
		() => minimapViewportWindow(progressFrac, pdfRailLayout, minimapActive),
		[progressFrac, pdfRailLayout, minimapActive],
	)

	// Layout each dot at its normalized rail position (0..1), but group
	// notes by structural block first so one block produces one rail pin.
	// Two dots whose positions are within OVERLAP_FRAC are bumped right
	// by a fixed step so both stay clickable.
	const groupedDots = useMemo(() => {
		const grouped = new Map<
			string,
			{
				groupKey: string
				blockId: string | null
				notes: Note[]
				page: number
				yRatio: number
			}
		>()
		for (const note of notes) {
			const groupKey = note.anchorBlockId ? `block:${note.anchorBlockId}` : `note:${note.id}`
			const blockAnchor =
				note.anchorBlockId != null ? (blockAnchorsById?.get(note.anchorBlockId) ?? null) : null
			const page = blockAnchor?.page ?? note.anchorPage ?? 1
			const yRatio = blockAnchor?.yRatio ?? note.anchorYRatio ?? 0.5
			const existing = grouped.get(groupKey)
			if (existing) {
				existing.notes.push(note)
				continue
			}
			grouped.set(groupKey, {
				groupKey,
				blockId: note.anchorBlockId,
				notes: [note],
				page,
				yRatio,
			})
		}
		const groupedWithTop = [...grouped.values()]
			.map((group) => ({
				...group,
				notes: [...group.notes].sort(compareNotesByAnchor),
				rawTop: railTopForAnchor(group.page, group.yRatio, pdfRailLayout, numPages),
				focusTop: minimapActive
					? minimapTopForRail(
							railTopForAnchor(group.page, group.yRatio, pdfRailLayout, numPages),
							progressFrac,
						)
					: railTopForAnchor(group.page, group.yRatio, pdfRailLayout, numPages),
			}))
			.sort((a, b) => a.focusTop - b.focusTop)
		const adjustedTops = spreadDotTops(groupedWithTop.map((group) => group.focusTop))
		const placed: Array<{
			groupKey: string
			blockId: string | null
			notes: Note[]
			page: number
			top: number // 0..1
			rightOffset: number
			background: string
			tooltip: string
			srLabel: string
			visualScale: number
		}> = []
		for (const [index, group] of groupedWithTop.entries()) {
			const top = adjustedTops[index] ?? group.focusTop
			const colors = dotColorsForGroup(
				group.notes,
				dotColorsByNote,
				colorByBlock,
				colorByAnnotation,
			)
			const tooltip = tooltipForGroup(group.notes, group.page, group.blockId, blockNumberByBlockId)
			const srLabel = group.notes.length === 1 ? group.notes[0]?.title || tooltip : tooltip
			const isExpanded = group.notes.some((note) => note.id === expandedNoteId)
			const visualScale = minimapActive
				? minimapDotScaleForRail(group.rawTop, progressFrac, isExpanded)
				: isExpanded
					? 1.08
					: 1
			placed.push({
				groupKey: group.groupKey,
				blockId: group.blockId,
				notes: group.notes,
				page: group.page,
				top,
				rightOffset: 0,
				background: dotBackgroundForColors(colors),
				tooltip,
				srLabel,
				visualScale,
			})
		}
		return placed
	}, [
		blockAnchorsById,
		blockNumberByBlockId,
		colorByAnnotation,
		colorByBlock,
		dotColorsByNote,
		expandedNoteId,
		minimapActive,
		notes,
		numPages,
		pdfRailLayout,
		progressFrac,
	])

	const expandedGroup = useMemo(
		() =>
			expandedNoteId
				? (groupedDots.find((group) => group.notes.some((note) => note.id === expandedNoteId)) ??
					null)
				: null,
		[expandedNoteId, groupedDots],
	)

	const expandedNote = useMemo(
		() => expandedGroup?.notes.find((note) => note.id === expandedNoteId) ?? null,
		[expandedGroup, expandedNoteId],
	)
	const expandedAnchorPage = expandedNote?.anchorPage ?? expandedGroup?.page ?? null

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
		(
			group: {
				groupKey: string
				notes: Note[]
			},
			el: HTMLButtonElement,
		) => {
			const isGroupExpanded = group.notes.some((note) => note.id === expandedNoteId)
			if (isGroupExpanded) {
				onExpand(null)
				setPopoverAnchor(null)
				return
			}
			setPopoverAnchor(el)
			onExpand(group.notes[0]?.id ?? null)
		},
		[expandedNoteId, onExpand],
	)

	const handleClosePopover = useCallback(() => {
		onExpand(null)
		setPopoverAnchor(null)
	}, [onExpand])

	const handleSelectGroupedNote = useCallback(
		(noteId: string) => {
			onExpand(noteId)
		},
		[onExpand],
	)

	// Resolve the popover anchor element from the current group key. Runs
	// on `notes` change too so a freshly-created note's grouped dot —
	// which mounts only after the TanStack Query invalidation refetches —
	// gets picked up.
	useEffect(() => {
		if (!expandedGroup) {
			setPopoverAnchor(null)
			return
		}
		if (typeof document === "undefined") return
		const escapedKey =
			typeof CSS !== "undefined" && CSS.escape
				? CSS.escape(expandedGroup.groupKey)
				: expandedGroup.groupKey
		const el = document.querySelector(`[data-note-group-key="${escapedKey}"]`)
		if (el instanceof HTMLButtonElement) {
			setPopoverAnchor((prev) => (prev === el ? prev : el))
		}
	}, [expandedGroup, notes])

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
					className="pointer-events-none absolute top-0 bottom-0 right-0 w-1 rounded-full bg-border-default/65"
				/>
				{/* Progress fill — this behaves like a media-player progress
					bar: the track fills from the top down to the current reader
					position. */}
				<div
					aria-hidden="true"
					className="pointer-events-none absolute right-0 top-0 rounded-full bg-accent-800/92"
					style={{
						width: `${PROGRESS_BAR_WIDTH}px`,
						height: `${progressFrac * 100}%`,
					}}
				/>
				{/* Viewport lens — a subtle local window inside the progress
					bar so the rail still hints at the visible PDF span. */}
				<div
					aria-hidden="true"
					className="pointer-events-none absolute right-[1px] rounded-full bg-white/20"
					style={{
						top: `${viewportWindow.top * 100}%`,
						width: `${Math.max(2, PROGRESS_BAR_WIDTH - 2)}px`,
						height: `${Math.max(0.8, (viewportWindow.bottom - viewportWindow.top) * 100)}%`,
					}}
				/>
				{/* Progress knob at the live viewport anchor. */}
				<div
					aria-hidden="true"
					className="pointer-events-none absolute rounded-full bg-accent-800"
					style={{
						top: `calc(${progressFrac * 100}% - ${PROGRESS_KNOB_HEIGHT / 2}px)`,
						right: `${-(PROGRESS_KNOB_WIDTH - PROGRESS_BAR_WIDTH) / 2}px`,
						width: `${PROGRESS_KNOB_WIDTH}px`,
						height: `${PROGRESS_KNOB_HEIGHT}px`,
					}}
				/>
				{groupedDots.map((placed) => (
					<DotButton
						key={placed.groupKey}
						active={placed.notes.some((note) => note.id === expandedNoteId)}
						background={placed.background}
						groupKey={placed.groupKey}
						isCitingSelectedBlock={placed.notes.some((note) => activeCitingNoteIds.has(note.id))}
						isCurrentPage={placed.page === currentPage}
						onClick={(el) => handleDotClick(placed, el)}
						primaryNoteId={placed.notes[0]?.id ?? placed.groupKey}
						rightOffset={placed.rightOffset}
						srLabel={placed.srLabel}
						topPercent={placed.top * 100}
						tooltip={placed.tooltip}
						visualScale={placed.visualScale}
						activeOutlineColor={
							placed.notes.some((candidate) => candidate.id === expandedNoteId) && expandedNote
								? (dotColorFor(expandedNote, colorByBlock, colorByAnnotation) ?? undefined)
								: undefined
						}
					/>
				))}
			</div>
			{expandedNote && expandedGroup && popoverAnchor ? (
				<NotePopover
					anchor={popoverAnchor}
					anchorPage={expandedAnchorPage}
					blockNumber={
						expandedGroup.blockId
							? (blockNumberByBlockId?.get(expandedGroup.blockId) ?? null)
							: null
					}
					groupLabel={groupLabelForPopover(
						expandedGroup.notes,
						expandedGroup.blockId,
						blockNumberByBlockId,
					)}
					colorByAnnotation={colorByAnnotation}
					colorByBlock={colorByBlock}
					note={expandedNote}
					notes={expandedGroup.notes}
					onClose={handleClosePopover}
					onDelete={onDelete}
					onEditorReady={onEditorReady}
					onSelectNote={handleSelectGroupedNote}
					onJumpToAnchor={
						expandedAnchorPage != null
							? () => onJumpToPage(expandedAnchorPage, expandedNote.anchorYRatio ?? undefined)
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

function tooltipForGroup(
	notes: Note[],
	page: number,
	blockId: string | null,
	blockNumberByBlockId?: Map<string, number>,
): string {
	if (notes.length === 1) return tooltipFor(notes[0], blockNumberByBlockId)
	const blockTag = blockLabelFor(blockId, blockNumberByBlockId)
	const parts = [blockTag, `p.${page}`, `${notes.length} notes`].filter(Boolean)
	return parts.join(" · ")
}

function groupLabelForPopover(
	notes: Note[],
	blockId: string | null,
	blockNumberByBlockId?: Map<string, number>,
) {
	if (notes.length <= 1)
		return blockLabelFor(blockId, blockNumberByBlockId) ?? (notes[0]?.title || "Untitled")
	const blockTag = blockLabelFor(blockId, blockNumberByBlockId)
	const parts = [blockTag, `${notes.length} notes`].filter(Boolean)
	return parts.join(" · ")
}

function blockLabelFor(blockId: string | null, blockNumberByBlockId?: Map<string, number>) {
	const blockTag = blockId
		? (() => {
				const n = blockNumberByBlockId?.get(blockId)
				return n ? `block ${n}` : "block"
			})()
		: null
	return blockTag
}

function noteAnchorRank(note: Note) {
	if (note.anchorKind === "block") return 0
	if (note.anchorKind === "highlight" || note.anchorKind === "underline") return 1
	return 2
}

function compareNotesByAnchor(a: Note, b: Note) {
	const rankDelta = noteAnchorRank(a) - noteAnchorRank(b)
	if (rankDelta !== 0) return rankDelta
	const yDelta = (a.anchorYRatio ?? 0.5) - (b.anchorYRatio ?? 0.5)
	if (Math.abs(yDelta) > 0.0001) return yDelta
	const createdDelta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
	if (createdDelta !== 0) return createdDelta
	return a.id.localeCompare(b.id)
}

function sourceLabelForNote(note: Note, notes: Note[], blockNumber: number | null) {
	if (note.anchorKind === "block") {
		const blockLabel = blockNumber ? `block ${blockNumber}` : "block"
		const blockNotes = notes
			.filter((candidate) => candidate.anchorKind === "block")
			.sort(compareNotesByAnchor)
		if (blockNotes.length <= 1) return blockLabel
		const index = blockNotes.findIndex((candidate) => candidate.id === note.id)
		return `${blockLabel} note ${index + 1}`
	}
	const type = note.anchorKind === "underline" ? "underline" : "highlight"
	const typeNotes = notes
		.filter((candidate) => candidate.anchorKind === note.anchorKind)
		.sort(compareNotesByAnchor)
	const ordinal = Math.max(1, typeNotes.findIndex((candidate) => candidate.id === note.id) + 1)
	const prefix: string[] = []
	if (note.anchorPage) prefix.push(`p${note.anchorPage}`)
	if (blockNumber) prefix.push(`blk${blockNumber}`)
	prefix.push(type)
	return `${prefix.join(".")} ${ordinal}`
}

function dotColorsForGroup(
	notes: Note[],
	dotColorsByNote?: Map<string, string[]>,
	colorByBlock?: Map<string, string>,
	colorByAnnotation?: Map<string, string>,
) {
	const colors: string[] = []
	const seen = new Set<string>()
	for (const note of notes) {
		const citedColors = dotColorsByNote?.get(note.id) ?? []
		if (citedColors.length > 0) {
			for (const color of citedColors) {
				if (seen.has(color)) continue
				seen.add(color)
				colors.push(color)
			}
			continue
		}
		const anchorColor = dotColorFor(note, colorByBlock, colorByAnnotation)
		if (!anchorColor || seen.has(anchorColor)) continue
		seen.add(anchorColor)
		colors.push(anchorColor)
	}
	return colors
}

function dotBackgroundForColors(colors: string[]) {
	const palette = colors.length > 0 ? colors : [NEUTRAL_DOT_COLOR]
	if (palette.length === 1) return palette[0]!
	const slice = 100 / palette.length
	return `conic-gradient(${palette
		.map((color, index) => {
			const start = (slice * index).toFixed(3)
			const end = (slice * (index + 1)).toFixed(3)
			return `${color} ${start}% ${end}%`
		})
		.join(", ")})`
}

function railTopForAnchor(
	page: number,
	yRatio: number,
	pdfRailLayout: PdfRailLayout | null | undefined,
	numPages: number,
) {
	const metric = pdfRailLayout?.pageMetrics.get(page)
	const scrollHeight = pdfRailLayout?.scrollHeight ?? 0
	if (metric && scrollHeight > 0) {
		return clamp((metric.top + metric.height * yRatio) / scrollHeight, 0, 1)
	}
	const total = Math.max(numPages, 1)
	return clamp((page - 1 + yRatio) / total, 0, 1)
}

function railProgressForViewport(
	currentPage: number,
	currentAnchorYRatio: number,
	pdfRailLayout: PdfRailLayout | null | undefined,
	numPages: number,
) {
	const scrollHeight = pdfRailLayout?.scrollHeight ?? 0
	if (scrollHeight > 0) {
		return clamp((pdfRailLayout?.viewportAnchorTop ?? 0) / scrollHeight, 0, 1)
	}
	const total = Math.max(numPages, 1)
	return clamp((currentPage - 1 + currentAnchorYRatio) / total, 0, 1)
}

function minimapTopForRail(rawTop: number, focusTop: number) {
	if (!Number.isFinite(rawTop) || !Number.isFinite(focusTop)) return clamp(rawTop, 0, 1)
	if (Math.abs(rawTop - focusTop) < 0.0001) return clamp(rawTop, 0, 1)
	if (rawTop < focusTop) {
		const span = Math.max(focusTop, 0.0001)
		const normalized = (rawTop - focusTop) / span
		return clamp(
			focusTop +
				span * (Math.asinh(MINIMAP_FOCUS_STRENGTH * normalized) / Math.asinh(MINIMAP_FOCUS_STRENGTH)),
			0,
			1,
		)
	}
	const span = Math.max(1 - focusTop, 0.0001)
	const normalized = (rawTop - focusTop) / span
	return clamp(
		focusTop +
			span * (Math.asinh(MINIMAP_FOCUS_STRENGTH * normalized) / Math.asinh(MINIMAP_FOCUS_STRENGTH)),
		0,
		1,
	)
}

function minimapDotScaleForRail(rawTop: number, focusTop: number, active: boolean) {
	const span = rawTop < focusTop ? Math.max(focusTop, 0.0001) : Math.max(1 - focusTop, 0.0001)
	const normalizedDistance = clamp(Math.abs(rawTop - focusTop) / span, 0, 1)
	const easedProximity = 1 - normalizedDistance ** 0.7
	const scale =
		MINIMAP_FAR_DOT_SCALE +
		(MINIMAP_NEAR_DOT_SCALE - MINIMAP_FAR_DOT_SCALE) * easedProximity
	return active ? Math.max(scale, 1.08) : scale
}

function minimapViewportWindow(
	progressTop: number,
	pdfRailLayout: PdfRailLayout | null | undefined,
	minimapActive: boolean,
) {
	if (!minimapActive) {
		return {
			top: clamp(progressTop - MINIMAP_VIEWPORT_MIN_SPAN_FRAC / 2, 0, 1),
			bottom: clamp(progressTop + MINIMAP_VIEWPORT_MIN_SPAN_FRAC / 2, 0, 1),
		}
	}
	const scrollHeight = pdfRailLayout?.scrollHeight ?? 0
	if (scrollHeight <= 0) {
		return {
			top: clamp(progressTop - MINIMAP_VIEWPORT_MIN_SPAN_FRAC / 2, 0, 1),
			bottom: clamp(progressTop + MINIMAP_VIEWPORT_MIN_SPAN_FRAC / 2, 0, 1),
		}
	}
	const rawTop = clamp((pdfRailLayout?.scrollTop ?? 0) / scrollHeight, 0, 1)
	const rawBottom = clamp(
		((pdfRailLayout?.scrollTop ?? 0) + (pdfRailLayout?.viewportHeight ?? 0)) / scrollHeight,
		0,
		1,
	)
	const top = minimapTopForRail(rawTop, progressTop)
	const bottom = minimapTopForRail(rawBottom, progressTop)
	if (bottom - top >= MINIMAP_VIEWPORT_MIN_SPAN_FRAC) {
		return { top, bottom }
	}
	const halfMin = MINIMAP_VIEWPORT_MIN_SPAN_FRAC / 2
	return {
		top: clamp(progressTop - halfMin, 0, 1),
		bottom: clamp(progressTop + halfMin, 0, 1),
	}
}

function spreadDotTops(rawTops: number[]) {
	if (rawTops.length === 0) return rawTops
	const tops = [...rawTops]
	for (let i = 1; i < tops.length; i += 1) {
		tops[i] = Math.max(tops[i], tops[i - 1]! + MIN_DOT_SPACING_FRAC)
	}
	const maxTop = 1
	if (tops[tops.length - 1]! > maxTop) {
		tops[tops.length - 1] = maxTop
		for (let i = tops.length - 2; i >= 0; i -= 1) {
			tops[i] = Math.min(tops[i]!, tops[i + 1]! - MIN_DOT_SPACING_FRAC)
		}
	}
	for (let i = 0; i < tops.length; i += 1) {
		tops[i] = clamp(tops[i]!, 0, 1)
	}
	return tops
}

function defaultPopoverSize() {
	if (typeof window === "undefined") {
		return {
			width: POPOVER_DEFAULT_WIDTH,
			height: POPOVER_DEFAULT_HEIGHT,
		}
	}
	const maxViewportWidth = Math.max(POPOVER_MIN_WIDTH, window.innerWidth - 48)
	const maxViewportHeight = Math.max(POPOVER_MIN_HEIGHT, window.innerHeight - 48)
	return {
		width: clamp(
			Math.round(window.innerWidth * POPOVER_VIEWPORT_WIDTH_FRACTION),
			POPOVER_MIN_WIDTH,
			Math.min(POPOVER_MAX_WIDTH, maxViewportWidth),
		),
		height: clamp(
			Math.round(window.innerHeight * POPOVER_VIEWPORT_HEIGHT_FRACTION),
			POPOVER_MIN_HEIGHT,
			Math.min(POPOVER_MAX_HEIGHT, maxViewportHeight),
		),
	}
}

const DotButton = memo(function DotButton({
	active,
	background,
	groupKey,
	isCitingSelectedBlock,
	isCurrentPage,
	onClick,
	primaryNoteId,
	rightOffset,
	srLabel,
	topPercent,
	tooltip,
	visualScale,
	activeOutlineColor,
}: {
	active: boolean
	background: string
	groupKey: string
	isCitingSelectedBlock: boolean
	isCurrentPage: boolean
	onClick: (el: HTMLButtonElement) => void
	primaryNoteId: string
	rightOffset: number
	srLabel: string
	topPercent: number
	tooltip: string
	visualScale: number
	activeOutlineColor?: string
}) {
	const radius = (active ? ACTIVE_DOT_RADIUS : DOT_RADIUS) * visualScale
	const outlineColor = activeOutlineColor ?? "var(--color-accent-600)"
	return (
		<button
			aria-label={tooltip}
			className={`absolute z-[2] flex items-center justify-center rounded-full transition-[width,height,top,right,opacity,box-shadow] duration-200 hover:scale-110 ${
				isCurrentPage ? "" : "opacity-75"
			}`}
			data-minimap-scale={visualScale.toFixed(3)}
			data-note-group-key={groupKey}
			data-note-id={primaryNoteId}
			data-rail-top={topPercent.toFixed(3)}
			onClick={(e) => {
				e.stopPropagation()
				onClick(e.currentTarget)
			}}
			style={{
				top: `calc(${topPercent}% - ${radius}px)`,
				right: `calc(${-DOT_CENTER_OFFSET - rightOffset}px - ${radius}px)`,
				width: `${radius * 2}px`,
				height: `${radius * 2}px`,
				background,
				// Layered halo: an inset darken to give the disc some
				// modeling, a thick white halo separating it from the rail,
				// and an outer faint ring so the dot reads even on light
				// backgrounds. Active gets a slightly fatter halo + soft
				// drop shadow; cited-by-selected gets an accent halo.
				boxShadow: active
					? `inset 0 0 0 1px rgba(15,23,42,0.06), 0 0 0 4px rgba(255,255,255,1), 0 0 0 6px ${outlineColor}, 0 4px 14px rgba(15,23,42,0.22)`
					: isCitingSelectedBlock
						? "inset 0 0 0 1px rgba(15,23,42,0.06), 0 0 0 3px rgba(255,255,255,1), 0 0 0 5px var(--color-accent-600)"
						: "inset 0 0 0 1px rgba(15,23,42,0.06), 0 0 0 3px rgba(255,255,255,1), 0 0 0 4px rgba(15,23,42,0.16)",
			}}
			title={tooltip}
			type="button"
		>
			{/* Hidden text so screen readers + tests can match by note title.
				The visible affordance is the colored dot. */}
			<span className="sr-only">{srLabel}</span>
			{isCitingSelectedBlock ? <span className="sr-only">Linked</span> : null}
		</button>
	)
})

function NotePopover({
	anchor,
	anchorPage,
	blockNumber,
	colorByAnnotation,
	colorByBlock,
	groupLabel,
	note,
	notes,
	onClose,
	onDelete,
	onEditorReady,
	onJumpToAnchor,
	onOpenCitationBlock,
	onOpenCitationAnnotation,
	onSelectNote,
}: {
	anchor: HTMLElement
	anchorPage: number | null
	blockNumber: number | null
	colorByAnnotation?: Map<string, string>
	colorByBlock?: Map<string, string>
	groupLabel: string
	note: Note
	notes: Note[]
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
	onSelectNote: (noteId: string) => void
}) {
	const popoverRef = useRef<HTMLDivElement | null>(null)
	const [position, setPosition] = useState<{
		top: number
		left: number
		side: "left" | "right"
		anchorOffsetY: number
	} | null>(null)
	// Popover dimensions are user-resizable now that the marginalia frame
	// is gone. Drag the bottom-left corner (the corner facing the PDF) to
	// resize; left edge stays anchored to where the popover currently
	// sits, so a wider popover grows further into the PDF rather than
	// pushing into the rail.
	const [size, setSize] = useState<{ width: number; height: number }>(() => defaultPopoverSize())
	const stackedNotes = useMemo(() => [...notes].sort(compareNotesByAnchor), [notes])
	const activeAccentColor =
		dotColorFor(note, colorByBlock, colorByAnnotation) ?? "var(--color-accent-600)"
	const handleJumpToSource = useCallback(() => {
		if (note.paperId && note.anchorAnnotationId) {
			onOpenCitationAnnotation?.(
				note.paperId,
				note.anchorAnnotationId,
				note.anchorPage ?? undefined,
				note.anchorYRatio ?? undefined,
			)
			return
		}
		if (note.paperId && note.anchorBlockId) {
			onOpenCitationBlock?.(note.paperId, note.anchorBlockId)
			return
		}
		onJumpToAnchor?.()
	}, [
		note.paperId,
		note.anchorAnnotationId,
		note.anchorPage,
		note.anchorYRatio,
		note.anchorBlockId,
		onOpenCitationAnnotation,
		onOpenCitationBlock,
		onJumpToAnchor,
	])
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
			const anchorCenterY = rect.top + rect.height / 2
			const top = clamp(
				anchorCenterY - POPOVER_ANCHOR_MARGIN * 2,
				12,
				window.innerHeight - size.height - 12,
			)
			let left = rect.left - size.width - POPOVER_GAP
			let side: "left" | "right" = "left"
			// If we'd run off the left edge (very narrow viewport or rail
			// pinned far left), fall back to the right side of the dot.
			if (left < 12) {
				left = rect.right + POPOVER_GAP
				side = "right"
			}
			setPosition((prev) => {
				const nextOffsetY = clamp(
					anchorCenterY - top,
					POPOVER_ANCHOR_MARGIN,
					size.height - POPOVER_ANCHOR_MARGIN,
				)
				if (
					prev &&
					prev.top === top &&
					prev.left === left &&
					prev.side === side &&
					prev.anchorOffsetY === nextOffsetY
				) {
					return prev
				}
				return {
					top,
					left,
					side,
					anchorOffsetY: nextOffsetY,
				}
			})
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
			<div
				aria-hidden="true"
				className="pointer-events-none absolute"
				style={{
					top: `${position.anchorOffsetY - POPOVER_CONNECTOR_DOT / 2}px`,
					width: `${POPOVER_CONNECTOR_SPAN}px`,
					...(position.side === "left"
						? { left: `${-POPOVER_CONNECTOR_SPAN}px` }
						: { right: `${-POPOVER_CONNECTOR_SPAN}px` }),
				}}
			>
				<div className="relative" style={{ height: `${POPOVER_CONNECTOR_DOT}px`, width: "100%" }}>
					<span
						className="absolute top-1/2 h-px -translate-y-1/2"
						style={{
							backgroundColor: activeAccentColor,
							opacity: 0.58,
							width: `${POPOVER_CONNECTOR_SPAN - POPOVER_CONNECTOR_DOT - 12}px`,
							...(position.side === "left"
								? { right: `${POPOVER_CONNECTOR_DOT}px` }
								: { left: `${POPOVER_CONNECTOR_DOT}px` }),
						}}
					/>
					<span
						className="absolute top-1/2 -translate-y-1/2 rounded-full border-2 border-white"
						style={{
							width: `${POPOVER_CONNECTOR_DOT}px`,
							height: `${POPOVER_CONNECTOR_DOT}px`,
							backgroundColor: activeAccentColor,
							boxShadow: "0 0 0 4px rgba(255,255,255,0.92), 0 6px 16px rgba(15,23,42,0.18)",
							...(position.side === "left" ? { right: 0 } : { left: 0 }),
						}}
					/>
				</div>
			</div>
			<div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-2.5 py-1.5 text-xs text-text-tertiary">
				{onJumpToAnchor || (note.paperId && (note.anchorAnnotationId || note.anchorBlockId)) ? (
					<button
						aria-label="Jump to note anchor"
						className="min-w-0 truncate rounded-md px-1.5 py-1 text-left transition-colors hover:bg-surface-hover hover:text-text-accent"
						onClick={handleJumpToSource}
						title="Jump to this note's anchor in the reader"
						type="button"
					>
						{anchorPage != null ? `Page ${anchorPage}` : "Unanchored"}
						{groupLabel ? ` · ${groupLabel}` : ""}
					</button>
				) : (
					<span className="truncate px-1.5 py-1">
						{anchorPage != null ? `Page ${anchorPage}` : "Unanchored"}
						{groupLabel ? ` · ${groupLabel}` : ""}
					</span>
				)}
				<div className="flex items-center gap-1">
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
			{stackedNotes.length > 1 ? (
				<div className="shrink-0 border-b border-border-subtle bg-bg-primary/55 px-3 py-3">
					<div className="relative space-y-1.5 pl-5">
						<div className="absolute bottom-2 left-[7px] top-2 w-px bg-border-subtle" />
						{stackedNotes.map((candidate) => (
							<SourceStackRow
								active={candidate.id === note.id}
								blockNumber={blockNumber}
								colorByAnnotation={colorByAnnotation}
								colorByBlock={colorByBlock}
								key={candidate.id}
								note={candidate}
								notes={stackedNotes}
								onDelete={onDelete}
								onSelect={onSelectNote}
							/>
						))}
					</div>
				</div>
			) : null}
			<div className="min-h-0 flex-1">
				<NoteEditor
					key={note.id}
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

function SourceStackRow({
	active,
	blockNumber,
	colorByAnnotation,
	colorByBlock,
	note,
	notes,
	onDelete,
	onSelect,
}: {
	active: boolean
	blockNumber: number | null
	colorByAnnotation?: Map<string, string>
	colorByBlock?: Map<string, string>
	note: Note
	notes: Note[]
	onDelete?: (noteId: string) => Promise<void> | void
	onSelect: (noteId: string) => void
}) {
	const label = sourceLabelForNote(note, notes, blockNumber)
	const accentColor = dotColorFor(note, colorByBlock, colorByAnnotation)
	const subtitle =
		note.anchorKind === "block"
			? "block anchor"
			: note.anchorYRatio != null
				? `y ${Math.round(note.anchorYRatio * 100)}%`
				: "inline anchor"
	return (
		<div className="relative">
			<button
				aria-label={label}
				aria-pressed={active}
				className={`group relative block w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
					active
						? "shadow-[0_8px_24px_rgba(15,23,42,0.08)]"
						: "border-border-subtle bg-bg-overlay/72 hover:bg-surface-hover"
				} ${active && onDelete ? "pr-14" : ""}`}
				onClick={() => onSelect(note.id)}
				style={
					active && accentColor
						? {
								borderColor: accentColor,
								backgroundColor: `color-mix(in srgb, ${accentColor} 10%, white)`,
							}
						: undefined
				}
				type="button"
			>
				<span
					aria-hidden="true"
					className={`absolute -left-[18px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2 border-white ${
						active ? "shadow-[0_0_0_4px_rgba(255,255,255,0.92)]" : ""
					}`}
					style={{ backgroundColor: accentColor ?? "var(--color-border-default)" }}
				/>
				<div className="min-w-0">
					<div className="truncate font-mono text-[12px] font-semibold tracking-[-0.01em] text-text-primary">
						{label}
					</div>
					<div
						className="mt-0.5 text-[11px] uppercase tracking-[0.12em] text-text-tertiary"
						style={active && accentColor ? { color: accentColor } : undefined}
					>
						{subtitle}
					</div>
				</div>
			</button>
			{active && onDelete ? (
				<button
					aria-label="Delete note"
					className="absolute right-3 top-1/2 z-[2] flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-border-subtle bg-white/95 text-text-tertiary shadow-[0_8px_22px_rgba(15,23,42,0.12)] transition-colors hover:text-text-error"
					onClick={(event) => {
						event.stopPropagation()
						void onDelete(note.id)
					}}
					title="Delete note"
					type="button"
				>
					<TrashIcon />
				</button>
			) : null}
		</div>
	)
}

function clamp(n: number, lo: number, hi: number) {
	return Math.max(lo, Math.min(hi, n))
}

function TrashIcon() {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="18"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.7"
			viewBox="0 0 24 24"
			width="18"
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
