import type { ReactNode } from "react"
import type { ReaderAnnotation } from "@/api/hooks/reader-annotations"
import {
	READER_ANNOTATION_COLORS,
	annotationBodyBoundingBox,
	distanceBetweenPoints,
	type ReaderAnnotationBody,
	type ReaderAnnotationPoint,
	type ReaderAnnotationTool,
} from "@/lib/reader-annotations"

// Keep highlight bands slim enough to read like a text marker stroke
// rather than a full-line block, even on very short drags / clicks.
const HIGHLIGHT_MIN_H = 0.012
const HIGHLIGHT_MIN_W = 0.01

export function ReaderAnnotationShape({
	annotation,
	flashed,
	H,
	onSelect,
	selected,
	W,
}: {
	annotation: ReaderAnnotation
	flashed?: boolean
	H: number
	onSelect?: (annotationId: string | null) => void
	selected?: boolean
	W: number
}) {
	// SVG viewBox is "0 0 W H" (pixel coordinates). 0..1-stored values
	// are scaled by W or H so 1 SVG unit == 1 CSS pixel — strokes render
	// at consistent pixel widths regardless of line direction.
	const stopAndSelect = {
		onClick: (event: React.MouseEvent) => event.stopPropagation(),
		onPointerDown: (event: React.PointerEvent) => {
			event.stopPropagation()
			event.preventDefault()
			onSelect?.(annotation.id)
		},
	}
	// SMIL pulse used for the citation-jump flash. Mounting the <animate>
	// element re-runs the animation each time `flashed` flips on, so a
	// rapid second click on the same chip restarts the pulse instead of
	// silently ignoring it. We pulse opacity rather than color so it works
	// uniformly across the user's palette colors.
	const flashPulse = flashed ? (
		<animate
			attributeName="opacity"
			begin="0s"
			dur="1.5s"
			fill="freeze"
			repeatCount="1"
			values="1;0.35;1;0.35;1"
		/>
	) : null
	if (annotation.kind === "highlight" && "rect" in annotation.body) {
		const { rect } = annotation.body
		return (
			<rect
				fill={annotation.color}
				fillOpacity={selected ? 0.42 : 0.28}
				height={rect.h * H}
				rx={3}
				ry={3}
				stroke={selected ? annotation.color : "none"}
				strokeOpacity={selected ? 0.95 : undefined}
				strokeWidth={selected ? 1.5 : undefined}
				width={rect.w * W}
				x={rect.x * W}
				y={rect.y * H}
				{...stopAndSelect}
			>
				{flashPulse}
			</rect>
		)
	}
	if (annotation.kind === "underline" && "from" in annotation.body && "to" in annotation.body) {
		const { from, to } = annotation.body
		return (
			<>
				<line
					pointerEvents="none"
					stroke={annotation.color}
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeOpacity={selected ? 1 : 0.95}
					strokeWidth={selected ? 4.5 : 3}
					x1={from.x * W}
					x2={to.x * W}
					y1={from.y * H}
					y2={to.y * H}
				>
					{flashPulse}
				</line>
				<line
					{...stopAndSelect}
					pointerEvents="stroke"
					stroke="transparent"
					strokeWidth={16}
					x1={from.x * W}
					x2={to.x * W}
					y1={from.y * H}
					y2={to.y * H}
				/>
			</>
		)
	}
	if (annotation.kind === "ink" && "points" in annotation.body) {
		const d = pointsToScaledPath(annotation.body.points, W, H)
		return (
			<>
				<path
					d={d}
					fill="none"
					pointerEvents="none"
					stroke={annotation.color}
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeOpacity={selected ? 1 : 0.95}
					strokeWidth={selected ? 4.5 : 3.5}
				>
					{flashPulse}
				</path>
				<path
					{...stopAndSelect}
					d={d}
					fill="none"
					pointerEvents="stroke"
					stroke="transparent"
					strokeWidth={16}
				/>
			</>
		)
	}
	return null
}

function pointsToScaledPath(points: ReaderAnnotationPoint[], W: number, H: number) {
	if (points.length === 0) return ""
	return points
		.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x * W} ${p.y * H}`)
		.join(" ")
}

function annotationBoundingBox(annotation: ReaderAnnotation) {
	return annotationBodyBoundingBox(annotation.kind, annotation.body)
}

export function ReaderAnnotationSelectionOutline({
	annotation,
	H,
	W,
}: {
	annotation: ReaderAnnotation
	H: number
	W: number
}) {
	const bbox = annotationBoundingBox(annotation)
	if (!bbox) return null
	const padX = 0.006
	const padY = 0.008
	const x = Math.max(0, bbox.x - padX) * W
	const y = Math.max(0, bbox.y - padY) * H
	const w = Math.min(1 - Math.max(0, bbox.x - padX), bbox.w + padX * 2) * W
	const h = Math.min(1 - Math.max(0, bbox.y - padY), bbox.h + padY * 2) * H
	return (
		<rect
			fill={annotation.color}
			fillOpacity={0.08}
			height={h}
			pointerEvents="none"
			rx={3}
			ry={3}
			stroke={annotation.color}
			strokeDasharray="6 4"
			strokeOpacity={0.9}
			strokeWidth={1.5}
			width={w}
			x={x}
			y={y}
		/>
	)
}

export function ReaderAnnotationActionsPopover({
	annotation,
	extraActions,
	H,
	onChangeColor,
	onDelete,
	W,
}: {
	annotation: ReaderAnnotation
	extraActions?: ReactNode
	H: number
	onChangeColor: (color: string) => void
	onDelete: () => void
	W: number
}) {
	const bbox = annotationBoundingBox(annotation)
	if (!bbox) return null
	// Anchor above the bbox (or below if too close to the page top), centered.
	const POPOVER_HEIGHT = 36
	const GAP = 8
	const centerX = (bbox.x + bbox.w / 2) * W
	const topAbove = bbox.y * H - POPOVER_HEIGHT - GAP
	const showBelow = topAbove < 0
	const top = showBelow ? (bbox.y + bbox.h) * H + GAP : topAbove
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: presentational; clicks within shouldn't bubble to the SVG and clear selection
		<div
			className="absolute z-[3] -translate-x-1/2 flex items-center gap-1 whitespace-nowrap rounded-md border border-border-subtle bg-bg-overlay/95 px-1.5 py-1 shadow-[var(--shadow-popover)] backdrop-blur"
			onClick={(e) => e.stopPropagation()}
			onMouseDown={(e) => e.stopPropagation()}
			onPointerDown={(e) => e.stopPropagation()}
			style={{ left: `${centerX}px`, top: `${top}px` }}
		>
			{READER_ANNOTATION_COLORS.map((entry) => (
				<button
					aria-label={`Set ${entry.label}`}
					aria-pressed={annotation.color === entry.value}
					className={`h-5 w-5 rounded-full border transition-transform hover:scale-110 ${
						annotation.color === entry.value
							? "border-text-primary ring-2 ring-accent-600/35"
							: "border-border-default"
					}`}
					key={entry.value}
					onClick={() => {
						if (annotation.color !== entry.value) onChangeColor(entry.value)
					}}
					style={{ backgroundColor: entry.value }}
					type="button"
				/>
			))}
			<div className="mx-1 h-4 w-px bg-border-subtle" />
			{extraActions}
			{extraActions ? <div className="mx-1 h-4 w-px bg-border-subtle" /> : null}
			<button
				aria-label="Delete annotation"
				className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-error"
				onClick={onDelete}
				title="Delete"
				type="button"
			>
				<TrashIcon />
			</button>
		</div>
	)
}

export function ReaderAnnotationDraft({
	body,
	color,
	H,
	kind,
	W,
}: {
	body: ReaderAnnotationBody
	color: string
	H: number
	kind: ReaderAnnotationTool
	W: number
}) {
	if (kind === "highlight" && "rect" in body) {
		return (
			<rect
				fill={color}
				fillOpacity={0.22}
				height={body.rect.h * H}
				rx={3}
				ry={3}
				stroke={color}
				strokeDasharray="8 5"
				strokeOpacity={0.65}
				strokeWidth={1.2}
				width={body.rect.w * W}
				x={body.rect.x * W}
				y={body.rect.y * H}
			/>
		)
	}
	if (kind === "underline" && "from" in body && "to" in body) {
		return (
			<line
				stroke={color}
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeOpacity={0.8}
				strokeWidth={3}
				x1={body.from.x * W}
				x2={body.to.x * W}
				y1={body.from.y * H}
				y2={body.to.y * H}
			/>
		)
	}
	if (kind === "ink" && "points" in body) {
		return (
			<path
				d={pointsToScaledPath(body.points, W, H)}
				fill="none"
				stroke={color}
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeOpacity={0.8}
				strokeWidth={3.5}
			/>
		)
	}
	return null
}

export function bodyHasNoVisibleExtent(body: ReaderAnnotationBody) {
	// Reject only true zero-extent shapes (accidental clicks). Highlights are
	// intentionally thin bands; we no longer require a vertical drag.
	if ("rect" in body) return body.rect.w < 0.002 && body.rect.h < 0.002
	if ("from" in body && "to" in body) return distanceBetweenPoints(body.from, body.to) < 0.005
	if ("points" in body) {
		if (body.points.length < 2) return true
		return body.points.every((point) => distanceBetweenPoints(point, body.points[0]!) < 0.005)
	}
	return true
}

// Highlights track a horizontal text drag, so the raw bbox is often
// near-zero in one axis. Inflate to a visible band, clamped to the page.
// Already-large rects pass through unchanged so we don't introduce
// floating-point drift on a normal drag.
export function padHighlightRect(rect: { x: number; y: number; w: number; h: number }) {
	if (rect.w >= HIGHLIGHT_MIN_W && rect.h >= HIGHLIGHT_MIN_H) return rect
	const w = Math.max(rect.w, HIGHLIGHT_MIN_W)
	const h = Math.max(rect.h, HIGHLIGHT_MIN_H)
	const cx = rect.x + rect.w / 2
	const cy = rect.y + rect.h / 2
	const x = Math.max(0, Math.min(1 - w, cx - w / 2))
	const y = Math.max(0, Math.min(1 - h, cy - h / 2))
	return { x, y, w, h }
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
