import { describe, expect, it } from "vitest"
import { normalizeAnnotationRects } from "./reader-annotations"

describe("normalizeAnnotationRects", () => {
	it("merges nearby rects on the same line into a tighter span", () => {
		const rects = normalizeAnnotationRects([
			{ x: 0.1, y: 0.2, w: 0.12, h: 0.03 },
			{ x: 0.228, y: 0.201, w: 0.08, h: 0.029 },
			{ x: 0.312, y: 0.2, w: 0.1, h: 0.03 },
		])

		expect(rects).toHaveLength(1)
		expect(rects[0]?.x).toBeCloseTo(0.1)
		expect(rects[0]?.y).toBeCloseTo(0.2)
		expect(rects[0]?.w).toBeCloseTo(0.312)
		expect(rects[0]?.h).toBeCloseTo(0.03)
	})

	it("keeps separate lines split even when x ranges overlap", () => {
		const rects = normalizeAnnotationRects([
			{ x: 0.1, y: 0.2, w: 0.2, h: 0.03 },
			{ x: 0.11, y: 0.252, w: 0.18, h: 0.031 },
		])

		expect(rects).toHaveLength(2)
	})

	it("bridges larger same-line gaps caused by inline citations or links", () => {
		const rects = normalizeAnnotationRects([
			{ x: 0.04, y: 0.18, w: 0.19, h: 0.031 },
			{ x: 0.255, y: 0.181, w: 0.11, h: 0.03 },
			{ x: 0.39, y: 0.18, w: 0.09, h: 0.031 },
		])

		expect(rects).toHaveLength(1)
		expect(rects[0]?.x).toBeCloseTo(0.04)
		expect(rects[0]?.w).toBeCloseTo(0.44)
	})
})
