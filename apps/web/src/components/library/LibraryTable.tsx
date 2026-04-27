import { Link } from "@tanstack/react-router"
import {
	createColumnHelper,
	flexRender,
	getCoreRowModel,
	useReactTable,
} from "@tanstack/react-table"
import type { Paper } from "@/api/hooks/papers"

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
		<span className={`rounded-md px-2 py-0.5 text-xs ${STATUS_STYLES[parseStatus]}`}>{label}</span>
	)
}

const columns = [
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
		cell: (info) => new Date(info.getValue()).toLocaleDateString(),
	}),
	columnHelper.accessor("parseStatus", {
		header: "Status",
		cell: (info) => <StatusBadge paper={info.row.original} />,
	}),
	columnHelper.accessor("fileSizeBytes", {
		header: "Size",
		cell: (info) => `${(info.getValue() / 1024 / 1024).toFixed(1)} MB`,
	}),
]

export function LibraryTable({ papers }: { papers: Paper[] }) {
	const table = useReactTable({
		data: papers,
		columns,
		getCoreRowModel: getCoreRowModel(),
	})

	return (
		<table className="w-full">
			<thead className="border-b border-border-subtle">
				{table.getHeaderGroups().map((hg) => (
					<tr key={hg.id}>
						{hg.headers.map((header) => (
							<th
								className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-secondary"
								key={header.id}
							>
								{flexRender(header.column.columnDef.header, header.getContext())}
							</th>
						))}
					</tr>
				))}
			</thead>
			<tbody>
				{table.getRowModel().rows.map((row) => (
					<tr
						className="border-b border-border-subtle transition-colors hover:bg-surface-hover"
						key={row.id}
					>
						{row.getVisibleCells().map((cell) => (
							<td className="px-4 py-3 text-sm" key={cell.id}>
								{flexRender(cell.column.columnDef.cell, cell.getContext())}
							</td>
						))}
					</tr>
				))}
			</tbody>
		</table>
	)
}
