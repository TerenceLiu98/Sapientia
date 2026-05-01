import type { ReactNode } from "react"
import type { ReaderAnnotation } from "@/api/hooks/reader-annotations"
import {
	READER_ANNOTATION_COLORS,
	annotationBodyBoundingBox,
	type ReaderAnnotationRect,
} from "@/lib/reader-annotations"

export function ReaderAnnotationShape({
	annotation,
	flashed,
	H,
	selected,
	W,
}: {
	annotation: ReaderAnnotation
	flashed?: boolean
	H: number
	selected?: boolean
	W: number
}) {
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
	// Ghost variant: the annotation is soft-deleted (a note still cites
	// it). We render a much fainter dashed outline so the user sees
	// "something used to live here" but it doesn't visually compete with
	// live markup. Selection still works so the popover can offer Restore.
	const isGhost = annotation.deletedAt != null
	return annotation.kind === "highlight" ? (
		<>
			{annotation.body.rects.map((rect, index) => (
				<ReaderTextHighlightRect
					color={annotation.color}
					flashed={flashPulse}
					height={H}
					isGhost={isGhost}
					key={`${annotation.id}-rect-${index}`}
					rect={rect}
					selected={selected}
					width={W}
				/>
			))}
		</>
	) : (
		<>
			{annotation.body.rects.map((rect, index) => (
				<ReaderTextUnderline
					color={annotation.color}
					flashed={flashPulse}
					height={H}
					isGhost={isGhost}
					key={`${annotation.id}-line-${index}`}
					rect={rect}
					selected={selected}
					width={W}
				/>
			))}
		</>
	)
}

function ReaderTextHighlightRect({
	color,
	flashed,
	height,
	isGhost,
	rect,
	selected,
	width,
}: {
	color: string
	flashed: React.ReactNode
	height: number
	isGhost: boolean
	rect: ReaderAnnotationRect
	selected?: boolean
	width: number
}) {
	const box = tightenHighlightBox(rect, width, height)
	if (isGhost) {
		return (
			<rect
				fill={color}
				fillOpacity={selected ? 0.18 : 0.07}
				height={box.h}
				rx={2}
				ry={2}
				stroke={color}
				strokeDasharray="4 3"
				strokeOpacity={selected ? 0.85 : 0.5}
				strokeWidth={selected ? 1.5 : 1}
				width={box.w}
				x={box.x}
				y={box.y}
			>
				{flashed}
			</rect>
		)
	}
	return (
		<rect
			fill={color}
			fillOpacity={selected ? 0.42 : 0.28}
			height={box.h}
			rx={2}
			ry={2}
			stroke={selected ? color : "none"}
			strokeOpacity={selected ? 0.95 : undefined}
			strokeWidth={selected ? 1.5 : undefined}
			width={box.w}
			x={box.x}
			y={box.y}
		>
			{flashed}
		</rect>
	)
}

function ReaderTextUnderline({
	color,
	flashed,
	height,
	isGhost,
	rect,
	selected,
	width,
}: {
	color: string
	flashed: React.ReactNode
	height: number
	isGhost: boolean
	rect: ReaderAnnotationRect
	selected?: boolean
	width: number
}) {
	const y = (rect.y + rect.h * 0.9) * height
	const x1 = rect.x * width
	const x2 = (rect.x + rect.w) * width
	return (
		<>
			<line
				pointerEvents="none"
				stroke={color}
				strokeDasharray={isGhost ? "5 4" : undefined}
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeOpacity={isGhost ? (selected ? 0.68 : 0.38) : selected ? 0.98 : 0.92}
				strokeWidth={isGhost ? (selected ? 2.4 : 1.6) : selected ? 3.4 : 2.3}
				x1={x1}
				x2={x2}
				y1={y}
				y2={y}
			>
				{flashed}
			</line>
		</>
	)
}

function annotationBoundingBox(annotation: ReaderAnnotation) {
	return annotationBodyBoundingBox(annotation.kind, annotation.body)
}

function tightenHighlightBox(rect: ReaderAnnotationRect, width: number, height: number) {
	const rawX = rect.x * width
	const rawY = rect.y * height
	const rawW = rect.w * width
	const rawH = rect.h * height
	const insetX = Math.min(0.75, rawW * 0.025)
	const insetY = Math.min(1.1, rawH * 0.12)
	return {
		x: rawX + insetX,
		y: rawY + insetY,
		w: Math.max(1, rawW - insetX * 2),
		h: Math.max(1, rawH - insetY * 2),
	}
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
	onRestore,
	W,
}: {
	annotation: ReaderAnnotation
	extraActions?: ReactNode
	H: number
	onChangeColor: (color: string) => void
	onDelete: () => void
	// Optional — only relevant for soft-deleted annotations. When the
	// selected annotation is a ghost, the popover swaps its color picker +
	// delete button for a single Restore action so the user can re-activate.
	onRestore?: () => void
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
	const isGhost = annotation.deletedAt != null
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: presentational; clicks within shouldn't bubble to the SVG and clear selection
		<div
			className="pointer-events-auto absolute z-[3] -translate-x-1/2 flex items-center gap-1 whitespace-nowrap rounded-md border border-border-subtle bg-bg-overlay/95 px-1.5 py-1 shadow-[var(--shadow-popover)] backdrop-blur"
			onClick={(e) => e.stopPropagation()}
			onMouseDown={(e) => e.stopPropagation()}
			onPointerDown={(e) => e.stopPropagation()}
			style={{ left: `${centerX}px`, top: `${top}px` }}
		>
			{isGhost ? (
				<>
					<span
						aria-label="Deleted annotation"
						className="flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary"
						title="Deleted annotation"
					>
						<GhostIcon />
					</span>
					{onRestore ? (
						<button
							aria-label="Restore annotation"
							className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
							onClick={onRestore}
							title="Restore"
							type="button"
						>
							<RestoreIcon />
						</button>
					) : null}
				</>
			) : (
				<>
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
				</>
			)}
		</div>
	)
}

function RestoreIcon() {
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
			<path d="M3 12a9 9 0 1 0 3-6.7" />
			<path d="M3 4v5h5" />
		</svg>
	)
}

function GhostIcon() {
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
			<path d="M6 19V9a6 6 0 1 1 12 0v10l-3-2-3 2-3-2-3 2Z" />
			<path d="M10 10h.01M14 10h.01" />
			<path d="M10 14c.7.7 2.3.7 3 0" />
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
