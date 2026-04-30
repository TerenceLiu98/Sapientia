import { useEffect, useMemo, useRef } from "react"
import type { ReaderSelectionContext } from "./reader-selection"

interface SelectedTextToolbarProps {
	selection: ReaderSelectionContext
	onAskAgent: (selection: ReaderSelectionContext) => void
	onCopy: (selection: ReaderSelectionContext) => void
	onDismiss: () => void
}

export function SelectedTextToolbar({
	selection,
	onAskAgent,
	onCopy,
	onDismiss,
}: SelectedTextToolbarProps) {
	const rootRef = useRef<HTMLDivElement | null>(null)

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onDismiss()
		}
		const handlePointerDown = (event: PointerEvent) => {
			if (rootRef.current?.contains(event.target as Node)) return
			onDismiss()
		}
		document.addEventListener("keydown", handleKeyDown)
		document.addEventListener("pointerdown", handlePointerDown)
		return () => {
			document.removeEventListener("keydown", handleKeyDown)
			document.removeEventListener("pointerdown", handlePointerDown)
		}
	}, [onDismiss])

	const placement = useMemo(() => {
		const centerX = selection.anchorRect.left + selection.anchorRect.width / 2
		const viewportWidth =
			typeof window === "undefined" ? centerX : Math.max(window.innerWidth - 24, 24)
		const left = Math.max(24, Math.min(viewportWidth, centerX))
		const placeAbove = selection.anchorRect.top > 76
		return {
			left,
			top: placeAbove
				? selection.anchorRect.top - 10
				: selection.anchorRect.top + selection.anchorRect.height + 10,
			transform: placeAbove ? "translate(-50%, -100%)" : "translate(-50%, 0)",
		}
	}, [selection.anchorRect])

	return (
		<div
			className="pointer-events-auto fixed z-[80] flex items-center gap-1 rounded-lg border border-border-default bg-bg-overlay/95 p-1 shadow-[var(--shadow-popover)] backdrop-blur"
			onMouseDown={(event) => event.preventDefault()}
			ref={rootRef}
			style={placement}
		>
			<button
				aria-label="Copy selected text"
				className="flex h-7 w-7 items-center justify-center rounded-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
				onClick={() => onCopy(selection)}
				title="Copy"
				type="button"
			>
				<CopyIcon />
			</button>
			<button
				aria-label="Ask the agent about this selected text"
				className="flex h-7 w-7 items-center justify-center rounded-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-accent"
				onClick={() => onAskAgent(selection)}
				title="Ask agent"
				type="button"
			>
				<AgentIcon />
			</button>
		</div>
	)
}

function CopyIcon() {
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
			<rect height="13" rx="2" width="13" x="9" y="9" />
			<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
		</svg>
	)
}

function AgentIcon() {
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
			<path d="M12 4a8 8 0 0 1 8 8c0 4.4-3.6 8-8 8H5l-1 1v-9a8 8 0 0 1 8-8Z" />
			<path d="M8 11h8M8 15h5" />
		</svg>
	)
}
