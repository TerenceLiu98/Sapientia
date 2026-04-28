export type ReaderAnnotationKind = "highlight" | "underline" | "ink"
export type ReaderAnnotationTool = ReaderAnnotationKind

export interface ReaderAnnotationPoint {
	x: number
	y: number
}

export interface ReaderAnnotationRect {
	x: number
	y: number
	w: number
	h: number
}

export type ReaderAnnotationBody =
	| { rect: ReaderAnnotationRect }
	| { from: ReaderAnnotationPoint; to: ReaderAnnotationPoint }
	| { points: ReaderAnnotationPoint[] }

export function annotationBodyBoundingBox(
	kind: ReaderAnnotationKind,
	body: ReaderAnnotationBody,
): ReaderAnnotationRect | null {
	if (kind === "highlight" && "rect" in body) {
		return body.rect
	}
	if (kind === "underline" && "from" in body && "to" in body) {
		const { from, to } = body
		return {
			x: Math.min(from.x, to.x),
			y: Math.min(from.y, to.y),
			w: Math.abs(to.x - from.x),
			h: Math.abs(to.y - from.y),
		}
	}
	if (kind === "ink" && "points" in body && body.points.length > 0) {
		const xs = body.points.map((p) => p.x)
		const ys = body.points.map((p) => p.y)
		const x = Math.min(...xs)
		const y = Math.min(...ys)
		return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
	}
	return null
}

export interface ReaderAnnotationColor {
	value: string
	label: string
}

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

export function rectFromPoints(
	start: ReaderAnnotationPoint,
	end: ReaderAnnotationPoint,
): ReaderAnnotationRect {
	const x = Math.min(start.x, end.x)
	const y = Math.min(start.y, end.y)
	return {
		x,
		y,
		w: Math.abs(end.x - start.x),
		h: Math.abs(end.y - start.y),
	}
}

export function distanceBetweenPoints(a: ReaderAnnotationPoint, b: ReaderAnnotationPoint) {
	return Math.hypot(a.x - b.x, a.y - b.y)
}

export function pointsToSvgPath(points: ReaderAnnotationPoint[]) {
	if (points.length === 0) return ""
	return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")
}
