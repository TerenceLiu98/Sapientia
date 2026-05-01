/**
 * Audit TASK-020B concept salience coverage and freshness.
 *
 * Run with:
 *   set -a && source apps/api/.env && set +a && bun apps/api/scripts/audit-concept-salience.ts
 */
import {
	blockHighlights,
	compiledLocalConcepts,
	noteBlockRefs,
	notes,
	papers,
} from "@sapientia/db"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { closeDb, db } from "../src/db"

async function main() {
	const conceptRows = await db
		.select({
			paperId: compiledLocalConcepts.paperId,
			userId: compiledLocalConcepts.ownerUserId,
			workspaceId: compiledLocalConcepts.workspaceId,
			updatedAt: compiledLocalConcepts.updatedAt,
			salienceScore: compiledLocalConcepts.salienceScore,
			highlightCount: compiledLocalConcepts.highlightCount,
			noteCitationCount: compiledLocalConcepts.noteCitationCount,
		})
		.from(compiledLocalConcepts)
		.where(isNull(compiledLocalConcepts.deletedAt))

	const groups = new Map<
		string,
		{
			paperId: string
			userId: string
			workspaceId: string
			latestConceptUpdatedAt: Date | null
			nonZeroConceptCount: number
			totalConceptCount: number
		}
	>()
	for (const row of conceptRows) {
		const key = `${row.paperId}::${row.workspaceId}::${row.userId}`
		const existing = groups.get(key) ?? {
			paperId: row.paperId,
			userId: row.userId,
			workspaceId: row.workspaceId,
			latestConceptUpdatedAt: null,
			nonZeroConceptCount: 0,
			totalConceptCount: 0,
		}
		existing.totalConceptCount += 1
		if (
			row.salienceScore > 0 ||
			row.highlightCount > 0 ||
			row.noteCitationCount > 0
		) {
			existing.nonZeroConceptCount += 1
		}
		if (!existing.latestConceptUpdatedAt || row.updatedAt > existing.latestConceptUpdatedAt) {
			existing.latestConceptUpdatedAt = row.updatedAt
		}
		groups.set(key, existing)
	}

	const rows = [...groups.values()]
	const paperIds = [...new Set(rows.map((row) => row.paperId))]
	const papersById = new Map(
		(
			await db
				.select({ id: papers.id, title: papers.title })
				.from(papers)
				.where(inArray(papers.id, paperIds))
		).map((row) => [row.id, row.title]),
	)

	let totalGroups = 0
	let groupsWithMarginalia = 0
	let healthy = 0
	let noMarginalia = 0
	let stale = 0
	let zeroed = 0

	const problemRows: Array<{
		paperId: string
		title: string
		workspaceId: string
		status: string
		totalConcepts: number
		nonZeroConcepts: number
	}> = []

	for (const row of rows) {
		totalGroups += 1
		const highlightStats = await db
			.select({
				count: blockHighlights.id,
				updatedAt: blockHighlights.updatedAt,
			})
			.from(blockHighlights)
			.where(
				and(
					eq(blockHighlights.paperId, row.paperId),
					eq(blockHighlights.workspaceId, row.workspaceId),
					eq(blockHighlights.userId, row.userId),
				),
			)

		const noteStats = await db
			.select({
				noteId: noteBlockRefs.noteId,
				blockId: noteBlockRefs.blockId,
				updatedAt: notes.updatedAt,
			})
			.from(noteBlockRefs)
			.innerJoin(notes, eq(notes.id, noteBlockRefs.noteId))
			.where(
				and(
					eq(noteBlockRefs.paperId, row.paperId),
					eq(notes.paperId, row.paperId),
					eq(notes.workspaceId, row.workspaceId),
					eq(notes.ownerUserId, row.userId),
					isNull(notes.deletedAt),
				),
			)

		const latestMarginaliaAt = [...highlightStats, ...noteStats].reduce<Date | null>(
			(latest, item) => {
				const candidate = item.updatedAt
				if (!candidate) return latest
				if (!latest || candidate > latest) return candidate
				return latest
			},
			null,
		)

		const marginaliaCount = highlightStats.length + noteStats.length
		if (marginaliaCount === 0) {
			noMarginalia += 1
			continue
		}

		groupsWithMarginalia += 1
		const isStale =
			latestMarginaliaAt &&
			row.latestConceptUpdatedAt &&
			latestMarginaliaAt > row.latestConceptUpdatedAt
		const isZeroed = row.nonZeroConceptCount === 0

		if (!isStale && !isZeroed) {
			healthy += 1
			continue
		}

		if (isStale) stale += 1
		if (isZeroed) zeroed += 1

		problemRows.push({
			paperId: row.paperId,
			title: papersById.get(row.paperId) ?? "(untitled paper)",
			workspaceId: row.workspaceId,
			status: isStale ? "stale" : "zeroed",
			totalConcepts: row.totalConceptCount,
			nonZeroConcepts: row.nonZeroConceptCount,
		})
	}

	console.log("concept salience audit")
	console.table([
		{
			total_groups: totalGroups,
			groups_with_marginalia: groupsWithMarginalia,
			healthy,
			no_marginalia: noMarginalia,
			stale,
			zeroed,
		},
	])

	if (problemRows.length > 0) {
		console.log("problem concept groups")
		console.table(problemRows.slice(0, 25))
	} else {
		console.log("No stale/zeroed concept salience rows found for marginalia-bearing papers.")
	}

	await closeDb()
}

await main()
