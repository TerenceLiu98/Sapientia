import { Link } from "@tanstack/react-router"
import {
	createColumnHelper,
	flexRender,
	getCoreRowModel,
	useReactTable,
} from "@tanstack/react-table"
import { useState } from "react"
import {
	type Paper,
	type PaperEnrichmentStatus,
	useDeletePaper,
	useDownloadPaperPdf,
	useExportPaperBibtex,
	useFetchPaperMetadata,
	useUpdatePaper,
} from "@/api/hooks/papers"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { EditMetadataModal } from "./EditMetadataModal"

const columnHelper = createColumnHelper<Paper>()

const STATUS_STYLES: Record<Paper["parseStatus"], string> = {
	pending: "bg-bg-tertiary text-text-secondary",
	parsing: "bg-accent-100 text-accent-700",
	done: "bg-[var(--color-status-success-bg)] text-[var(--color-status-success-text)]",
	failed: "bg-[var(--color-status-error-bg)] text-[var(--color-status-error-text)]",
}

function EnrichmentBadge({ status }: { status: PaperEnrichmentStatus }) {
	if (status === "pending" || status === "enriching") {
		return <span className="text-xs text-text-tertiary">enriching...</span>
	}
	if (status === "partial") {
		return <span className="text-xs text-text-secondary">partial metadata</span>
	}
	return null
}

function StatusBadge({ paper }: { paper: Paper }) {
	const { parseStatus, parseProgressExtracted, parseProgressTotal } = paper

	let label: string = parseStatus
	if (parseStatus === "parsing") {
		if (parseProgressExtracted != null && parseProgressTotal != null) {
			label = `parsing ${parseProgressExtracted}/${parseProgressTotal}`
		} else {
			label = "parsing..."
		}
	}

	return (
		<span
			className={`inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-xs ${STATUS_STYLES[parseStatus]}`}
		>
			{label}
		</span>
	)
}

function formatAuthors(authors: string[] | null) {
	if (!authors || authors.length === 0) return ""
	if (authors.length === 1) return authors[0]
	return `${authors[0]} et al.`
}

function paperTitleLabel(paper: Paper) {
	return paper.title || `Untitled (${paper.id.slice(0, 8)})`
}

function ActionError({ message }: { message: string | null }) {
	if (!message) return null
	return <p className="mt-1 text-right text-xs text-text-error">{message}</p>
}

function PaperActionsCell({ paper, workspaceId }: { paper: Paper; workspaceId: string }) {
	const updatePaper = useUpdatePaper(workspaceId, paper.id)
	const fetchMetadata = useFetchPaperMetadata(workspaceId, paper.id)
	const exportBibtex = useExportPaperBibtex(paper)
	const downloadPdf = useDownloadPaperPdf(paper.id)
	const deletePaper = useDeletePaper(workspaceId)
	const [editing, setEditing] = useState(false)
	const [actionError, setActionError] = useState<string | null>(null)

	const isBusy =
		updatePaper.isPending ||
		fetchMetadata.isPending ||
		exportBibtex.isPending ||
		downloadPdf.isPending ||
		deletePaper.isPending

	return (
		<div className="min-w-0">
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						className="rounded-md border border-border-default px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-hover"
						disabled={isBusy}
						type="button"
					>
						{isBusy ? "Working..." : "Actions"}
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="min-w-48">
					<DropdownMenuItem
						onSelect={() => {
							setActionError(null)
							setEditing(true)
						}}
					>
						Edit metadata
					</DropdownMenuItem>
					<DropdownMenuItem
						onSelect={() => {
							setActionError(null)
							exportBibtex.mutate(undefined, {
								onError: (error) =>
									setActionError(error instanceof Error ? error.message : "Export failed"),
							})
						}}
					>
						Export BibTeX
					</DropdownMenuItem>
					<DropdownMenuItem
						onSelect={() => {
							setActionError(null)
							downloadPdf.mutate(undefined, {
								onError: (error) =>
									setActionError(error instanceof Error ? error.message : "Download failed"),
							})
						}}
					>
						Download PDF
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						className="text-text-error"
						onSelect={() => {
							if (!window.confirm(`Delete ${paperTitleLabel(paper)}?`)) return
							setActionError(null)
							deletePaper.mutate(paper.id, {
								onError: (error) =>
									setActionError(error instanceof Error ? error.message : "Delete failed"),
							})
						}}
					>
						Delete paper
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<ActionError message={actionError} />

			<EditMetadataModal
				errorMessage={updatePaper.error instanceof Error ? updatePaper.error.message : null}
				fetchErrorMessage={
					fetchMetadata.error instanceof Error ? fetchMetadata.error.message : null
				}
				isFetchingMetadata={fetchMetadata.isPending}
				isSaving={updatePaper.isPending}
				onClose={() => setEditing(false)}
				onFetchMetadata={(input) => {
					setActionError(null)
					fetchMetadata.mutate(input)
				}}
				onSubmit={(patch) => {
					setActionError(null)
					updatePaper.mutate(patch, {
						onSuccess: () => setEditing(false),
					})
				}}
				open={editing}
				paper={paper}
			/>
		</div>
	)
}

function makeColumns(workspaceId: string) {
	return [
		columnHelper.accessor("title", {
			header: "Title",
			cell: (info) => {
				const paper = info.row.original
				return (
					<div className="min-w-0">
						<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
							<Link
								className="font-medium text-text-primary hover:text-text-accent"
								params={{ paperId: paper.id }}
								search={{ blockId: undefined }}
								to="/papers/$paperId"
							>
								{paperTitleLabel(paper)}
							</Link>
							<EnrichmentBadge status={paper.enrichmentStatus} />
						</div>
						<div className="mt-1 flex flex-wrap gap-x-2 text-xs text-text-tertiary">
							{paper.venue ? <span>{paper.venue}</span> : null}
						</div>
					</div>
				)
			},
		}),
		columnHelper.accessor("authors", {
			header: "Authors",
			cell: (info) => (
				<span className="text-sm text-text-secondary">{formatAuthors(info.getValue())}</span>
			),
		}),
		columnHelper.accessor("year", {
			header: "Year",
			cell: (info) => <span className="whitespace-nowrap">{info.getValue() ?? ""}</span>,
		}),
		columnHelper.accessor("createdAt", {
			header: "Uploaded",
			cell: (info) => (
				<span className="whitespace-nowrap">{new Date(info.getValue()).toLocaleDateString()}</span>
			),
		}),
		columnHelper.accessor("parseStatus", {
			header: "Status",
			cell: (info) => <StatusBadge paper={info.row.original} />,
		}),
		columnHelper.accessor("fileSizeBytes", {
			header: "Size",
			cell: (info) => (
				<span className="whitespace-nowrap tabular-nums">
					{`${(info.getValue() / 1024 / 1024).toFixed(1)} MB`}
				</span>
			),
		}),
		columnHelper.display({
			id: "actions",
			header: "",
			cell: (info) => <PaperActionsCell paper={info.row.original} workspaceId={workspaceId} />,
		}),
	]
}

const SIZED_COLUMN_CLASSES: Record<string, string> = {
	authors: "w-52",
	year: "whitespace-nowrap w-20",
	createdAt: "whitespace-nowrap w-32",
	parseStatus: "whitespace-nowrap w-44",
	fileSizeBytes: "whitespace-nowrap w-24 text-right",
	actions: "whitespace-nowrap w-32 text-right",
}

export function LibraryTable({ papers, workspaceId }: { papers: Paper[]; workspaceId: string }) {
	const table = useReactTable({
		data: papers,
		columns: makeColumns(workspaceId),
		getCoreRowModel: getCoreRowModel(),
	})

	return (
		<table className="w-full table-auto">
			<thead className="border-b border-border-subtle bg-bg-secondary">
				{table.getHeaderGroups().map((hg) => (
					<tr key={hg.id}>
						{hg.headers.map((header) => {
							const sizing = SIZED_COLUMN_CLASSES[header.column.id] ?? ""
							return (
								<th
									className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-secondary ${sizing}`}
									key={header.id}
								>
									{flexRender(header.column.columnDef.header, header.getContext())}
								</th>
							)
						})}
					</tr>
				))}
			</thead>
			<tbody>
				{table.getRowModel().rows.map((row) => (
					<tr
						className="h-[var(--table-row-height)] border-b border-border-subtle transition-colors hover:bg-surface-hover"
						key={row.id}
					>
						{row.getVisibleCells().map((cell) => {
							const sizing = SIZED_COLUMN_CLASSES[cell.column.id] ?? ""
							return (
								<td className={`px-4 py-3 text-sm align-middle ${sizing}`} key={cell.id}>
									{flexRender(cell.column.columnDef.cell, cell.getContext())}
								</td>
							)
						})}
					</tr>
				))}
			</tbody>
		</table>
	)
}
