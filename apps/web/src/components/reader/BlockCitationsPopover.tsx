import { Link } from "@tanstack/react-router"
import { useEffect, useRef } from "react"
import { useNotesForBlock } from "@/api/hooks/citations"

export function BlockCitationsPopover({
	paperId,
	blockId,
	onDismiss,
}: {
	paperId: string
	blockId: string
	onDismiss: () => void
}) {
	const { data: notes, isLoading } = useNotesForBlock(paperId, blockId)
	const ref = useRef<HTMLDivElement>(null)

	// Click-outside + Escape close — keeping it inline since this is the only
	// popover we have right now.
	useEffect(() => {
		const onClick = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) onDismiss()
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onDismiss()
		}
		document.addEventListener("mousedown", onClick)
		document.addEventListener("keydown", onKey)
		return () => {
			document.removeEventListener("mousedown", onClick)
			document.removeEventListener("keydown", onKey)
		}
	}, [onDismiss])

	return (
		<div
			className="absolute right-0 top-full z-10 mt-1 w-64 rounded-md border border-border-default bg-bg-overlay p-2 shadow-[var(--shadow-popover)]"
			ref={ref}
		>
			<div className="mb-1 text-xs uppercase tracking-[0.16em] text-text-secondary">
				Notes citing this block
			</div>
			{isLoading ? (
				<div className="p-1 text-xs text-text-tertiary">Loading…</div>
			) : !notes || notes.length === 0 ? (
				<div className="p-1 text-xs text-text-tertiary">No notes yet.</div>
			) : (
				<ul className="space-y-1">
					{notes.map((n) => (
						<li key={n.noteId}>
							<Link
								className="block rounded px-1.5 py-1 text-sm text-text-primary hover:bg-surface-hover"
								hash={`note=${n.noteId}`}
								onClick={onDismiss}
								params={{ paperId }}
								search={{ blockId: undefined }}
								to="/papers/$paperId"
							>
								<div className="truncate font-medium">{n.title}</div>
								<div className="text-xs text-text-tertiary">
									{n.citationCount}× · {new Date(n.updatedAt).toLocaleDateString()}
								</div>
							</Link>
						</li>
					))}
				</ul>
			)}
		</div>
	)
}
