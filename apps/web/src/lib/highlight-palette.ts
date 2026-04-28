import { useEffect, useState } from "react"

// Built-in 5-color semantic palette. Each entry is the canonical name
// (also stored on `block_highlights.color`) plus the human label and the
// CSS variable namespace — `--note-{key}-bg` / `--note-{key}-text` resolve
// at render time, so dark mode + future palette tweaks don't require data
// migration.
export interface PaletteEntry {
	key: string
	label: string
	// Optional explicit CSS color values for *custom* entries that don't
	// have a corresponding `--note-{key}-bg` token in the stylesheet.
	bgColor?: string
	textColor?: string
}

export const BUILTIN_PALETTE: PaletteEntry[] = [
	{ key: "questioning", label: "Questioning" },
	{ key: "important", label: "Important" },
	{ key: "original", label: "Original" },
	{ key: "pending", label: "Pending" },
	{ key: "conclusion", label: "Conclusion" },
]

const BUILTIN_KEYS = new Set(BUILTIN_PALETTE.map((entry) => entry.key))
const STORAGE_KEY = "sapientia.customPalette.v1"

function loadCustomPalette(): PaletteEntry[] {
	if (typeof window === "undefined") return []
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY)
		if (!raw) return []
		const parsed = JSON.parse(raw) as unknown
		if (!Array.isArray(parsed)) return []
		return parsed
			.filter((value): value is PaletteEntry => {
				if (typeof value !== "object" || value === null) return false
				const v = value as Record<string, unknown>
				return typeof v.key === "string" && typeof v.label === "string"
			})
			.filter((entry) => !BUILTIN_KEYS.has(entry.key))
	} catch {
		return []
	}
}

function saveCustomPalette(entries: PaletteEntry[]) {
	if (typeof window === "undefined") return
	window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
}

// React hook backing the per-user palette. Returns the merged palette
// (built-ins + custom) plus mutation helpers. Persistence is localStorage
// only in v0.1; cross-device sync is v0.2.
export function usePalette() {
	const [custom, setCustom] = useState<PaletteEntry[]>(() => loadCustomPalette())

	useEffect(() => {
		// Sync changes from other tabs / windows.
		const handler = (event: StorageEvent) => {
			if (event.key !== STORAGE_KEY) return
			setCustom(loadCustomPalette())
		}
		window.addEventListener("storage", handler)
		return () => window.removeEventListener("storage", handler)
	}, [])

	const palette = [...BUILTIN_PALETTE, ...custom]

	const addCustom = (entry: PaletteEntry) => {
		if (BUILTIN_KEYS.has(entry.key)) return
		const next = [...custom.filter((c) => c.key !== entry.key), entry]
		setCustom(next)
		saveCustomPalette(next)
	}
	const removeCustom = (key: string) => {
		if (BUILTIN_KEYS.has(key)) return
		const next = custom.filter((c) => c.key !== key)
		setCustom(next)
		saveCustomPalette(next)
	}

	return { palette, addCustom, removeCustom }
}

// Visual tokens for a highlight color, namespaced by UI role. Use these
// for *any* surface that should reflect a block's highlight color — never
// reach for `bg-accent-600` or another neutral accent token, otherwise the
// surface stops tracking the per-block color (a recurring bug class).
//
// Roles:
// - `chipBg` + `chipText`: solid label / pill that *carries text on the
//   color* (PDF block tag, citation chip in note body). Pair both fields.
// - `fillBg`: soft pastel area in a panel where body text reads on top in
//   the default text color (parsed-block row card, picker swatch).
// - `fillWash`: translucent overlay for surfaces with their own content
//   underneath (PDF bbox highlight on the page). The page shows through.
//
// Built-in keys resolve to `--note-{key}-bg|text` from the stylesheet;
// `chipBg` and `fillBg` share the same hue (different roles), and
// `fillWash` mixes that hue with transparent at a fixed strength so all
// PDF overlays feel consistent. Custom entries reuse their explicit
// `bgColor`/`textColor` across roles. Unknown keys (e.g. a removed custom
// entry persisted on a block) fall back to neutral so the highlight isn't
// invisible.
export interface PaletteVisualTokens {
	chipBg: string
	chipText: string
	fillBg: string
	fillWash: string
}

const WASH_STRENGTH = "38%"

function washOf(bg: string): string {
	return `color-mix(in oklch, ${bg} ${WASH_STRENGTH}, transparent)`
}

export function paletteVisualTokens(
	palette: PaletteEntry[],
	key: string,
): PaletteVisualTokens {
	const entry = palette.find((p) => p.key === key)
	if (entry?.bgColor && entry?.textColor) {
		return {
			chipBg: entry.bgColor,
			chipText: entry.textColor,
			fillBg: entry.bgColor,
			fillWash: washOf(entry.bgColor),
		}
	}
	if (BUILTIN_KEYS.has(key)) {
		const bg = `var(--note-${key}-bg)`
		return {
			chipBg: bg,
			chipText: `var(--note-${key}-text)`,
			fillBg: bg,
			fillWash: washOf(bg),
		}
	}
	const neutralBg = "var(--color-neutral-200)"
	return {
		chipBg: neutralBg,
		chipText: "var(--color-neutral-700)",
		fillBg: neutralBg,
		fillWash: washOf(neutralBg),
	}
}
