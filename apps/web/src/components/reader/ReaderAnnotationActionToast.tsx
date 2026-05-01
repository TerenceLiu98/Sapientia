import type { ReaderAnnotation } from "@/api/hooks/reader-annotations"

export interface ReaderAnnotationRecallState {
	action: "created" | "deleted"
	annotationId: string
	annotation: Pick<ReaderAnnotation, "body" | "color" | "kind">
	page: number
	softDeleted?: boolean
}

interface ReaderAnnotationActionToastProps {
	recall: ReaderAnnotationRecallState
	isUndoing?: boolean
	onDismiss: () => void
	onPause?: () => void
	onResume?: () => void
	onUndo: () => void
}

export function ReaderAnnotationActionToast({
	recall,
	isUndoing = false,
	onDismiss,
	onPause,
	onResume,
	onUndo,
}: ReaderAnnotationActionToastProps) {
	const quote = formatQuoteExcerpt(recall.annotation.body.quote)
	const actionLabel = describeRecallAction(recall)

	return (
		<div
			className="pointer-events-none fixed bottom-5 left-1/2 -translate-x-1/2"
			style={{ zIndex: "var(--z-toast)" }}
		>
			<div
				className="pointer-events-auto flex min-w-[280px] max-w-[min(92vw,520px)] items-center gap-3 rounded-xl border border-border-subtle bg-bg-overlay/95 px-3 py-2 shadow-[var(--shadow-popover)] backdrop-blur"
				onMouseEnter={onPause}
				onMouseLeave={onResume}
			>
				<span
					aria-label={actionLabel}
					className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border-subtle"
					style={{
						backgroundColor: `${recall.annotation.color}22`,
						color: recall.annotation.color,
					}}
				>
					{recall.annotation.kind === "underline" ? <UnderlineToastIcon /> : <HighlightToastIcon />}
				</span>
				<div className="min-w-0 flex-1">
					<p className="truncate text-[12px] text-text-primary">{quote}</p>
					<p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-tertiary">
						<UndoToastIcon />
						<span className="inline-flex items-center gap-1">
							<kbd className="rounded border border-border-subtle px-1 py-0.5 font-mono text-[10px] leading-none">
								Cmd
							</kbd>
							<span>/</span>
							<kbd className="rounded border border-border-subtle px-1 py-0.5 font-mono text-[10px] leading-none">
								Ctrl
							</kbd>
							<kbd className="rounded border border-border-subtle px-1 py-0.5 font-mono text-[10px] leading-none">
								Z
							</kbd>
						</span>
					</p>
				</div>
				<button
					aria-label="Undo recent annotation action"
					className="flex h-8 w-8 items-center justify-center rounded-md text-text-accent transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
					disabled={isUndoing}
					onClick={onUndo}
					title="Undo (Cmd/Ctrl+Z)"
					type="button"
				>
					<UndoToastIcon />
				</button>
				<button
					aria-label="Dismiss annotation action"
					className="flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-primary"
					disabled={isUndoing}
					onClick={onDismiss}
					type="button"
				>
					<CloseToastIcon />
				</button>
			</div>
		</div>
	)
}

function formatQuoteExcerpt(quote: string) {
	const normalized = quote.replace(/\s+/g, " ").trim()
	if (!normalized) return "No excerpt available"
	return normalized.length > 96 ? `${normalized.slice(0, 93)}...` : normalized
}

function describeRecallAction(recall: ReaderAnnotationRecallState) {
	const kindLabel = recall.annotation.kind === "underline" ? "Underline" : "Highlight"
	const verb = recall.action === "created" ? "added" : "deleted"
	return `${kindLabel} ${verb}`
}

function HighlightToastIcon() {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="15"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.7"
			viewBox="0 0 24 24"
			width="15"
		>
			<path d="m6 15 5-5 4 4-5 5H6v-4Z" />
			<path d="M14 7 17 10" />
			<path d="M4 20h16" />
		</svg>
	)
}

function UnderlineToastIcon() {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="15"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.7"
			viewBox="0 0 24 24"
			width="15"
		>
			<path d="M7 5v6a5 5 0 0 0 10 0V5" />
			<path d="M5 20h14" />
		</svg>
	)
}

function CloseToastIcon() {
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
			<path d="m18 6-12 12" />
			<path d="m6 6 12 12" />
		</svg>
	)
}

function UndoToastIcon() {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="15"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.7"
			viewBox="0 0 24 24"
			width="15"
		>
			<path d="M9 14 4 9l5-5" />
			<path d="M4 9h9a7 7 0 1 1 0 14h-1" />
		</svg>
	)
}
