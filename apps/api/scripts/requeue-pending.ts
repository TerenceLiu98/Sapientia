/**
 * One-shot maintenance script: re-enqueue any paper still sitting in
 * parseStatus='pending' that has no matching BullMQ job (e.g. because Redis
 * was flushed or the worker was offline at upload time).
 *
 * Run with: bun apps/api/scripts/requeue-pending.ts
 */
import { papers } from "@sapientia/db"
import { and, eq, isNull } from "drizzle-orm"
import { closeDb, db } from "../src/db"
import { logger } from "../src/logger"
import { enqueuePaperParse, paperParseQueue } from "../src/queues/paper-parse"

async function main() {
	const pending = await db
		.select({ id: papers.id, ownerUserId: papers.ownerUserId, title: papers.title })
		.from(papers)
		.where(and(eq(papers.parseStatus, "pending"), isNull(papers.deletedAt)))

	if (pending.length === 0) {
		logger.info("no pending papers to re-enqueue")
	}

	for (const paper of pending) {
		const existing = await paperParseQueue.getJob(`paper-parse-${paper.id}`)
		if (existing) {
			logger.info({ paperId: paper.id, state: await existing.getState() }, "job_already_present")
			continue
		}
		await enqueuePaperParse({ paperId: paper.id, userId: paper.ownerUserId })
		logger.info({ paperId: paper.id, title: paper.title }, "re-enqueued_pending_paper")
	}

	await paperParseQueue.close()
	await closeDb()
}

await main()
