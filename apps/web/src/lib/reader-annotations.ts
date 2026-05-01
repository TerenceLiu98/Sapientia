export type ReaderAnnotationKind = "highlight" | "underline"
export type ReaderAnnotationTool = ReaderAnnotationKind

export interface ReaderAnnotationRect {
	x: number
	y: number
	w: number
	h: number
}

export interface ReaderTextMarkupBody {
	rects: ReaderAnnotationRect[]
	quote: string
}

export type ReaderAnnotationBody = ReaderTextMarkupBody

export function annotationBodyBoundingBox(
	_kind: ReaderAnnotationKind,
	body: ReaderAnnotationBody,
): ReaderAnnotationRect | null {
	return boundingBoxForRects(body.rects)
}

export function boundingBoxForRects(rects: ReaderAnnotationRect[]): ReaderAnnotationRect | null {
	const visibleRects = rects.filter((rect) => rect.w > 0 && rect.h > 0)
	if (visibleRects.length === 0) return null
	const x = Math.min(...visibleRects.map((rect) => rect.x))
	const y = Math.min(...visibleRects.map((rect) => rect.y))
	const right = Math.max(...visibleRects.map((rect) => rect.x + rect.w))
	const bottom = Math.max(...visibleRects.map((rect) => rect.y + rect.h))
	return { x, y, w: right - x, h: bottom - y }
}

export function normalizeAnnotationRects(rects: ReaderAnnotationRect[]) {
	return compactAnnotationRects(
		rects
		.filter((rect) => Number.isFinite(rect.x) && Number.isFinite(rect.y) && Number.isFinite(rect.w) && Number.isFinite(rect.h))
		.filter((rect) => rect.w > 0 && rect.h > 0)
		.map((rect) => ({
			x: clampUnit(rect.x),
			y: clampUnit(rect.y),
			w: Math.max(0, Math.min(1 - clampUnit(rect.x), rect.w)),
			h: Math.max(0, Math.min(1 - clampUnit(rect.y), rect.h)),
		}))
		.filter((rect) => rect.w > 0 && rect.h > 0)
		.sort((a, b) => {
			if (Math.abs(a.y - b.y) > 0.002) return a.y - b.y
			return a.x - b.x
		}),
	)
}

export interface ReaderAnnotationColor {
	value: string
	label: string
}

// Six fixed user-pickable swatches for text markup creation + editing.
// These are user-presentation choices the reader picks at the
// toolbar; the chosen `value` is persisted on the annotation row and
// later combined with alpha at render time (e.g. ${color}33 to dim a
// citation chip). That alpha math requires a literal hex, so unlike
// the rest of the color system these are NOT CSS-var-backed — a
// yellow highlight looks the same in light and dark mode by intent.
//
// AC #4 of TASK-019.1 exempts "documented one-off visualization
// colors that are first added back to the token source of truth";
// the canonical values are mirrored in docs/DESIGN_TOKENS.md §2.7.
export const READER_ANNOTATION_COLORS: ReaderAnnotationColor[] = [
	{ value: "#f4c84f", label: "Yellow" },
	{ value: "#ff6b6b", label: "Red" },
	{ value: "#65a30d", label: "Green" },
	{ value: "#3b82f6", label: "Blue" },
	{ value: "#a855f7", label: "Purple" },
	{ value: "#111827", label: "Black" },
]

export function clampUnit(value: number) {
	if (!Number.isFinite(value)) return 0
	return Math.max(0, Math.min(1, value))
}

function compactAnnotationRects(rects: ReaderAnnotationRect[]) {
	if (rects.length <= 1) return rects
	const lines: ReaderAnnotationRect[][] = []
	for (const rect of rects) {
		const currentLine = lines.at(-1)
		if (currentLine && shouldShareAnnotationLine(currentLine[0] as ReaderAnnotationRect, rect)) {
			currentLine.push(rect)
			continue
		}
		lines.push([rect])
	}
	return lines.map((lineRects) => {
		const bbox = boundingBoxForRects(lineRects)
		return bbox ?? lineRects[0]
	})
}

function shouldShareAnnotationLine(a: ReaderAnnotationRect, b: ReaderAnnotationRect) {
	const minHeight = Math.min(a.h, b.h)
	if (minHeight <= 0) return false
	const aCenterY = a.y + a.h / 2
	const bCenterY = b.y + b.h / 2
	const centerDelta = Math.abs(aCenterY - bCenterY)
	return centerDelta <= minHeight * 0.45
}
