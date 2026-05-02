/**
 * Audit concept embedding coverage and candidate methods for a workspace.
 *
 * Run with:
 *   set -a && source apps/api/.env && set +a && pnpm --filter @sapientia/api exec tsx scripts/audit-concept-embeddings.ts --workspace <workspaceId>
 */
import {
	compiledLocalConceptEmbeddings,
	compiledLocalConcepts,
	workspaceConceptClusterCandidates,
} from "@sapientia/db"
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm"
import { closeDb, db } from "../src/db"
import { getCredentialsStatus } from "../src/services/credentials"

async function main() {
	const options = parseArgs(process.argv.slice(2))
	if (!options.workspaceId) throw new Error("Missing --workspace <workspaceId>")

	const owners = await db
		.select({ userId: compiledLocalConcepts.ownerUserId })
		.from(compiledLocalConcepts)
		.where(
			and(
				eq(compiledLocalConcepts.workspaceId, options.workspaceId),
				isNull(compiledLocalConcepts.deletedAt),
			),
		)
		.groupBy(compiledLocalConcepts.ownerUserId)

	for (const owner of owners) {
		const status = await getCredentialsStatus(owner.userId)
		console.log(`\nWorkspace ${options.workspaceId}`)
		console.table([
			{
				userId: owner.userId,
				embeddingProvider: status.embeddingProvider ?? "(not configured)",
				embeddingModel: status.embeddingModel ?? "(not configured)",
				embeddingBaseUrl: status.embeddingBaseUrl ?? "(default/not configured)",
				hasEmbeddingKey: status.hasEmbeddingKey,
			},
		])

		const [coverage] = await db
			.select({
				totalConcepts: sql<number>`count(*)`,
				describedConcepts: sql<number>`count(*) filter (where ${compiledLocalConcepts.sourceLevelDescriptionStatus} = 'done' and ${compiledLocalConcepts.sourceLevelDescription} is not null)`,
				graphConcepts: sql<number>`count(*) filter (where ${compiledLocalConcepts.kind} in ('concept', 'method', 'task', 'metric'))`,
			})
			.from(compiledLocalConcepts)
			.where(
				and(
					eq(compiledLocalConcepts.workspaceId, options.workspaceId),
					eq(compiledLocalConcepts.ownerUserId, owner.userId),
					isNull(compiledLocalConcepts.deletedAt),
				),
			)
		console.table([coverage])

		const embeddingRows = await db
			.select({
				provider: compiledLocalConceptEmbeddings.embeddingProvider,
				model: compiledLocalConceptEmbeddings.embeddingModel,
				dimensions: compiledLocalConceptEmbeddings.dimensions,
				count: sql<number>`count(*)`,
			})
			.from(compiledLocalConceptEmbeddings)
			.where(
				and(
					eq(compiledLocalConceptEmbeddings.workspaceId, options.workspaceId),
					eq(compiledLocalConceptEmbeddings.ownerUserId, owner.userId),
					isNull(compiledLocalConceptEmbeddings.deletedAt),
				),
			)
			.groupBy(
				compiledLocalConceptEmbeddings.embeddingProvider,
				compiledLocalConceptEmbeddings.embeddingModel,
				compiledLocalConceptEmbeddings.dimensions,
			)
		console.table(embeddingRows)

		const candidateRows = await db
			.select({
				matchMethod: workspaceConceptClusterCandidates.matchMethod,
				decisionStatus: workspaceConceptClusterCandidates.decisionStatus,
				count: sql<number>`count(*)`,
				avgScore: sql<string>`round(avg(${workspaceConceptClusterCandidates.similarityScore})::numeric, 3)`,
			})
			.from(workspaceConceptClusterCandidates)
			.where(
				and(
					eq(workspaceConceptClusterCandidates.workspaceId, options.workspaceId),
					eq(workspaceConceptClusterCandidates.ownerUserId, owner.userId),
					isNull(workspaceConceptClusterCandidates.deletedAt),
					isNotNull(workspaceConceptClusterCandidates.similarityScore),
				),
			)
			.groupBy(
				workspaceConceptClusterCandidates.matchMethod,
				workspaceConceptClusterCandidates.decisionStatus,
			)
		console.table(candidateRows)
	}

	await closeDb()
}

function parseArgs(args: string[]) {
	const options: { workspaceId?: string } = {}
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]
		if (arg === "--workspace") {
			options.workspaceId = readOptionValue(args, index, arg)
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
