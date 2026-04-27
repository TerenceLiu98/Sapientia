/**
 * Repair script for papers parsed with bad bbox normalization.
 * It reloads the stored MinerU zip, re-runs the current parser's bbox logic,
 * and rewrites only the bbox column by block_id. This lets us pick up parser
 * fixes (for example the VLM 1000x1000 canvas fallback) without touching
 * block ids or note references.
 *
 * Run with:
 *   bun apps/api/scripts/normalize-block-bboxes.ts
 * or
 *   node --experimental-strip-types apps/api/scripts/normalize-block-bboxes.ts
 */
import { blocks as blocksTable, papers } from "@sapientia/db"
import { and, eq, isNotNull } from "drizzle-orm"
import { closeDb, db } from "../src/db"
import { logger } from "../src/logger"
import { parseContentList } from "../src/services/block-parser"
import { extractMineruZip, parsePageSizes } from "../src/services/mineru-zip"
import { downloadFromS3 } from "../src/services/s3-client"

async function main() {
	const candidates = await db
		.select({
			id: papers.id,
			title: papers.title,
			ownerUserId: papers.ownerUserId,
		})
		.from(papers)
		.where(isNotNull(papers.blocksObjectKey))

	for (const paper of candidates) {
		const rows = await db
			.select({
				blockId: blocksTable.blockId,
				bbox: blocksTable.bbox,
			})
			.from(blocksTable)
			.where(and(eq(blocksTable.paperId, paper.id), isNotNull(blocksTable.bbox)))

		const zipKey = `papers/${paper.ownerUserId}/${paper.id}/mineru-result.zip`
		try {
			const zipBytes = await downloadFromS3(zipKey)
			const { contentList, middle, layout } = await extractMineruZip(Buffer.from(zipBytes))
			const reparsed = parseContentList(contentList, {
				pageSizesPx: parsePageSizes({ middle, layout }),
			})
			const reparsedById = new Map(reparsed.map((block) => [block.blockId, block.bbox]))
			let updated = 0
			let changed = 0

			for (const row of rows) {
				if (!reparsedById.has(row.blockId)) continue
				const nextBbox = reparsedById.get(row.blockId) ?? null
				await db
					.update(blocksTable)
					.set({ bbox: nextBbox })
					.where(and(eq(blocksTable.paperId, paper.id), eq(blocksTable.blockId, row.blockId)))
				updated += 1
				if (JSON.stringify(row.bbox) !== JSON.stringify(nextBbox)) changed += 1
			}

			logger.info(
				{ paperId: paper.id, title: paper.title, blockRows: rows.length, updated, changed },
				"normalized_block_bboxes",
			)
		} catch (error) {
			logger.warn(
				{ paperId: paper.id, zipKey, err: (error as Error).message },
				"normalize_block_bboxes_failed",
			)
		}
	}

	await closeDb()
}

await main()
