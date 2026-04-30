import { type PaletteEntry, paletteVisualTokens } from "@/lib/highlight-palette"

interface Props {
	palette: PaletteEntry[]
	currentColor?: string | null
	onPick: (color: string) => void
	onClear: () => void
	// Visual size variant: `xs` for inline overlays on PDF bbox corners,
	// `sm` for the parsed-blocks toolbar.
	size?: "xs" | "sm"
	orientation?: "horizontal" | "vertical"
	shape?: "square" | "round"
}

// Inline color picker: a row of palette chips followed by a clear button.
// Clicking a chip fills the block (or clears, if it was already active);
// the dedicated ✕ button always restores the default (no highlight) so the
// reset action is discoverable without relying on the toggle gesture.
export function BlockHighlightPicker({
	palette,
	currentColor,
	onPick,
	onClear,
	size = "sm",
	orientation = "horizontal",
	shape = "square",
}: Props) {
	const dim = size === "xs" ? "h-3.5 w-3.5" : "h-5 w-5"
	const hasActive = currentColor != null && currentColor.length > 0
	const chipRadius = shape === "round" ? "rounded-full" : "rounded-sm"
	return (
		<div
			className={`flex gap-1 ${
				orientation === "vertical" ? "flex-col items-center" : "items-center"
			}`}
		>
			{palette.map((entry) => {
				const colors = paletteVisualTokens(palette, entry.key)
				const isActive = currentColor === entry.key
				return (
					<button
						aria-label={`${entry.label} highlight${isActive ? " (click to clear)" : ""}`}
						aria-pressed={isActive}
						className={`${dim} ${chipRadius} transition-transform hover:scale-110 ${
							isActive ? "shadow-[0_0_0_1.5px_var(--color-text-accent)]" : ""
						}`}
						key={entry.key}
						onClick={(e) => {
							e.stopPropagation()
							if (isActive) onClear()
							else onPick(entry.key)
						}}
						onMouseDown={(e) => e.stopPropagation()}
						style={{ backgroundColor: colors.fillBg }}
						title={`${entry.label}${isActive ? " · click to clear" : ""}`}
						type="button"
					/>
				)
			})}
			<button
				aria-label="Clear highlight"
				className={`${dim} flex items-center justify-center ${chipRadius} border-2 border-border-default text-text-tertiary transition-colors hover:border-text-secondary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border-default disabled:hover:text-text-tertiary`}
				disabled={!hasActive}
				onClick={(e) => {
					e.stopPropagation()
					if (hasActive) onClear()
				}}
				onMouseDown={(e) => e.stopPropagation()}
				title="Clear highlight"
				type="button"
			>
				<svg
					aria-hidden="true"
					fill="none"
					height={size === "xs" ? "9" : "11"}
					stroke="currentColor"
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth="2"
					viewBox="0 0 24 24"
					width={size === "xs" ? "9" : "11"}
				>
					<path d="M18 6 6 18M6 6l12 12" />
				</svg>
			</button>
		</div>
	)
}
