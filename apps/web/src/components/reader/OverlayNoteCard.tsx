import { useEffect, useState } from "react"
import {
	NoteEditor,
	type NoteEditorRef,
	type SaveStatus,
} from "@/components/notes/NoteEditor"
import type { Note } from "@/api/hooks/notes"

// TASK-018 Phase B — compact-mode expand surface. The wide gutter's
// in-place ExpandedSlip won't fit comfortably at 196px slip lane width;
// rather than crushing the editor we lift it out into an overlay card
// centered over the workspace with a backdrop dim. The folded slip
// stays visible in the lane (at reduced opacity) so the spatial anchor
// is preserved — this card is just a temporary surface for editing,
// not a relocation of the note.
//
// Backdrop covers everything below the card; clicking it (or pressing
// Esc) closes. The save-status icon lives next to Jump / Close in the
// header, matching the wide-mode ExpandedSlip vocabulary so vertical
// shrinking doesn't introduce a new mental model.
//
// Connector to the rail dot (a dashed SVG line) is rendered separately
// inside NotesPanel — that's where the dot's coordinates live. This
// component just paints the card itself.

interface OverlayNoteCardProps {
	note: Note
	accentColor: string
	pageLabel: string
	groupLabel: string
	canJumpToAnchor: boolean
	onClose: () => void
	onJumpToAnchor?: () => void
	onEditorReady?: (editor: NoteEditorRef) => void
	onOpenCitationBlock?: (paperId: string, blockId: string) => void
	onOpenCitationAnnotation?: (
		paperId: string,
		annotationId: string,
		page?: number,
		yRatio?: number,
	) => void
	annotationOrdinalById?: Map<string, number>
	annotationBlockIdById?: Map<string, string>
	blockNumberByBlockId?: Map<string, number>
}

const OVERLAY_CARD_WIDTH = 430

export function OverlayNoteCard({
	note,
	accentColor,
	pageLabel,
	groupLabel,
	canJumpToAnchor,
	onClose,
	onJumpToAnchor,
	onEditorReady,
	onOpenCitationBlock,
	onOpenCitationAnnotation,
	annotationOrdinalById,
	annotationBlockIdById,
	blockNumberByBlockId,
}: OverlayNoteCardProps) {
	const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle")

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.stopPropagation()
				onClose()
			}
		}
		window.addEventListener("keydown", onKeyDown)
		return () => window.removeEventListener("keydown", onKeyDown)
	}, [onClose])

	return (
		<>
			{/* Backdrop. Tinted darker on the right where the rail sits so
			    the connector to the active dot reads against the card; on
			    the left we just need enough dim to push the PDF visually
			    behind the writing surface. */}
			<button
				aria-label="Close note"
				className="fixed inset-0 z-[40] bg-[radial-gradient(ellipse_at_right,rgba(15,23,42,0.18),rgba(15,23,42,0.06)_45%,rgba(15,23,42,0.02))]"
				onClick={onClose}
				type="button"
			/>

				<div
					className="fixed left-1/2 top-1/2 z-[41] flex max-h-[70vh] w-[var(--overlay-card-w)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[18px] border border-border-default bg-[color-mix(in_srgb,var(--color-reading-bg)_90%,var(--color-bg-overlay))] shadow-[var(--shadow-xl)]"
				data-overlay-note-id={note.id}
				role="dialog"
				aria-label={`Note · ${groupLabel || pageLabel}`}
				style={
					{
						"--overlay-card-w": `${OVERLAY_CARD_WIDTH}px`,
						borderLeft: `3px solid ${accentColor}`,
					} as React.CSSProperties
				}
			>
					<div className="flex shrink-0 items-center justify-between border-b border-border-subtle bg-[color-mix(in_srgb,var(--color-reading-bg)_70%,var(--color-bg-secondary))] px-2.5 py-1.5 text-xs text-text-tertiary">
					<span className="truncate px-1.5 py-1">
						{pageLabel}
						{groupLabel ? ` · ${groupLabel}` : ""}
					</span>
					<div className="flex items-center gap-1">
						<OverlaySaveStatusIcon status={saveStatus} />
						{canJumpToAnchor && onJumpToAnchor ? (
							<button
								aria-label="Jump to note anchor"
								className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-accent"
								onClick={onJumpToAnchor}
								title="Jump to this note's anchor in the reader"
								type="button"
							>
								<svg
									aria-hidden="true"
									fill="none"
									height="15"
									stroke="currentColor"
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth="1.8"
									viewBox="0 0 24 24"
									width="15"
								>
									<path d="M7 17 17 7" />
									<path d="M9 7h8v8" />
								</svg>
							</button>
						) : null}
						<button
							aria-label="Close note"
							className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-primary"
							onClick={onClose}
							title="Close (Esc)"
							type="button"
						>
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
								<path d="m6 6 12 12M18 6 6 18" />
							</svg>
						</button>
					</div>
				</div>
				<div className="min-h-0 flex-1">
					<NoteEditor
						noteId={note.id}
						onEditorReady={onEditorReady}
						onOpenCitationBlock={onOpenCitationBlock}
						onOpenCitationAnnotation={onOpenCitationAnnotation}
						onSaveStatusChange={setSaveStatus}
						annotationBlockIdById={annotationBlockIdById}
						annotationOrdinalById={annotationOrdinalById}
						blockNumberByBlockId={blockNumberByBlockId}
					/>
				</div>
			</div>
		</>
	)
}

// Local copy of NotesPanel's SaveStatusIcon. Kept inline here so the
// overlay can render before NotesPanel's icon helpers are reachable
// (the latter sit at the bottom of NotesPanel.tsx for layout reasons).
// Visual treatment matches the in-lane version exactly.
function OverlaySaveStatusIcon({ status }: { status: SaveStatus }) {
	if (status === "idle") return null
	if (status === "saving") {
		return (
			<span
				aria-label="Saving"
				className="flex h-7 w-7 shrink-0 items-center justify-center text-text-tertiary"
				title="Saving…"
			>
				<svg
					aria-hidden="true"
					className="animate-spin"
					fill="none"
					height="14"
					stroke="currentColor"
					strokeLinecap="round"
					strokeWidth="1.8"
					viewBox="0 0 24 24"
					width="14"
				>
					<path d="M21 12a9 9 0 1 1-6.219-8.56" />
				</svg>
			</span>
		)
	}
	if (status === "saved") {
		return (
			<span
				aria-label="Saved"
				className="flex h-7 w-7 shrink-0 items-center justify-center text-text-accent"
				title="Saved"
			>
				<svg
					aria-hidden="true"
					fill="none"
					height="14"
					stroke="currentColor"
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth="2"
					viewBox="0 0 24 24"
					width="14"
				>
					<path d="m5 12 5 5L19 7" />
				</svg>
			</span>
		)
	}
	return (
		<span
			aria-label="Save failed"
			className="flex h-7 w-7 shrink-0 items-center justify-center text-text-error"
			title="Save failed — try again"
		>
			<svg
				aria-hidden="true"
				fill="none"
				height="14"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.8"
				viewBox="0 0 24 24"
				width="14"
			>
				<circle cx="12" cy="12" r="9" />
				<path d="M12 8v5" />
				<path d="M12 16.25v.01" />
			</svg>
		</span>
	)
}
