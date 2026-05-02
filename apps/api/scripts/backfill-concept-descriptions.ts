/**
 * Backfill source-level concept descriptions for existing compiled local concepts.
 *
 * Run with:
 *   set -a && source apps/api/.env && set +a && pnpm --filter @sapientia/api exec tsx scripts/backfill-concept-descriptions.ts
 *
 * Options:
 *   --paper <paperId>
 *   --workspace <workspaceId>
 *   --user <userId>
 *   --force
 *   --dry-run
 */
import { compiledLocalConcepts } from "@sapientia/db"
import { and, eq, isNull } from "drizzle-orm"
import { closeDb, db } from "../src/db"
import { compilePaperConceptDescriptions } from "../src/services/concept-description"

async function main() {
	const options = parseArgs(process.argv.slice(2))
	const rows = await db
		.select({
			paperId: compiledLocalConcepts.paperId,
			userId: compiledLocalConcepts.ownerUserId,
			workspaceId: compiledLocalConcepts.workspaceId,
		})
		.from(compiledLocalConcepts)
		.where(
			and(
				isNull(compiledLocalConcepts.deletedAt),
				options.paperId ? eq(compiledLocalConcepts.paperId, options.paperId) : undefined,
				options.workspaceId
					? eq(compiledLocalConcepts.workspaceId, options.workspaceId)
					: undefined,
				options.userId ? eq(compiledLocalConcepts.ownerUserId, options.userId) : undefined,
			),
		)
		.groupBy(
			compiledLocalConcepts.paperId,
			compiledLocalConcepts.ownerUserId,
			compiledLocalConcepts.workspaceId,
		)

	if (rows.length === 0) {
		console.log("No paper/workspace/user concept groups matched.")
		await closeDb()
		return
	}

	console.table(
		rows.map((row) => ({
			paperId: row.paperId,
			workspaceId: row.workspaceId,
			userId: row.userId,
		})),
	)

	if (options.dryRun) {
		console.log(`Dry run: ${rows.length} group(s) would be refreshed.`)
		await closeDb()
		return
	}

	let refreshed = 0
	let failed = 0
	let described = 0
	let skipped = 0
	let descriptionFailed = 0
	let readerSignals = 0

	for (const row of rows) {
		try {
			const result = await compilePaperConceptDescriptions({
				paperId: row.paperId,
				userId: row.userId,
				workspaceId: row.workspaceId,
				force: options.force,
			})
			console.log(
				`refreshed concept descriptions for paper ${row.paperId} in workspace ${row.workspaceId} (${result.describedConceptCount} described, ${result.skippedConceptCount} skipped, ${result.failedConceptCount} failed)`,
			)
			refreshed += 1
			described += result.describedConceptCount
			skipped += result.skippedConceptCount
			descriptionFailed += result.failedConceptCount
			readerSignals += result.readerSignalConceptCount
		} catch (error) {
			failed += 1
			console.error(`failed concept description refresh for paper ${row.paperId}`, error)
		}
	}

	console.table([{ refreshed, failed, described, skipped, descriptionFailed, readerSignals }])

	await closeDb()
}

function parseArgs(args: string[]) {
	const options: {
		paperId?: string
		workspaceId?: string
		userId?: string
		force: boolean
		dryRun: boolean
	} = {
		force: false,
		dryRun: false,
	}

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]
		if (arg === "--force") {
			options.force = true
			continue
		}
		if (arg === "--dry-run") {
			options.dryRun = true
			continue
		}
		if (arg === "--paper") {
			options.paperId = readOptionValue(args, index, arg)
			index += 1
			continue
		}
		if (arg === "--workspace") {
			options.workspaceId = readOptionValue(args, index, arg)
			index += 1
			continue
		}
		if (arg === "--user") {
			options.userId = readOptionValue(args, index, arg)
			index += 1
			continue
		}
		throw new Error(`Unknown option: ${arg}`)
	}

	return options
}

function readOptionValue(args: string[], index: number, option: string) {
	const value = args[index + 1]
	if (!value || value.startsWith("--")) {
		throw new Error(`Missing value for ${option}`)
	}
	return value
}

await main()
