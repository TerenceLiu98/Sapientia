import {
	memo,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import { useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/api/client"
import type { Note, NoteWithUrl } from "@/api/hooks/notes"
import { NoteEditor, type NoteEditorRef, primeNoteEditorContent } from "@/components/notes/NoteEditor"
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
	// annotationId → 1-based ordinal among the paper's highlights /
	// underlines (per kind). Drives the canonical source label
	// `highlight 1 p. 12 blk. 7`. Optional — when missing the label
	// drops the ordinal.
	annotationOrdinalById?: Map<string, number>
	// annotationId → blockId of the structural block whose bbox the
	// annotation visually overlaps. Lets citation chips inside the
	// editor surface `blk. N` even though annotations don't store a
	// block id.
	annotationBlockIdById?: Map<string, string>
	// noteId → CSS colors of every block / reader-annotation cited in
	// the note's body. A single-color list paints a solid dot; two or
	// more paint a pie-chart conic gradient so the rail communicates
	// "this note pulls from these N highlights" at a glance. Falls
	// back to the anchor color when empty / missing.
	dotColorsByNote?: Map<string, string[]>
	isSidebarCollapsed?: boolean
	onRequestExpandSidebar?: () => void
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
// Nearby note anchors should remain readable as distinct stops on the
// rail. We spread dense clusters vertically, but keep every dot on the
// same horizontal line so the rail reads as a clean single track.
const MIN_DOT_SPACING_FRAC = 0.028
const MINIMAP_FOCUS_STRENGTH = 5
const MINIMAP_NEAR_DOT_SCALE = 1.15
const MINIMAP_FAR_DOT_SCALE = 0.74
const MINIMAP_VIEWPORT_MIN_SPAN_FRAC = 0.06
const SIDEBAR_INSET_X = 4
const SIDEBAR_COLLAPSED_WIDTH = 44
const SLIP_LANE_WIDTH = 188
const RAIL_STRIP_WIDTH = 30
const RAIL_EDGE_RIGHT = 2
const RAIL_EDGE_TOP = 4
const RAIL_EDGE_BOTTOM = 4
const FOLDED_SLIP_HEIGHT = 56
const FOLDED_SLIP_STACK_GAP = 12
const SLIP_DEFAULT_HEIGHT = 520
const SLIP_MIN_HEIGHT = 360
const SLIP_MAX_HEIGHT = 920
const SLIP_DEFAULT_WIDTH = 420
const SLIP_MIN_WIDTH = 360
const SLIP_MAX_WIDTH = 760
const SLIP_VIEWPORT_MARGIN = 72
const SLIP_COMPACT_MIN_WIDTH = 240
const SLIP_COMPACT_MIN_HEIGHT = 260
const SLIP_LANE_INSET_LEFT = 18
// Slip vertical position couples to the PDF's actual scroll position
// (true marginalia: each slip stays near the line that provoked it).
// The parallax factor lets us soften that coupling so slips don't fly
// off-screen instantly. 1.0 = locked to anchor, 0.0 = ignores scroll.
// 0.78 keeps slips near their source while softening the travel enough
// that short PDF scrolls don't feel like the notes are snapping around.
const SLIP_PARALLAX_FACTOR = 0.78
// Half-viewport's worth of fade past the viewport edge before a slip
// fully disappears. 0.5 means a slip fades to 0 when its screen-y is
// half a viewport beyond the visible area. Slips beyond that are
// unmounted entirely.
const SLIP_FADE_TAIL_FRAC = 0.5
const SLIP_OPACITY_RENDER_THRESHOLD = 0.05
const SLIP_EXPANDED_ANCHOR_RIGHT = 18
const SLIP_ANCHOR_LINE_SPAN = 34
// Safety pad between the expanded slip and the lane edges. Prevents the
// slip from sliding under the page header (top) or off the bottom of
// the workspace pane when the anchor is close to a viewport edge.
const SLIP_EXPANDED_EDGE_PAD = 8
const SLIP_ANCHOR_DOT = 14
const PROGRESS_BAR_WIDTH = 8
const PROGRESS_KNOB_WIDTH = 20
const RAIL_DOT_GAP = 10
const RAIL_DOT_CONNECTOR_WIDTH = 16
const RAIL_DOT_CONNECTOR_HEIGHT = 4
const NEUTRAL_DOT_COLOR = "var(--color-neutral-400)"

// Right pane is a two-part marginalia surface: a slip lane for notes
// near the live PDF viewport, plus the thin rail on the outside edge
// that still represents every note in the paper.
//
// `expandedNoteId` is the live expanded slip. We keep expansion fully
// user-driven; page turns merely change which folded slips are surfaced.
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
	annotationOrdinalById,
	annotationBlockIdById,
	dotColorsByNote,
	isSidebarCollapsed = false,
	onRequestExpandSidebar,
	pdfRailLayout,
}: NotesPanelProps) {
	// `externalFollowLockUntil` no longer drives a local scroll lock —
	// the rail is fixed-length, nothing scrolls — but we still surface it
	// to the cite-chip handlers below so cross-pane jumps still chain
	// through the original gating semantics if anything reuses the lock.
	void externalFollowLockUntil
	void currentAnchorYRatio

	// Track the slip-lane's measured height so the expanded slip can
	// clamp itself inside it — without this it can drift up under the
	// page header (or off the bottom of the workspace pane) when the
	// anchor sits near a viewport edge.
	const laneInnerRef = useRef<HTMLDivElement | null>(null)
	const [laneInnerHeight, setLaneInnerHeight] = useState(0)
	const [pendingExpandNoteId, setPendingExpandNoteId] = useState<string | null>(null)
	useEffect(() => {
		const node = laneInnerRef.current
		if (!node) return
		setLaneInnerHeight(node.clientHeight)
		// jsdom doesn't ship ResizeObserver; the height fallback above
		// keeps the slip rendering at its ideal top in tests.
		if (typeof ResizeObserver === "undefined") return
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0]
			if (!entry) return
			setLaneInnerHeight(entry.contentRect.height)
		})
		observer.observe(node)
		return () => {
			observer.disconnect()
		}
	}, [])

	useEffect(() => {
		if (isSidebarCollapsed) setLaneInnerHeight(0)
	}, [isSidebarCollapsed])

	useEffect(() => {
		if (pendingExpandNoteId == null) return
		if (expandedNoteId === pendingExpandNoteId) {
			setPendingExpandNoteId(null)
		}
	}, [expandedNoteId, pendingExpandNoteId])

	useEffect(() => {
		if (isSidebarCollapsed) return
		if (pendingExpandNoteId == null) return
		if (laneInnerHeight <= 0) return
		const frame = window.requestAnimationFrame(() => {
			onExpand(pendingExpandNoteId)
			setPendingExpandNoteId(null)
		})
		return () => {
			window.cancelAnimationFrame(frame)
		}
	}, [isSidebarCollapsed, laneInnerHeight, onExpand, pendingExpandNoteId])

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
			rawTop: number
			focusTop: number
			rightOffset: number
			background: string
			accentColor: string
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
				rawTop: group.rawTop,
				focusTop: group.focusTop,
				rightOffset: 0,
				background: dotBackgroundForColors(colors),
				accentColor: colors[0] ?? NEUTRAL_DOT_COLOR,
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

	// Slips are positioned on a different coordinate system from the rail
	// dots: instead of a normalized 0..1 minimap, each slip's `top` is a
	// pixel y inside the lane that tracks the PDF's actual scroll
	// position. As the user scrolls the document, a slip drifts past the
	// viewport (with a slight parallax lag) and fades out — it doesn't
	// "fold" into a smaller card. The fish-eye / ghost / near-window
	// machinery only powers the rail dots now.
	const laneGroups = useMemo(() => {
		const layout = pdfRailLayout
		const fallbackOnly = !layout || layout.scrollHeight <= 0 || layout.viewportHeight <= 0
		// Without a measured PDF viewport we can't compute parallax-coupled
		// positions. Surface only the expanded slip in that case, parked
		// at a sensible default y, so cite-chip flows and tests still get
		// a rendered editor; the rail dots still navigate as usual.
		if (fallbackOnly) {
			const expandedGroupOnly = groupedDots.find((group) =>
				group.notes.some((note) => note.id === expandedNoteId),
			)
			if (!expandedGroupOnly) return []
			return [
				{
					groupKey: expandedGroupOnly.groupKey,
					blockId: expandedGroupOnly.blockId,
					notes: expandedGroupOnly.notes,
					page: expandedGroupOnly.page,
					expanded: true,
					topPx: SLIP_DEFAULT_HEIGHT / 2 + 24,
					opacity: 1,
					accentColor: expandedGroupOnly.accentColor,
				},
			]
		}
		const viewportTop = layout.scrollTop
		const viewportHeight = layout.viewportHeight
		const laneHeight = laneInnerHeight > 0 ? laneInnerHeight : viewportHeight
		const viewportCenter = viewportTop + viewportHeight / 2
		const halfH = viewportHeight / 2
		const placed: Array<{
			groupKey: string
			blockId: string | null
			notes: Note[]
			page: number
			expanded: boolean
			topPx: number
			opacity: number
			accentColor: string
		}> = []
		for (const group of groupedDots) {
			const expanded = group.notes.some((note) => note.id === expandedNoteId)
			const pageMetric = layout.pageMetrics.get(group.page)
			const anchorAbsolute = pageMetric
				? pageMetric.top + (group.notes[0]?.anchorYRatio ?? group.focusTop) * pageMetric.height
				: layout.scrollHeight * group.focusTop
			// Keep folded and expanded slips on the same vertical baseline so
			// opening a note doesn't "jump" up/down relative to its rail dot.
			// The only change on open should be size/interaction, not anchor-y.
			const offsetFromCenter = anchorAbsolute - viewportCenter
			const slipScreenY = halfH + offsetFromCenter * SLIP_PARALLAX_FACTOR
			const opacity = expanded
				? 1
				: foldedSlipOpacityForLane(slipScreenY, laneHeight, viewportHeight)
			if (opacity < SLIP_OPACITY_RENDER_THRESHOLD && !expanded) continue
			placed.push({
				groupKey: group.groupKey,
				blockId: group.blockId,
				notes: group.notes,
				page: group.page,
				expanded,
				topPx: slipScreenY,
				opacity,
				accentColor: group.accentColor,
			})
		}
		// Spread overlapping slips vertically — distinct anchors at nearly
		// the same y still need clickable lanes. Skip the expanded slip
		// because we want it locked to its computed top.
		placed.sort((a, b) => a.topPx - b.topPx)
		const foldedIndices: number[] = []
		const foldedTops: number[] = []
		for (let i = 0; i < placed.length; i += 1) {
			const entry = placed[i]
			if (entry.expanded) continue
			foldedIndices.push(i)
			foldedTops.push(entry.topPx)
		}
		const adjustedTops = spreadTopsWithSpacingPx(
			foldedTops,
			FOLDED_SLIP_HEIGHT + FOLDED_SLIP_STACK_GAP,
			FOLDED_SLIP_HEIGHT / 2 + SLIP_EXPANDED_EDGE_PAD,
			Math.max(
				FOLDED_SLIP_HEIGHT / 2 + SLIP_EXPANDED_EDGE_PAD,
				laneHeight - FOLDED_SLIP_HEIGHT / 2 - SLIP_EXPANDED_EDGE_PAD,
			),
		)
		for (let n = 0; n < foldedIndices.length; n += 1) {
			const idx = foldedIndices[n] as number
			placed[idx] = { ...placed[idx], topPx: adjustedTops[n] ?? placed[idx].topPx } as (typeof placed)[number]
		}
		return placed
	}, [expandedNoteId, groupedDots, laneInnerHeight, pdfRailLayout])

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
		) => {
			const targetNoteId = group.notes[0]?.id ?? null
			const isGroupExpanded = group.notes.some((note) => note.id === expandedNoteId)
			if (isSidebarCollapsed) {
				onRequestExpandSidebar?.()
				if (!isGroupExpanded) setPendingExpandNoteId(targetNoteId)
				return
			}
			if (isGroupExpanded) {
				onExpand(null)
				return
			}
			onExpand(targetNoteId)
		},
		[expandedNoteId, isSidebarCollapsed, onExpand, onRequestExpandSidebar],
	)

	const handleCloseExpandedSlip = useCallback(() => {
		onExpand(null)
	}, [onExpand])

	const handleSelectGroupedNote = useCallback(
		(noteId: string) => {
			onExpand(noteId)
		},
		[onExpand],
	)

	// Note creation still lives elsewhere; the lane is strictly for
	// navigating and editing existing anchored notes.
	void onCreateAtCurrent

	const expandedSidebarWidth = SLIP_LANE_WIDTH + RAIL_STRIP_WIDTH + SIDEBAR_INSET_X * 2

	return (
		<aside
			aria-label="Marginalia sidebar"
			className="relative h-full shrink-0 overflow-visible transition-[width] duration-200"
			data-sidebar-collapsed={isSidebarCollapsed ? "true" : "false"}
			style={{ width: `${isSidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : expandedSidebarWidth}px` }}
		>
			<div className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-border-subtle/80 to-transparent" />
			<div className="relative flex h-full overflow-visible">
				<div
					className="absolute inset-y-0 right-0 flex overflow-visible pb-[4px] pt-[4px]"
					style={{ left: `${SIDEBAR_INSET_X}px` }}
				>
					<div className="relative flex h-full overflow-visible">
						{isSidebarCollapsed ? null : (
				<div
					className="relative h-full overflow-visible bg-[linear-gradient(to_right,color-mix(in_srgb,var(--color-bg-primary)_62%,var(--color-bg-secondary)_38%),var(--color-bg-secondary))]"
					style={{ width: `${SLIP_LANE_WIDTH}px` }}
				>
					<div className="absolute inset-x-0 inset-y-6 overflow-visible" ref={laneInnerRef}>
						{laneGroups.map((group) => {
							const isExpanded = group.expanded
							const note = isExpanded
								? (group.notes.find((candidate) => candidate.id === expandedNoteId) ?? group.notes[0] ?? null)
								: group.notes[0] ?? null
							if (!note) return null
							return isExpanded ? (
								<ExpandedSlip
									key={group.groupKey}
									anchorPage={expandedAnchorPage}
									annotationBlockIdById={annotationBlockIdById}
									annotationOrdinalById={annotationOrdinalById}
									blockNumber={
										group.blockId ? (blockNumberByBlockId?.get(group.blockId) ?? null) : null
									}
									blockNumberByBlockId={blockNumberByBlockId}
									colorByAnnotation={colorByAnnotation}
									colorByBlock={colorByBlock}
									groupLabel={groupLabelForPopover(group.notes, group.blockId, blockNumberByBlockId)}
									note={note}
									notes={group.notes}
									onClose={handleCloseExpandedSlip}
									onDelete={onDelete}
									onEditorReady={onEditorReady}
									onJumpToAnchor={
										expandedAnchorPage != null
											? () => onJumpToPage(expandedAnchorPage, note.anchorYRatio ?? undefined)
											: undefined
									}
									onOpenCitationAnnotation={handleOpenCitationAnnotation}
									onOpenCitationBlock={handleOpenCitationBlock}
									onSelectNote={handleSelectGroupedNote}
									laneAvailableHeight={laneInnerHeight}
									topPx={group.topPx}
								/>
							) : (
								<FoldedSlip
									accentColor={group.accentColor}
									active={group.notes.some((candidate) => candidate.id === expandedNoteId)}
									annotationOrdinal={
										note.anchorAnnotationId
											? (annotationOrdinalById?.get(note.anchorAnnotationId) ?? null)
											: null
									}
									blockNumber={
										group.blockId ? (blockNumberByBlockId?.get(group.blockId) ?? null) : null
									}
									group={group}
									key={group.groupKey}
									note={note}
									onOpen={() => handleDotClick(group)}
									opacity={group.opacity}
									topPx={group.topPx}
								/>
							)
						})}
					</div>
				</div>
						)}
				<div
					className="relative h-full shrink-0"
					style={{ width: `${RAIL_STRIP_WIDTH}px` }}
				>
					<div
						className="absolute left-0"
						style={{
							top: `${RAIL_EDGE_TOP}px`,
							bottom: `${RAIL_EDGE_BOTTOM}px`,
							right: `${RAIL_EDGE_RIGHT}px`,
						}}
					>
						{/* Progress groove — the paper's full reading span. */}
						<div
							aria-hidden="true"
							className="pointer-events-none absolute top-0 bottom-0 right-0 rounded-full bg-border-subtle/85"
							style={{ width: `${PROGRESS_BAR_WIDTH}px` }}
						/>
						{/* Progress fill — everything above the current anchor
							is "read"/traversed, so the bar fills from the top
							down to `progressFrac`. */}
						<div
							aria-hidden="true"
							className="pointer-events-none absolute right-0 top-0 rounded-full bg-text-secondary/36 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.28)]"
							style={{
								width: `${PROGRESS_BAR_WIDTH}px`,
								height: `${progressFrac * 100}%`,
							}}
						/>
						{/* Viewport window — kept as a secondary affordance so
							you can still sense the visible slice, but it's now
							a light sleeve over the progress bar rather than the
							main bar metaphor. */}
						<div
							aria-hidden="true"
							className="pointer-events-none absolute rounded-full border border-text-tertiary/22 bg-white/28 backdrop-blur-[1px]"
							style={{
								top: `${viewportWindow.top * 100}%`,
								right: "-3px",
								width: `${PROGRESS_BAR_WIDTH + 6}px`,
								height: `${Math.max(8, (viewportWindow.bottom - viewportWindow.top) * 100)}%`,
							}}
						/>
						{/* Accent pin marking the precise (page, yRatio) the
							reader is anchored to. Sits on the inner side of the
							bar so it doesn't collide with the dots. */}
						<div
							aria-hidden="true"
							className="pointer-events-none absolute rounded-sm bg-text-secondary/80"
							style={{
								top: `calc(${progressFrac * 100}% - 1px)`,
								right: `${PROGRESS_BAR_WIDTH}px`,
								width: `${PROGRESS_KNOB_WIDTH / 2}px`,
								height: `3px`,
							}}
						/>
						{groupedDots.map((placed) => (
							<DotButton
								key={placed.groupKey}
								active={placed.notes.some((note) => note.id === expandedNoteId)}
								background={placed.background}
								connectorColor={placed.accentColor}
								groupKey={placed.groupKey}
								isCitingSelectedBlock={placed.notes.some((note) => activeCitingNoteIds.has(note.id))}
								isCurrentPage={placed.page === currentPage}
								onClick={() => handleDotClick(placed)}
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
				</div>
					</div>
				</div>
			</div>
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

function tooltipFor(
	note: Note,
	blockNumberByBlockId?: Map<string, number>,
	annotationOrdinalById?: Map<string, number>,
): string {
	const parts: string[] = []
	if (note.title) parts.push(note.title)
	const blockNumber = note.anchorBlockId ? (blockNumberByBlockId?.get(note.anchorBlockId) ?? null) : null
	const annotationOrdinal = note.anchorAnnotationId
		? (annotationOrdinalById?.get(note.anchorAnnotationId) ?? null)
		: null
	const meta = formatSourceLabel({
		kind: note.anchorKind,
		page: note.anchorPage,
		blockNumber,
		annotationOrdinal,
	})
	if (meta && meta !== "Untitled") parts.push(meta)
	return parts.join(" — ")
}

function tooltipForGroup(
	notes: Note[],
	page: number,
	blockId: string | null,
	blockNumberByBlockId?: Map<string, number>,
	annotationOrdinalById?: Map<string, number>,
): string {
	if (notes.length === 1) return tooltipFor(notes[0], blockNumberByBlockId, annotationOrdinalById)
	const blockTag = blockLabelFor(blockId, blockNumberByBlockId)
	const parts = [blockTag, `p. ${page}`, `${notes.length} notes`].filter(Boolean)
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
	if (!blockId) return null
	const n = blockNumberByBlockId?.get(blockId)
	return n ? `block ${n}` : "block"
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

// Canonical source label, shared across slip kicker tags, dot tooltips,
// and the popover crumb so reader sees one consistent identifier:
//   highlight 1 p. 12 blk. 7
//   underline 3 p. 4 blk. 9
//   block 12
//   block 12 note 2  (multiple notes anchored to the same block)
//
// `annotationOrdinal` is paper-wide for highlight/underline (the user's
// spec — "highlight 1" is the first highlight in the paper, not within a
// group). When the ordinal isn't available we drop the number rather
// than make one up from group-local position.
function formatSourceLabel(args: {
	kind: Note["anchorKind"]
	page: number | null
	blockNumber: number | null
	annotationOrdinal: number | null
	noteIndexInBlockGroup?: number | null
}): string {
	const { kind, page, blockNumber, annotationOrdinal, noteIndexInBlockGroup } = args
	if (kind === "highlight" || kind === "underline") {
		const ordinal = annotationOrdinal != null && annotationOrdinal > 0 ? ` ${annotationOrdinal}` : ""
		const parts = [`${kind}${ordinal}`]
		if (page) parts.push(`p. ${page}`)
		if (blockNumber) parts.push(`blk. ${blockNumber}`)
		return parts.join(" ")
	}
	// Block-anchored or page-only.
	if (blockNumber) {
		const base = `block ${blockNumber}`
		if (noteIndexInBlockGroup != null && noteIndexInBlockGroup > 0) {
			return `${base} note ${noteIndexInBlockGroup}`
		}
		return base
	}
	if (page) return `p. ${page}`
	return "Untitled"
}

function sourceLabelForNote(
	note: Note,
	notes: Note[],
	blockNumber: number | null,
	annotationOrdinal: number | null = null,
) {
	if (note.anchorKind === "block") {
		const blockNotes = notes
			.filter((candidate) => candidate.anchorKind === "block")
			.sort(compareNotesByAnchor)
		const noteIndex =
			blockNotes.length > 1
				? blockNotes.findIndex((candidate) => candidate.id === note.id) + 1
				: null
		return formatSourceLabel({
			kind: "block",
			page: note.anchorPage,
			blockNumber,
			annotationOrdinal: null,
			noteIndexInBlockGroup: noteIndex,
		})
	}
	return formatSourceLabel({
		kind: note.anchorKind,
		page: note.anchorPage,
		blockNumber,
		annotationOrdinal,
	})
}

function slipSourceTagLabel(
	note: Note,
	notes: Note[],
	blockNumber: number | null,
	annotationOrdinal: number | null,
) {
	const label = sourceLabelForNote(note, notes, blockNumber, annotationOrdinal)
	if (label === "Untitled") {
		return note.anchorPage ? `p. ${note.anchorPage}` : "anchor"
	}
	return label
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
	return spreadTopsWithSpacing(rawTops, MIN_DOT_SPACING_FRAC)
}

// Pixel-space variant of `spreadTopsWithSpacing`. Slips that share a
// near-identical PDF anchor will end up at near-identical screen y in
// parallax mode; this nudges later entries down so each slip remains
// individually clickable. Order in / order out is preserved (callers
// rely on it to map back to the original list).
function spreadTopsWithSpacingPx(
	rawTops: number[],
	minSpacingPx: number,
	minTopPx = Number.NEGATIVE_INFINITY,
	maxTopPx = Number.POSITIVE_INFINITY,
) {
	if (rawTops.length === 0) return rawTops
	const tops = [...rawTops]
	for (let i = 1; i < tops.length; i += 1) {
		tops[i] = Math.max(tops[i] as number, (tops[i - 1] as number) + minSpacingPx)
	}
	if (tops[tops.length - 1]! > maxTopPx) {
		tops[tops.length - 1] = maxTopPx
		for (let i = tops.length - 2; i >= 0; i -= 1) {
			tops[i] = Math.min(tops[i] as number, (tops[i + 1] as number) - minSpacingPx)
		}
	}
	if (tops[0]! < minTopPx) {
		tops[0] = minTopPx
		for (let i = 1; i < tops.length; i += 1) {
			tops[i] = Math.max(tops[i] as number, (tops[i - 1] as number) + minSpacingPx)
		}
	}
	for (let i = 0; i < tops.length; i += 1) {
		tops[i] = clamp(tops[i] as number, minTopPx, maxTopPx)
	}
	return tops
}

function spreadTopsWithSpacing(rawTops: number[], minSpacingFrac: number) {
	if (rawTops.length === 0) return rawTops
	const tops = [...rawTops]
	for (let i = 1; i < tops.length; i += 1) {
		tops[i] = Math.max(tops[i], tops[i - 1]! + minSpacingFrac)
	}
	const maxTop = 1
	if (tops[tops.length - 1]! > maxTop) {
		tops[tops.length - 1] = maxTop
		for (let i = tops.length - 2; i >= 0; i -= 1) {
			tops[i] = Math.min(tops[i]!, tops[i + 1]! - minSpacingFrac)
		}
	}
	for (let i = 0; i < tops.length; i += 1) {
		tops[i] = clamp(tops[i]!, 0, 1)
	}
	return tops
}

function foldedSlipOpacityForLane(centerY: number, laneHeight: number, viewportHeight: number) {
	const minCenter = FOLDED_SLIP_HEIGHT / 2 + SLIP_EXPANDED_EDGE_PAD
	const maxCenter = Math.max(
		minCenter,
		laneHeight - FOLDED_SLIP_HEIGHT / 2 - SLIP_EXPANDED_EDGE_PAD,
	)
	const fadeTailPx = Math.max(
		FOLDED_SLIP_HEIGHT * 0.7,
		viewportHeight * Math.max(0.18, SLIP_FADE_TAIL_FRAC * 0.4),
	)
	if (centerY < minCenter) {
		return clamp(1 - (minCenter - centerY) / fadeTailPx, 0, 1)
	}
	if (centerY > maxCenter) {
		return clamp(1 - (centerY - maxCenter) / fadeTailPx, 0, 1)
	}
	return 1
}

function defaultSlipSize() {
	const widthBounds = slipWidthBounds()
	const heightBounds = slipHeightBounds()
	if (typeof window === "undefined") {
		return {
			width: clamp(SLIP_DEFAULT_WIDTH, widthBounds.min, widthBounds.max),
			height: clamp(SLIP_DEFAULT_HEIGHT, heightBounds.min, heightBounds.max),
		}
	}
	return {
		width: clamp(
			Math.round(window.innerWidth * 0.31),
			widthBounds.min,
			widthBounds.max,
		),
		height: clamp(
			Math.round(window.innerHeight * 0.66),
			heightBounds.min,
			heightBounds.max,
		),
	}
}

function slipWidthBounds() {
	if (typeof window === "undefined") {
		return { min: SLIP_MIN_WIDTH, max: SLIP_MAX_WIDTH }
	}
	const max = Math.min(
		SLIP_MAX_WIDTH,
		Math.max(SLIP_COMPACT_MIN_WIDTH, window.innerWidth - SLIP_VIEWPORT_MARGIN),
	)
	return {
		min: Math.min(SLIP_MIN_WIDTH, max),
		max,
	}
}

function slipHeightBounds() {
	if (typeof window === "undefined") {
		return { min: SLIP_MIN_HEIGHT, max: SLIP_MAX_HEIGHT }
	}
	const max = Math.min(
		SLIP_MAX_HEIGHT,
		Math.max(SLIP_COMPACT_MIN_HEIGHT, window.innerHeight - SLIP_VIEWPORT_MARGIN),
	)
	return {
		min: Math.min(SLIP_MIN_HEIGHT, max),
		max,
	}
}

const DotButton = memo(function DotButton({
	active,
	background,
	connectorColor,
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
	connectorColor: string
	groupKey: string
	isCitingSelectedBlock: boolean
	isCurrentPage: boolean
	onClick: () => void
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
	const connectorOpacity = active ? 0.7 : isCitingSelectedBlock ? 0.58 : 0.34
	const connectorOverlap = Math.max(2, radius * 0.16)
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
				onClick()
			}}
			style={{
				top: `calc(${topPercent}% - ${radius}px)`,
				right: `${PROGRESS_BAR_WIDTH + RAIL_DOT_GAP + rightOffset}px`,
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
			<span
				aria-hidden="true"
				className="pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-full"
				style={{
					left: `calc(100% - ${connectorOverlap.toFixed(2)}px)`,
					width: `${RAIL_DOT_CONNECTOR_WIDTH}px`,
					height: `${RAIL_DOT_CONNECTOR_HEIGHT}px`,
					backgroundColor: connectorColor,
					opacity: connectorOpacity,
					boxShadow: "0 0 0 1px rgba(255,255,255,0.9)",
				}}
			/>
			{/* Hidden text so screen readers + tests can match by note title.
				The visible affordance is the colored dot. */}
			<span className="sr-only">{srLabel}</span>
			{isCitingSelectedBlock ? <span className="sr-only">Linked</span> : null}
		</button>
	)
})

function FoldedSlip({
	accentColor,
	active,
	annotationOrdinal,
	blockNumber,
	group,
	note,
	onOpen,
	opacity,
	topPx,
}: {
	accentColor: string
	active: boolean
	annotationOrdinal: number | null
	blockNumber: number | null
	group: {
		groupKey: string
		notes: Note[]
		page: number
	}
	note: Note
	onOpen: () => void
	opacity: number
	topPx: number
}) {
	const sourceTagLabel = slipSourceTagLabel(note, group.notes, blockNumber, annotationOrdinal)
	const effectiveOpacity = active ? Math.max(opacity, 0.92) : opacity
	return (
		<button
			aria-label={`Open note ${note.title || "Untitled"}`}
			className="absolute z-[2] overflow-hidden rounded-2xl border border-border-default/80 bg-white/96 text-left shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition-[top,transform,box-shadow,opacity,border-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[top,transform,opacity] hover:-translate-x-0.5 hover:shadow-[0_16px_28px_rgba(15,23,42,0.12)]"
			data-slip-group-key={group.groupKey}
			onClick={onOpen}
			style={{
				left: `${SLIP_LANE_INSET_LEFT}px`,
				top: `${topPx - FOLDED_SLIP_HEIGHT / 2}px`,
				height: `${FOLDED_SLIP_HEIGHT}px`,
				maxWidth: "188px",
				borderLeft: `3px solid ${accentColor}`,
				opacity: effectiveOpacity,
			}}
			type="button"
		>
			<div className="flex h-full items-center px-3 py-2">
				<div className="flex items-center gap-1.5">
					<span
						className="inline-flex items-center rounded-md px-2.5 py-1.5 text-[11px] font-bold tracking-[0.01em]"
						style={{
							color: `color-mix(in srgb, ${accentColor} 62%, var(--color-text-primary))`,
							backgroundColor: `color-mix(in srgb, ${accentColor} 9%, white)`,
							boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accentColor} 22%, white)`,
						}}
					>
						{sourceTagLabel}
					</span>
					{group.notes.length > 1 ? (
						<span className="inline-flex items-center rounded-md bg-bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-text-tertiary">
							{`+${group.notes.length - 1}`}
						</span>
					) : null}
				</div>
			</div>
		</button>
	)
}

function ExpandedSlip({
	anchorPage,
	annotationBlockIdById,
	annotationOrdinalById,
	blockNumber,
	blockNumberByBlockId,
	colorByAnnotation,
	colorByBlock,
	groupLabel,
	laneAvailableHeight,
	note,
	notes,
	onClose,
	onDelete,
	onEditorReady,
	onJumpToAnchor,
	onOpenCitationBlock,
	onOpenCitationAnnotation,
	onSelectNote,
	topPx,
}: {
	anchorPage: number | null
	annotationBlockIdById?: Map<string, string>
	annotationOrdinalById?: Map<string, number>
	blockNumber: number | null
	blockNumberByBlockId?: Map<string, number>
	colorByAnnotation?: Map<string, string>
	colorByBlock?: Map<string, string>
	groupLabel: string
	// Measured height of the lane container (after inset-y-6 padding).
	// Used to clamp the slip's vertical position so it never slides under
	// the workspace's top chrome or off the bottom of the pane.
	laneAvailableHeight: number
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
	topPx: number
}) {
	let queryClient: ReturnType<typeof useQueryClient> | null = null
	try {
		queryClient = useQueryClient()
	} catch {
		queryClient = null
	}
	const [size, setSize] = useState<{ width: number; height: number }>(() => defaultSlipSize())
	const [entered, setEntered] = useState(false)
	const [viewportSize, setViewportSize] = useState(() => ({
		width: typeof window === "undefined" ? 0 : window.innerWidth,
		height: typeof window === "undefined" ? 0 : window.innerHeight,
	}))
	const stackedNotes = useMemo(() => [...notes].sort(compareNotesByAnchor), [notes])
	const activeAccentColor =
		dotColorFor(note, colorByBlock, colorByAnnotation) ?? "var(--color-accent-600)"
	const widthBounds = useMemo(
		() => ({
			min: Math.min(SLIP_MIN_WIDTH, Math.max(SLIP_COMPACT_MIN_WIDTH, viewportSize.width - SLIP_VIEWPORT_MARGIN)),
			max: Math.min(SLIP_MAX_WIDTH, Math.max(SLIP_COMPACT_MIN_WIDTH, viewportSize.width - SLIP_VIEWPORT_MARGIN)),
		}),
		[viewportSize.width],
	)
	const heightBounds = useMemo(
		() => ({
			min: Math.min(
				SLIP_MIN_HEIGHT,
				Math.max(SLIP_COMPACT_MIN_HEIGHT, viewportSize.height - SLIP_VIEWPORT_MARGIN),
			),
			max: Math.min(
				SLIP_MAX_HEIGHT,
				Math.max(SLIP_COMPACT_MIN_HEIGHT, viewportSize.height - SLIP_VIEWPORT_MARGIN),
			),
		}),
		[viewportSize.height],
	)
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
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose()
		}
		window.addEventListener("keydown", onKeyDown)
		return () => {
			window.removeEventListener("keydown", onKeyDown)
		}
	}, [onClose])

	useEffect(() => {
		if (typeof window === "undefined") return
		const updateViewportSize = () =>
			setViewportSize({ width: window.innerWidth, height: window.innerHeight })
		updateViewportSize()
		window.addEventListener("resize", updateViewportSize)
		return () => {
			window.removeEventListener("resize", updateViewportSize)
		}
	}, [])

	useEffect(() => {
		if (!queryClient) return
		for (const candidate of stackedNotes) {
			void queryClient
				.ensureQueryData<NoteWithUrl>({
					queryKey: ["note", candidate.id],
					queryFn: () => apiFetch<NoteWithUrl>(`/api/v1/notes/${candidate.id}`),
				})
				.then((resolved) => primeNoteEditorContent(resolved.id, resolved.jsonUrl))
				.catch(() => undefined)
		}
	}, [queryClient, stackedNotes])

	useEffect(() => {
		setEntered(false)
		if (typeof window === "undefined") {
			setEntered(true)
			return
		}
		const frame = window.requestAnimationFrame(() => {
			setEntered(true)
		})
		return () => {
			window.cancelAnimationFrame(frame)
		}
	}, [])

	useEffect(() => {
		setSize((current) => ({
			width: clamp(current.width, widthBounds.min, widthBounds.max),
			height: clamp(current.height, heightBounds.min, heightBounds.max),
		}))
	}, [heightBounds.max, heightBounds.min, widthBounds.max, widthBounds.min])

	// Resize from the bottom-left so the expanded editor grows toward the
	// PDF while its right edge stays anchored to the rail.
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
				width: clamp(drag.startWidth - dx, widthBounds.min, widthBounds.max),
				height: clamp(drag.startHeight + dy, heightBounds.min, heightBounds.max),
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
	}, [heightBounds.max, heightBounds.min, widthBounds.max, widthBounds.min])

	// `topPx` is the slip's anchor-y inside the lane (PDF-coupled). We
	// center the editor on it, then clamp against the lane's measured
	// height so the top edge stays clear of the page header and the
	// bottom edge stays inside the workspace pane.
	const idealTop = topPx - size.height / 2
	const minTop = SLIP_EXPANDED_EDGE_PAD
	const maxTop =
		laneAvailableHeight > 0
			? Math.max(minTop, laneAvailableHeight - size.height - SLIP_EXPANDED_EDGE_PAD)
			: idealTop
	const clampedTop = Math.min(Math.max(idealTop, minTop), maxTop)

	return (
		<div
			className="absolute z-[4] flex flex-col overflow-hidden rounded-[18px] border border-border-default bg-bg-overlay shadow-[0_24px_64px_rgba(15,23,42,0.18)] transition-[top,transform,opacity,box-shadow] duration-220 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[top,transform,opacity]"
			data-expanded-slip-id={note.id}
			style={{
				top: `${clampedTop}px`,
				right: `${SLIP_EXPANDED_ANCHOR_RIGHT}px`,
				width: `${size.width}px`,
				height: `${size.height}px`,
				borderLeft: `3px solid ${activeAccentColor}`,
				opacity: entered ? 1 : 0,
				transform: entered ? "translate3d(0, 0, 0) scale(1)" : "translate3d(18px, 0, 0) scale(0.965)",
			}}
		>
			<div
				aria-hidden="true"
				className="pointer-events-none absolute right-[-34px] top-1/2 -translate-y-1/2"
				style={{
					width: `${SLIP_ANCHOR_LINE_SPAN}px`,
				}}
			>
				<div className="relative" style={{ height: `${SLIP_ANCHOR_DOT}px`, width: "100%" }}>
					<span
						className="absolute top-1/2 h-px -translate-y-1/2"
						style={{
							backgroundColor: activeAccentColor,
							opacity: 0.58,
							left: 0,
							width: `${SLIP_ANCHOR_LINE_SPAN - SLIP_ANCHOR_DOT}px`,
						}}
					/>
					<span
						className="absolute right-0 top-1/2 -translate-y-1/2 rounded-full border-2 border-white"
						style={{
							width: `${SLIP_ANCHOR_DOT}px`,
							height: `${SLIP_ANCHOR_DOT}px`,
							backgroundColor: activeAccentColor,
							boxShadow: "0 0 0 4px rgba(255,255,255,0.92), 0 6px 16px rgba(15,23,42,0.18)",
						}}
					/>
				</div>
			</div>
			<div className="flex shrink-0 items-center justify-between border-b border-border-subtle bg-bg-primary/60 px-2.5 py-1.5 text-xs text-text-tertiary">
				<span className="truncate px-1.5 py-1">
					{anchorPage != null ? `Page ${anchorPage}` : "Unanchored"}
					{groupLabel ? ` · ${groupLabel}` : ""}
				</span>
				<div className="flex items-center gap-1">
					{onJumpToAnchor || (note.paperId && (note.anchorAnnotationId || note.anchorBlockId)) ? (
						<button
							aria-label="Jump to note anchor"
							className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-accent"
							onClick={handleJumpToSource}
							title="Jump to this note's anchor in the reader"
							type="button"
						>
							<JumpToSourceIcon />
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
					beforeEditorContent={
						stackedNotes.length > 0 ? (
							<div className="border-b border-border-subtle bg-bg-primary/55 px-3 py-3">
								<div className="relative space-y-1.5 pl-5">
									<div className="absolute bottom-2 left-[7px] top-2 w-px bg-border-subtle" />
									{stackedNotes.map((candidate) => (
										<SourceStackRow
											active={candidate.id === note.id}
											annotationOrdinalById={annotationOrdinalById}
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
						) : null
					}
					annotationBlockIdById={annotationBlockIdById}
					annotationOrdinalById={annotationOrdinalById}
					blockNumberByBlockId={blockNumberByBlockId}
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
		</div>
	)
}

function SourceStackRow({
	active,
	annotationOrdinalById,
	blockNumber,
	colorByAnnotation,
	colorByBlock,
	note,
	notes,
	onDelete,
	onSelect,
}: {
	active: boolean
	annotationOrdinalById?: Map<string, number>
	blockNumber: number | null
	colorByAnnotation?: Map<string, string>
	colorByBlock?: Map<string, string>
	note: Note
	notes: Note[]
	onDelete?: (noteId: string) => Promise<void> | void
	onSelect: (noteId: string) => void
}) {
	const annotationOrdinal = note.anchorAnnotationId
		? (annotationOrdinalById?.get(note.anchorAnnotationId) ?? null)
		: null
	const label = sourceLabelForNote(note, notes, blockNumber, annotationOrdinal)
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

function JumpToSourceIcon() {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="15"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.8"
			viewBox="0 0 24 24"
			width="15"
		>
			<path d="M7 17 17 7" />
			<path d="M9 7h8v8" />
		</svg>
	)
}
