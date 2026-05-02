/**
 * Audit deterministic semantic candidate scores without writing rows.
 *
 * Run with:
 *   set -a && source apps/api/.env && set +a && pnpm --filter @sapientia/api exec tsx scripts/audit-workspace-concept-cluster-candidates.ts --workspace <workspaceId>
 */
import {
	compiledLocalConcepts,
	papers,
	workspaceConceptClusterMembers,
} from "@sapientia/db"
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { closeDb, db } from "../src/db"
import {
	type LocalConceptForCandidate,
	scoreWorkspaceConceptClusterCandidateSimilarity,
} from "../src/services/workspace-concept-cluster-candidates"

const CANDIDATE_KINDS = new Set(["concept", "method", "task", "metric"])

async function main() {
	const options = parseArgs(process.argv.slice(2))
	const workspaceId = options.workspaceId
	if (!workspaceId) throw new Error("Missing --workspace <workspaceId>")

	const concepts = await db
		.select({
			id: compiledLocalConcepts.id,
			paperId: compiledLocalConcepts.paperId,
			paperTitle: papers.title,
			kind: compiledLocalConcepts.kind,
			canonicalName: compiledLocalConcepts.canonicalName,
			displayName: compiledLocalConcepts.displayName,
			sourceLevelDescription: compiledLocalConcepts.sourceLevelDescription,
			salienceScore: compiledLocalConcepts.salienceScore,
		})
		.from(compiledLocalConcepts)
		.innerJoin(papers, eq(papers.id, compiledLocalConcepts.paperId))
		.where(
			and(
				eq(compiledLocalConcepts.workspaceId, workspaceId),
				isNull(compiledLocalConcepts.deletedAt),
				isNull(papers.deletedAt),
			),
		)
		.orderBy(desc(compiledLocalConcepts.salienceScore))

	const graphConcepts: LocalConceptForCandidate[] = concepts.flatMap((concept) => {
		if (!CANDIDATE_KINDS.has(concept.kind)) return []
		if (!concept.sourceLevelDescription?.trim()) return []
		return [{ ...concept, kind: concept.kind as LocalConceptForCandidate["kind"] }]
	})
	const members = await db
		.select({
			localConceptId: workspaceConceptClusterMembers.localConceptId,
			clusterId: workspaceConceptClusterMembers.clusterId,
		})
		.from(workspaceConceptClusterMembers)
		.where(
			graphConcepts.length === 0
				? sql`false`
				: inArray(
						workspaceConceptClusterMembers.localConceptId,
						graphConcepts.map((concept) => concept.id),
					),
		)
	const clusterIdByLocalConceptId = new Map(
		members.map((member) => [member.localConceptId, member.clusterId] as const),
	)

	const pairs: Array<{
		kind: string
		score: number
		status: string
		source: string
		target: string
		sourcePaper: string
		targetPaper: string
		rationale: string
	}> = []

	for (let i = 0; i < graphConcepts.length; i += 1) {
		for (let j = i + 1; j < graphConcepts.length; j += 1) {
			const source = graphConcepts[i]
			const target = graphConcepts[j]
			if (source.kind !== target.kind) continue
			if (source.paperId === target.paperId) continue
			const sourceClusterId = clusterIdByLocalConceptId.get(source.id)
			const targetClusterId = clusterIdByLocalConceptId.get(target.id)
			if (sourceClusterId && targetClusterId && sourceClusterId === targetClusterId) continue
			const similarity = scoreWorkspaceConceptClusterCandidateSimilarity(source, target)
			if (similarity.score < options.minScore) continue
			pairs.push({
				kind: source.kind,
				score: Math.round(similarity.score * 1000) / 1000,
				status: similarity.score >= 0.62 ? "candidate" : "needs_review",
				source: source.displayName,
				target: target.displayName,
				sourcePaper: source.paperTitle,
				targetPaper: target.paperTitle,
				rationale: similarity.rationale,
			})
		}
	}

	const topPairs = pairs.sort((a, b) => b.score - a.score).slice(0, options.limit)
	console.table(
		Object.entries(
			pairs.reduce<Record<string, number>>((counts, pair) => {
				counts[pair.kind] = (counts[pair.kind] ?? 0) + 1
				return counts
			}, {}),
		).map(([kind, count]) => ({ kind, count })),
	)
	console.table(topPairs)
	await closeDb()
}

function parseArgs(args: string[]) {
	const options = { workspaceId: "", minScore: 0.35, limit: 30 }
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]
		if (arg === "--workspace") {
			options.workspaceId = readOptionValue(args, index, arg)
			index += 1
			continue
		}
		if (arg === "--min-score") {
			options.minScore = Number(readOptionValue(args, index, arg))
			index += 1
			continue
		}
		if (arg === "--limit") {
			options.limit = Number(readOptionValue(args, index, arg))
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
