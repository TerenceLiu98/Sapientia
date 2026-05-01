/**
 * Re-enqueue summary-complete papers that still do not have a healthy
 * TASK-020A source page.
 *
 * Targets:
 * - missing source page
 * - failed source page
 * - stale pending source page
 *
 * Run with:
 *   set -a && source apps/api/.env && set +a && bun apps/api/scripts/backfill-paper-compile.ts
 */
import { papers, wikiPages } from "@sapientia/db"
import { eq, isNull } from "drizzle-orm"
import { closeDb, db } from "../src/db"
import {
	enqueuePaperSummarize,
	paperSummarizeQueue,
} from "../src/queues/paper-summarize"
import { markPaperCompilePending } from "../src/services/paper-compile"

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
		})
		.from(papers)
		.where(isNull(papers.deletedAt))

	let enqueued = 0
	let skippedExistingJob = 0
	let skippedHealthy = 0

	for (const row of rows) {
		if (row.summaryStatus !== "done") continue
		const status = classifyWikiStatus(sourcePagesByPaperId.get(row.id) ?? [])
		if (status === "done" || status === "running" || status === "pending") {
			skippedHealthy += 1
			continue
		}

		const jobId = `paper-summarize-${row.id}`
		const existing = await paperSummarizeQueue.getJob(jobId)
		if (existing) {
			const state = await existing.getState()
			if (state === "active" || state === "waiting" || state === "delayed" || state === "prioritized") {
				console.log(`skip existing job ${row.id} (${state}) ${row.title}`)
				skippedExistingJob += 1
				continue
			}
		}

		await markPaperCompilePending({ paperId: row.id, userId: row.ownerUserId })
		await enqueuePaperSummarize({ paperId: row.id, userId: row.ownerUserId, force: true })
		console.log(`re-enqueued ${status} paper compile for ${row.id} ${row.title}`)
		enqueued += 1
	}

	console.table([
		{
			enqueued,
			skipped_existing_job: skippedExistingJob,
			skipped_healthy: skippedHealthy,
		},
	])

	await paperSummarizeQueue.close()
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
