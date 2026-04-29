import { type RefObject, useEffect, useState } from "react"

// TASK-018: marginalia surface picks one of three densities based on
// the reader workspace's content width (NOT viewport width — the
// workspace can be narrower than the viewport when LeftNav / right
// agent panel are open). Each phase plugs in incrementally:
//
//   wide    (≥ 1280)  Phase A — slip lane 272 + rail 44 in PDF gutter,
//                              expand in-place into PDF whitespace
//   compact (760..1280) Phase B — slip lane 196 + rail 36 with 1-line
//                              excerpts; expand pops an overlay card
//                              over the workspace with a backdrop dim
//   mobile  (< 760)    Phase C — gutter is gone; inline anchor pills
//                              on PDF blocks + bottom drawer
//
// Thresholds smooth out the demo's ambiguous 1180–1280 gap by treating
// that range as compact. The breakpoint switch is hard, not animated:
// reflowing slip cards mid-transition (3-line ↔ 1-line clamp) makes
// the text jump while shrinking, which reads worse than a single jump.
export type GutterMode = "wide" | "compact" | "mobile"

const COMPACT_MIN_WIDTH = 760
const WIDE_MIN_WIDTH = 1280

function modeForWidth(width: number): GutterMode {
	if (width >= WIDE_MIN_WIDTH) return "wide"
	if (width >= COMPACT_MIN_WIDTH) return "compact"
	return "mobile"
}

export function useGutterMode(ref: RefObject<HTMLElement | null>): GutterMode {
	const [mode, setMode] = useState<GutterMode>(() => {
		// SSR-safe initial guess: assume wide. Real value lands on mount
		// when ResizeObserver fires its first entry. The fallback keeps
		// the static markup matching the most common desktop case so the
		// initial paint isn't visibly wrong before measurement.
		if (typeof window === "undefined") return "wide"
		const initial = ref.current?.getBoundingClientRect().width
		return initial != null ? modeForWidth(initial) : "wide"
	})

	useEffect(() => {
		const el = ref.current
		if (!el) return
		// Measure once on mount in case ResizeObserver fires asynchronously
		// after first paint — this avoids a one-frame flash of the wrong
		// mode when the workspace mounts at compact width.
		setMode(modeForWidth(el.getBoundingClientRect().width))
		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const next = modeForWidth(entry.contentRect.width)
				setMode((prev) => (prev === next ? prev : next))
			}
		})
		observer.observe(el)
		return () => observer.disconnect()
	}, [ref])

	return mode
}
