import { useEffect } from "react"
import type { HighlightColor } from "@/api/hooks/highlights"

interface ColorChoice {
	key: HighlightColor
	label: string
	shortcut: string
}

const COLORS: ColorChoice[] = [
	{ key: "questioning", label: "Questioning", shortcut: "1" },
	{ key: "important", label: "Important", shortcut: "2" },
	{ key: "original", label: "Original", shortcut: "3" },
	{ key: "pending", label: "Pending", shortcut: "4" },
	{ key: "background", label: "Background", shortcut: "5" },
]

interface Props {
	position: { top: number; left: number }
	onColor: (color: HighlightColor) => void
	onCite: () => void
	onAsk: () => void
	onCopy: () => void
	onDismiss: () => void
}

// Floating toolbar that follows a live selection. Mounts only while a
// selection is active; the parent (BlocksPanel) listens for `selectionchange`
// and decides when to render this. Keyboard shortcuts (1-5 / 0 / Esc) are
// active for as long as the toolbar is mounted.
export function SelectionToolbar({ position, onColor, onCite, onAsk, onCopy, onDismiss }: Props) {
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			// Don't steal keys from text inputs / contentEditable surfaces.
			const target = e.target as HTMLElement | null
			if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
			if (target?.isContentEditable) return
			switch (e.key) {
				case "1":
					e.preventDefault()
					onColor("questioning")
					break
				case "2":
					e.preventDefault()
					onColor("important")
					break
				case "3":
					e.preventDefault()
					onColor("original")
					break
				case "4":
					e.preventDefault()
					onColor("pending")
					break
				case "5":
					e.preventDefault()
					onColor("background")
					break
				case "0":
				case "Escape":
					e.preventDefault()
					onDismiss()
					break
			}
		}
		window.addEventListener("keydown", handler)
		return () => window.removeEventListener("keydown", handler)
	}, [onColor, onDismiss])

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: this wrapper prevents mousedown from collapsing the live text selection before the toolbar button click lands
		<div
			className="fixed z-50 flex items-center gap-1 rounded-md border border-border-default bg-bg-primary px-2 py-1.5 shadow-[var(--shadow-popover)]"
			// Crucial: don't let mousedown on the toolbar collapse the user's
			// selection, otherwise the moment they reach for a button the
			// selection vanishes and we lose the data we need.
			onMouseDown={(e) => e.preventDefault()}
			style={{ top: position.top, left: position.left }}
		>
			{COLORS.map((c) => (
				<button
					aria-label={`${c.label} (${c.shortcut})`}
					className="flex h-7 w-7 items-center justify-center rounded-md border transition-transform hover:scale-110"
					key={c.key}
					onClick={() => onColor(c.key)}
					style={{
						backgroundColor: `var(--note-${c.key}-bg)`,
						borderColor: `var(--note-${c.key}-text)`,
						color: `var(--note-${c.key}-text)`,
					}}
					title={`${c.label} (${c.shortcut})`}
					type="button"
				>
					<span className="text-[10px] font-semibold leading-none">{c.shortcut}</span>
				</button>
			))}
			<div className="mx-1 h-5 w-px bg-border-subtle" />
			<button
				className="rounded-sm px-2 py-1 text-sm text-text-secondary hover:bg-surface-hover"
				onClick={onCite}
				title="Cite into current note"
				type="button"
			>
				Cite
			</button>
			<button
				className="rounded-sm px-2 py-1 text-sm text-text-secondary hover:bg-surface-hover"
				onClick={onAsk}
				title="Ask the agent (coming soon)"
				type="button"
			>
				Ask
			</button>
			<button
				className="rounded-sm px-2 py-1 text-sm text-text-secondary hover:bg-surface-hover"
				onClick={onCopy}
				title="Copy selected text"
				type="button"
			>
				Copy
			</button>
		</div>
	)
}
