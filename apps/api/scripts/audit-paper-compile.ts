/**
 * Audit upload-time paper compile coverage for TASK-020A.
 *
 * Run with:
 *   set -a && source apps/api/.env && set +a && bun apps/api/scripts/audit-paper-compile.ts
 */
import { papers, wikiPages } from "@sapientia/db"
import { eq, isNull } from "drizzle-orm"
import { closeDb, db } from "../src/db"

const STALE_PENDING_MINUTES = 15

async function main() {
	const sourcePages = await db
		.select({
			sourcePaperId: wikiPages.sourcePaperId,
			status: wikiPages.status,
			updatedAt: wikiPages.updatedAt,
		})
		.from(wikiPages)
		.where(eq(wikiPages.type, "source"))

	const sourcePagesByPaperId = new Map<
		string,
		Array<{ status: string; updatedAt: Date }>
	>()
	for (const row of sourcePages) {
		if (!row.sourcePaperId) continue
		const bucket = sourcePagesByPaperId.get(row.sourcePaperId) ?? []
		bucket.push({ status: row.status, updatedAt: row.updatedAt })
		sourcePagesByPaperId.set(row.sourcePaperId, bucket)
	}

	const rows = await db
		.select({
			id: papers.id,
			title: papers.title,
			ownerUserId: papers.ownerUserId,
			summaryStatus: papers.summaryStatus,
			summaryGeneratedAt: papers.summaryGeneratedAt,
		})
		.from(papers)
		.where(isNull(papers.deletedAt))

	let totalPapers = 0
	let summaryDone = 0
	let wikiDone = 0
	let wikiPending = 0
	let wikiRunning = 0
	let wikiFailed = 0
	let wikiMissing = 0
	let stalePending = 0

	const problemRows: Array<{
		paperId: string
		title: string
		summaryStatus: string
		wikiStatus: string
	}> = []

	for (const row of rows) {
		totalPapers += 1
		if (row.summaryStatus !== "done") continue
		summaryDone += 1

		const pageRows = sourcePagesByPaperId.get(row.id) ?? []
		const status = classifyWikiStatus(pageRows)

		if (status === "done") wikiDone += 1
		if (status === "pending") wikiPending += 1
		if (status === "running") wikiRunning += 1
		if (status === "failed") wikiFailed += 1
		if (status === "missing") wikiMissing += 1
		if (status === "stale-pending") stalePending += 1

		if (status !== "done") {
			problemRows.push({
				paperId: row.id,
				title: row.title,
				summaryStatus: row.summaryStatus,
				wikiStatus: status,
			})
		}
	}

	console.log("paper compile audit")
	console.table([
		{
			total_papers: totalPapers,
			summary_done: summaryDone,
			wiki_done: wikiDone,
			wiki_pending: wikiPending,
			wiki_running: wikiRunning,
			wiki_failed: wikiFailed,
			wiki_missing: wikiMissing,
			wiki_stale_pending: stalePending,
		},
	])

	if (problemRows.length > 0) {
		console.log("problem papers")
		console.table(problemRows.slice(0, 25))
	} else {
		console.log("No missing/failed/pending source pages found for summary-complete papers.")
	}

	await closeDb()
}

function classifyWikiStatus(rows: Array<{ status: string; updatedAt: Date }>) {
	if (rows.length === 0) return "missing"
	if (rows.some((row) => row.status === "done")) return "done"
	if (rows.some((row) => row.status === "running")) return "running"
	if (rows.some((row) => row.status === "pending")) {
		const newestPending = rows
			.filter((row) => row.status === "pending")
			.reduce<Date | null>((latest, row) => {
				if (!latest || row.updatedAt > latest) return row.updatedAt
				return latest
			}, null)
		if (
			newestPending &&
			Date.now() - newestPending.getTime() > STALE_PENDING_MINUTES * 60 * 1000
		) {
			return "stale-pending"
		}
		return "pending"
	}
	if (rows.some((row) => row.status === "failed")) return "failed"
	return "unknown"
}

await main()
