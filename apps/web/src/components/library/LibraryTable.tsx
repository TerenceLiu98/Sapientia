import { Link } from "@tanstack/react-router"
import {
	createColumnHelper,
	flexRender,
	getCoreRowModel,
	useReactTable,
} from "@tanstack/react-table"
import { useState } from "react"
import { type Paper, useDeletePaper } from "@/api/hooks/papers"

const columnHelper = createColumnHelper<Paper>()

const STATUS_STYLES: Record<Paper["parseStatus"], string> = {
	pending: "bg-bg-tertiary text-text-secondary",
	parsing: "bg-accent-100 text-accent-700",
	done: "bg-[oklch(0.92_0.035_145)] text-[oklch(0.42_0.085_145)]",
	failed: "bg-[oklch(0.93_0.035_25)] text-[oklch(0.45_0.13_25)]",
}

function StatusBadge({ paper }: { paper: Paper }) {
	const { parseStatus, parseProgressExtracted, parseProgressTotal } = paper

	let label: string = parseStatus
	if (parseStatus === "parsing") {
		if (parseProgressExtracted != null && parseProgressTotal != null) {
			label = `parsing ${parseProgressExtracted}/${parseProgressTotal}`
		} else {
			label = "parsing…"
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

function DeleteAction({ paper, workspaceId }: { paper: Paper; workspaceId: string }) {
	const del = useDeletePaper(workspaceId)
	const [confirming, setConfirming] = useState(false)

	if (del.isPending) {
		return <span className="text-xs text-text-tertiary">deleting…</span>
	}

	if (confirming) {
		return (
			<span className="inline-flex gap-2">
				<button
					className="rounded-md bg-[oklch(0.45_0.13_25)] px-2 py-1 text-xs text-text-inverse hover:opacity-90"
					onClick={() => del.mutate(paper.id)}
					type="button"
				>
					Confirm
				</button>
				<button
					className="rounded-md border border-border-default px-2 py-1 text-xs hover:bg-surface-hover"
					onClick={() => setConfirming(false)}
					type="button"
				>
					Cancel
				</button>
			</span>
		)
	}

	return (
		<button
			aria-label={`Delete ${paper.title}`}
			className="rounded-md border border-transparent px-2 py-1 text-xs text-text-tertiary transition-colors hover:border-border-default hover:bg-surface-hover hover:text-text-error"
			onClick={() => setConfirming(true)}
			type="button"
		>
			Delete
		</button>
	)
}

function makeColumns(workspaceId: string) {
	return [
		columnHelper.accessor("title", {
			header: "Title",
			cell: (info) => (
				<Link
					className="text-text-primary hover:text-text-accent"
					to="/papers/$paperId"
					params={{ paperId: info.row.original.id }}
				>
					{info.getValue()}
				</Link>
			),
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
			cell: (info) => <DeleteAction paper={info.row.original} workspaceId={workspaceId} />,
		}),
	]
}

const SIZED_COLUMN_CLASSES: Record<string, string> = {
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
			<thead className="border-b border-border-subtle">
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
						className="border-b border-border-subtle transition-colors hover:bg-surface-hover"
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
