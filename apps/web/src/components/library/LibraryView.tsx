import { useState } from "react"
import { usePapers } from "@/api/hooks/papers"
import { useCurrentWorkspace } from "@/api/hooks/workspaces"
import { LibraryTable } from "./LibraryTable"
import { UploadDropzone } from "./UploadDropzone"

export function LibraryView() {
	const { data: workspace, isLoading: workspaceLoading } = useCurrentWorkspace()
	const { data: papers, isLoading: papersLoading } = usePapers(workspace?.id ?? "")
	const [uploadOpen, setUploadOpen] = useState(false)

	if (workspaceLoading || (workspace && papersLoading)) {
		return <div className="p-6 text-sm text-text-tertiary">Loading…</div>
	}

	if (!workspace) {
		return <div className="p-6 text-sm text-text-tertiary">No workspace yet.</div>
	}

	if (!papers || papers.length === 0) {
		return (
			<div className="mx-auto max-w-[800px] px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
				<h1 className="mb-2 font-serif text-3xl text-text-primary">Library</h1>
				<p className="mb-8 text-text-secondary">
					Your library is empty. Upload a PDF to get started.
				</p>
				<UploadDropzone workspaceId={workspace.id} />
			</div>
		)
	}

	return (
		<div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
			<div className="mb-6 flex items-center justify-between">
				<h1 className="font-serif text-3xl text-text-primary">Library</h1>
				<button
					className="h-9 rounded-md bg-accent-600 px-4 text-sm font-medium text-text-inverse transition-colors hover:bg-accent-700"
					onClick={() => setUploadOpen((open) => !open)}
					type="button"
				>
					{uploadOpen ? "Close" : "Upload PDF"}
				</button>
			</div>

			{uploadOpen ? (
				<div className="mb-6">
					<UploadDropzone workspaceId={workspace.id} onComplete={() => setUploadOpen(false)} />
				</div>
			) : null}

			<LibraryTable papers={papers} workspaceId={workspace.id} />
		</div>
	)
}
