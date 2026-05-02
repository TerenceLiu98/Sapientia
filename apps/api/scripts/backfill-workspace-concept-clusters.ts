/**
 * Backfill workspace concept clusters from existing compiled local concepts.
 *
 * Run with:
 *   set -a && source apps/api/.env && set +a && bun apps/api/scripts/backfill-workspace-concept-clusters.ts
 */
import { compiledLocalConcepts } from "@sapientia/db"
import { isNull } from "drizzle-orm"
import { closeDb, db } from "../src/db"
import { compileWorkspaceConceptClusters } from "../src/services/workspace-concept-clusters"

async function main() {
	const rows = await db
		.select({
			userId: compiledLocalConcepts.ownerUserId,
			workspaceId: compiledLocalConcepts.workspaceId,
		})
		.from(compiledLocalConcepts)
		.where(isNull(compiledLocalConcepts.deletedAt))
		.groupBy(compiledLocalConcepts.ownerUserId, compiledLocalConcepts.workspaceId)

	let refreshed = 0
	let failed = 0

	for (const row of rows) {
		try {
			const result = await compileWorkspaceConceptClusters({
				userId: row.userId,
				workspaceId: row.workspaceId,
			})
			console.log(
				`refreshed workspace concept clusters for ${row.workspaceId} (${result.clusterCount} clusters, ${result.memberCount} members)`,
			)
			refreshed += 1
		} catch (error) {
			failed += 1
			console.error(`failed workspace concept cluster refresh for ${row.workspaceId}`, error)
		}
	}

	console.table([{ refreshed, failed }])

	await closeDb()
}

await main()
