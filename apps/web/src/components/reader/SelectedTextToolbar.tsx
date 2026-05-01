import { useEffect, useMemo, useRef } from "react"
import { READER_ANNOTATION_COLORS } from "@/lib/reader-annotations"
import type { ReaderSelectionContext } from "./reader-selection"

interface SelectedTextToolbarProps {
	selection: ReaderSelectionContext
	onAskAgent: (selection: ReaderSelectionContext) => void
	onCopy: (selection: ReaderSelectionContext) => void
	onDismiss: () => void
	annotationColor?: string
	onChangeAnnotationColor?: (color: string) => void
	onHighlight?: (selection: ReaderSelectionContext) => void
	onUnderline?: (selection: ReaderSelectionContext) => void
}

export function SelectedTextToolbar({
	selection,
	onAskAgent,
	onCopy,
	onDismiss,
	annotationColor,
	onChangeAnnotationColor,
	onHighlight,
	onUnderline,
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
	const canAnnotateSelection =
		selection.mode === "pdf" && selection.annotationTarget && (onHighlight || onUnderline)
	const activeAnnotationColor = annotationColor ?? READER_ANNOTATION_COLORS[0]?.value ?? "#f4c84f"

	return (
		<div
			className="pointer-events-auto fixed z-[80] flex items-center gap-1 rounded-lg border border-border-default bg-bg-overlay/95 p-1 shadow-[var(--shadow-popover)] backdrop-blur"
			onMouseDown={(event) => event.preventDefault()}
			ref={rootRef}
			style={placement}
		>
			{canAnnotateSelection ? (
				<>
					<div className="flex items-center gap-1 px-0.5">
						{READER_ANNOTATION_COLORS.map((entry) => (
							<button
								aria-label={`Use ${entry.label} annotation color`}
								aria-pressed={activeAnnotationColor === entry.value}
								className={`h-5 w-5 rounded-full border transition-transform hover:scale-110 ${
									activeAnnotationColor === entry.value
										? "border-text-primary ring-2 ring-accent-600/35"
										: "border-border-default"
								}`}
								key={entry.value}
								onClick={() => onChangeAnnotationColor?.(entry.value)}
								style={{ backgroundColor: entry.value }}
								title={entry.label}
								type="button"
							/>
						))}
					</div>
					<div className="mx-0.5 h-4 w-px bg-border-subtle" />
					{onHighlight ? (
						<button
							aria-label="Highlight selected text"
							className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
							onClick={() => onHighlight(selection)}
							title="Highlight"
							type="button"
						>
							<HighlightIcon />
						</button>
					) : null}
					{onUnderline ? (
						<button
							aria-label="Underline selected text"
							className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
							onClick={() => onUnderline(selection)}
							title="Underline"
							type="button"
						>
							<UnderlineIcon />
						</button>
					) : null}
					<div className="mx-0.5 h-4 w-px bg-border-subtle" />
				</>
			) : null}
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

function HighlightIcon() {
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
			<path d="m6 15 5-5 4 4-5 5H6v-4Z" />
			<path d="M14 7 17 10" />
			<path d="M4 20h16" />
		</svg>
	)
}

function UnderlineIcon() {
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
			<path d="M7 5v6a5 5 0 0 0 10 0V5" />
			<path d="M5 20h14" />
		</svg>
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
