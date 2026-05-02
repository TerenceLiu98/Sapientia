/**
 * Backfill local concept embeddings from existing source-level descriptions.
 *
 * Run with:
 *   set -a && source apps/api/.env && set +a && pnpm --filter @sapientia/api exec tsx scripts/backfill-concept-embeddings.ts
 *
 * Options:
 *   --workspace <workspaceId>
 *   --user <userId>
 *   --limit <count>
 *   --force
 *   --dry-run
 */
import { compiledLocalConcepts } from "@sapientia/db"
import { and, eq, isNotNull, isNull } from "drizzle-orm"
import { closeDb, db } from "../src/db"
import {
	compileWorkspaceConceptEmbeddings,
	EmbeddingCredentialMissingError,
} from "../src/services/concept-embeddings"

async function main() {
	const options = parseArgs(process.argv.slice(2))
	const rows = await db
		.select({
			userId: compiledLocalConcepts.ownerUserId,
			workspaceId: compiledLocalConcepts.workspaceId,
		})
		.from(compiledLocalConcepts)
		.where(
			and(
				isNull(compiledLocalConcepts.deletedAt),
				eq(compiledLocalConcepts.sourceLevelDescriptionStatus, "done"),
				isNotNull(compiledLocalConcepts.sourceLevelDescription),
				options.workspaceId
					? eq(compiledLocalConcepts.workspaceId, options.workspaceId)
					: undefined,
				options.userId ? eq(compiledLocalConcepts.ownerUserId, options.userId) : undefined,
			),
		)
		.groupBy(compiledLocalConcepts.ownerUserId, compiledLocalConcepts.workspaceId)

	if (rows.length === 0) {
		console.log("No workspace/user concept groups with descriptions matched.")
		await closeDb()
		return
	}

	console.table(rows)
	if (options.dryRun) {
		console.log(`Dry run: ${rows.length} workspace(s) would be embedded.`)
		await closeDb()
		return
	}

	let refreshed = 0
	let failed = 0
	let skippedWorkspaces = 0
	let embedded = 0
	let skipped = 0
	for (const row of rows) {
		try {
			const result = await compileWorkspaceConceptEmbeddings({
				userId: row.userId,
				workspaceId: row.workspaceId,
				force: options.force,
				limit: options.limit,
			})
			console.log(
				`embedded concepts for ${row.workspaceId} (${result.embeddedConceptCount} embedded, ${result.skippedConceptCount} skipped)`,
			)
			refreshed += 1
			embedded += result.embeddedConceptCount
			skipped += result.skippedConceptCount
		} catch (error) {
			if (error instanceof EmbeddingCredentialMissingError) {
				skippedWorkspaces += 1
				console.error(`missing embedding credentials for ${row.workspaceId}`)
			} else {
				failed += 1
				console.error(`failed embedding refresh for ${row.workspaceId}`, error)
			}
		}
	}

	console.table([{ refreshed, failed, skippedWorkspaces, embedded, skipped }])
	await closeDb()
}

function parseArgs(args: string[]) {
	const options: {
		workspaceId?: string
		userId?: string
		limit?: number
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
		if (arg === "--limit") {
			options.limit = Number(readOptionValue(args, index, arg))
			index += 1
			continue
		}
		if (arg === "--dry-run") {
			options.dryRun = true
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
