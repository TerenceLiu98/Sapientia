import { papers } from "@sapientia/db"
import { and, ilike, isNull, ne, or, sql } from "drizzle-orm"
import { db } from "../db"
import { enqueuePaperEnrich } from "../queues/paper-enrich"

const RETRY_AFTER_DAYS = 7

export async function enqueueDueMetadataRetries(args: {
	limit?: number
	now?: Date
} = {}) {
	const limit = args.limit ?? 100
	const now = args.now ?? new Date()
	const cutoffIso = new Date(now.getTime() - RETRY_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString()

	const rows = await db
		.select({
			paperId: papers.id,
			userId: papers.ownerUserId,
		})
		.from(papers)
		.where(
			and(
				isNull(papers.deletedAt),
				ne(papers.enrichmentStatus, "enriching"),
				or(isNull(papers.enrichedAt), sql`${papers.enrichedAt} < ${cutoffIso}::timestamptz`),
				or(
					isNull(papers.venue),
					isNull(papers.doi),
					sql`${papers.publicationType} = 'preprint'`,
					ilike(papers.venue, "%arxiv%"),
					ilike(papers.venue, "%openreview%"),
					ilike(papers.venue, "%corr%"),
					ilike(papers.venue, "%biorxiv%"),
					ilike(papers.venue, "%medrxiv%"),
				),
			),
		)
		.limit(limit)

	let queuedCount = 0
	for (const row of rows) {
		await enqueuePaperEnrich({ paperId: row.paperId, userId: row.userId })
		queuedCount += 1
	}

	return {
		scannedLimit: limit,
		queuedCount,
	}
}
