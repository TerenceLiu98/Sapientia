import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useCreateNote, useNotes } from "@/api/hooks/notes"
import { useCurrentWorkspace } from "@/api/hooks/workspaces"
import { ProtectedRoute } from "@/components/auth/ProtectedRoute"
import { AppShell } from "@/components/layout/AppShell"

export const Route = createFileRoute("/notes/")({
	component: NotesIndexPage,
})

function NotesIndexPage() {
	return (
		<ProtectedRoute>
			<AppShell title="Notes">
				<div className="h-full overflow-y-auto">
					<NotesList />
				</div>
			</AppShell>
		</ProtectedRoute>
	)
}

function NotesList() {
	const { data: workspace } = useCurrentWorkspace()
	const { data: notes, isLoading } = useNotes(workspace?.id ?? "")
	const createNote = useCreateNote(workspace?.id ?? "")
	const navigate = useNavigate()

	if (!workspace || isLoading) {
		return <div className="p-6 text-sm text-text-tertiary">Loading…</div>
	}

	async function onCreate() {
		const created = await createNote.mutateAsync({
			title: "Untitled",
			blocknoteJson: [],
		})
		await navigate({ to: "/notes/$noteId", params: { noteId: created.id } })
	}

	function noteLabel(note: NonNullable<typeof notes>[number]) {
		const title = note.title.trim()
		if (title.length > 0) return title
		return note.paperId ? "Marginalia note" : "Untitled"
	}

	return (
		<div className="mx-auto max-w-[var(--content-default)] px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
			<div className="mb-6 flex items-center justify-between">
				<h1 className="font-serif text-3xl text-text-primary">Notes</h1>
				<button
					className="h-9 rounded-md bg-accent-600 px-4 text-sm font-medium text-text-inverse transition-colors hover:bg-accent-700 disabled:opacity-60"
					disabled={createNote.isPending}
					onClick={() => void onCreate()}
					type="button"
				>
					{createNote.isPending ? "Creating…" : "New note"}
				</button>
			</div>

			{!notes || notes.length === 0 ? (
				<p className="text-text-secondary">
					No notes yet. Click <span className="font-medium">New note</span> to start one, or open a
					paper and create a paper-side note.
				</p>
			) : (
				<ul className="divide-y divide-border-subtle border-y border-border-subtle">
					{notes.map((note) => (
						<li key={note.id}>
							<Link
								className="flex items-baseline justify-between py-3 transition-colors hover:bg-surface-hover"
								params={{ noteId: note.id }}
								to="/notes/$noteId"
							>
								<span className="font-serif text-lg text-text-primary">{noteLabel(note)}</span>
								<span className="text-xs text-text-tertiary">
									v{note.currentVersion} · {new Date(note.updatedAt).toLocaleDateString()}
									{note.paperId ? " · paper" : ""}
								</span>
							</Link>
						</li>
					))}
				</ul>
			)}
		</div>
	)
}
