/**
 * Backfill workspace semantic concept-cluster candidates from existing source-level descriptions.
 *
 * Run with:
 *   set -a && source apps/api/.env && set +a && pnpm --filter @sapientia/api exec tsx scripts/backfill-workspace-concept-cluster-candidates.ts
 *
 * Options:
 *   --workspace <workspaceId>
 *   --user <userId>
 *   --compile-embeddings
 *   --dry-run
 */
import { compiledLocalConcepts } from "@sapientia/db"
import { and, eq, isNotNull, isNull } from "drizzle-orm"
import { closeDb, db } from "../src/db"
import {
	compileWorkspaceConceptEmbeddings,
	EmbeddingCredentialMissingError,
} from "../src/services/concept-embeddings"
import { compileWorkspaceConceptClusterCandidates } from "../src/services/workspace-concept-cluster-candidates"

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
		console.log(`Dry run: ${rows.length} workspace(s) would be refreshed.`)
		await closeDb()
		return
	}

	let refreshed = 0
	let failed = 0
	let candidates = 0
	for (const row of rows) {
		try {
			if (options.compileEmbeddings) {
				try {
					const embeddingResult = await compileWorkspaceConceptEmbeddings({
						userId: row.userId,
						workspaceId: row.workspaceId,
					})
					console.log(
						`embedded concepts for ${row.workspaceId} (${embeddingResult.embeddedConceptCount} embedded, ${embeddingResult.skippedConceptCount} skipped)`,
					)
				} catch (error) {
					if (error instanceof EmbeddingCredentialMissingError) {
						console.log(`skipping embeddings for ${row.workspaceId}: no embedding credentials`)
					} else {
						throw error
					}
				}
			}
			const result = await compileWorkspaceConceptClusterCandidates({
				userId: row.userId,
				workspaceId: row.workspaceId,
			})
			console.log(
				`refreshed candidate clusters for ${row.workspaceId} (${result.candidateCount} candidates)`,
			)
			refreshed += 1
			candidates += result.candidateCount
		} catch (error) {
			failed += 1
			console.error(`failed candidate refresh for ${row.workspaceId}`, error)
		}
	}

	console.table([{ refreshed, failed, candidates }])
	await closeDb()
}

function parseArgs(args: string[]) {
	const options: {
		workspaceId?: string
		userId?: string
		compileEmbeddings: boolean
		dryRun: boolean
	} = { compileEmbeddings: false, dryRun: false }
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]
		if (arg === "--compile-embeddings") {
			options.compileEmbeddings = true
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
