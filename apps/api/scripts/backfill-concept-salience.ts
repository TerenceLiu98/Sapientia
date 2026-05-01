/**
 * Backfill concept salience refinement for existing compiled concepts.
 *
 * Run with:
 *   set -a && source apps/api/.env && set +a && bun apps/api/scripts/backfill-concept-salience.ts
 */
import { compiledLocalConcepts } from "@sapientia/db"
import { isNull } from "drizzle-orm"
import { closeDb, db } from "../src/db"
import { refinePaperConceptSalience } from "../src/services/concept-refine"

async function main() {
	const rows = await db
		.select({
			paperId: compiledLocalConcepts.paperId,
			userId: compiledLocalConcepts.ownerUserId,
			workspaceId: compiledLocalConcepts.workspaceId,
		})
		.from(compiledLocalConcepts)
		.where(isNull(compiledLocalConcepts.deletedAt))
		.groupBy(
			compiledLocalConcepts.paperId,
			compiledLocalConcepts.ownerUserId,
			compiledLocalConcepts.workspaceId,
		)

	let enqueued = 0
	let failed = 0

	for (const row of rows) {
		try {
			const result = await refinePaperConceptSalience({
				paperId: row.paperId,
				userId: row.userId,
				workspaceId: row.workspaceId,
			})
			console.log(
				`refined concept salience for ${row.paperId} ${row.workspaceId} (${result.refinedConceptCount} concepts)`,
			)
			enqueued += 1
		} catch (error) {
			failed += 1
			console.error(`failed concept salience refine for ${row.paperId} ${row.workspaceId}`, error)
		}
	}

	console.table([
		{
			refined: enqueued,
			failed,
		},
	])

	await closeDb()
}

await main()
