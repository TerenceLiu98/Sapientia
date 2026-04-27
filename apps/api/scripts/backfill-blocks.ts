/**
 * One-shot maintenance script: for every paper whose blocks_object_key is
 * populated but the `blocks` table is empty, download blocks.json from
 * MinIO, parse it, and bulk-insert. Useful after introducing the blocks
 * table on top of papers that finished parsing under the old worker.
 *
 * Run with: bun apps/api/scripts/backfill-blocks.ts
 */
import { blocks as blocksTable, papers } from "@sapientia/db"
import { count, eq, isNotNull } from "drizzle-orm"
import { closeDb, db } from "../src/db"
import { logger } from "../src/logger"
import { parseContentList } from "../src/services/block-parser"
import { downloadFromS3 } from "../src/services/s3-client"

async function main() {
	const candidates = await db
		.select({ id: papers.id, blocksKey: papers.blocksObjectKey, title: papers.title })
		.from(papers)
		.where(isNotNull(papers.blocksObjectKey))

	for (const paper of candidates) {
		const [{ value: existing }] = await db
			.select({ value: count() })
			.from(blocksTable)
			.where(eq(blocksTable.paperId, paper.id))

		if (existing > 0) {
			logger.info({ paperId: paper.id, existing }, "blocks_already_present_skipping")
			continue
		}

		try {
			const bytes = await downloadFromS3(paper.blocksKey as string)
			const parsed = parseContentList(bytes)
			if (parsed.length === 0) {
				logger.warn({ paperId: paper.id }, "parsed_zero_blocks")
				continue
			}
			await db.insert(blocksTable).values(parsed.map((b) => ({ ...b, paperId: paper.id })))
			logger.info(
				{ paperId: paper.id, title: paper.title, count: parsed.length },
				"backfilled_blocks",
			)
		} catch (error) {
			logger.error({ paperId: paper.id, err: (error as Error).message }, "backfill_failed")
		}
	}

	await closeDb()
}

await main()
