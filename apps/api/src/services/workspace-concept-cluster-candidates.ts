import {
	compiledLocalConceptEmbeddings,
	compiledLocalConcepts,
	papers,
	workspaceConceptClusterCandidates,
	workspaceConceptClusterMembers,
} from "@sapientia/db"
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { db } from "../db"
import { getEmbeddingCredential } from "./credentials"

type ConceptKind = "concept" | "method" | "task" | "metric"
type CandidateDecisionStatus = "needs_review"

const CANDIDATE_KINDS = new Set<ConceptKind>(["concept", "method", "task", "metric"])
const LEXICAL_PROMPT_VERSION = "semantic-candidate-lexical-v1"
const EMBEDDING_PROMPT_VERSION = "semantic-candidate-embedding-v1"
const NEEDS_REVIEW_THRESHOLD = 0.48
const MAX_CANDIDATES_PER_SOURCE = 6
const EMBEDDING_NEEDS_REVIEW_THRESHOLD = 0.72
const EMBEDDING_TOP_K = 12

export type LocalConceptForCandidate = {
	id: string
	paperId: string
	paperTitle: string
	kind: ConceptKind
	canonicalName: string
	displayName: string
	sourceLevelDescription: string | null
	salienceScore: number
}

type CandidateDraft = {
	sourceLocalConceptId: string
	targetLocalConceptId: string
	sourceClusterId: string | null
	targetClusterId: string | null
	kind: ConceptKind
	similarityScore: number
	decisionStatus: CandidateDecisionStatus
	rationale: string
	matchMethod?: "lexical_source_description" | "embedding"
	modelName?: string
	promptVersion?: string
}

type EmbeddingCandidateRow = {
	local_concept_id: string
	similarity_score: number
}

export async function compileWorkspaceConceptClusterCandidates(args: {
	workspaceId: string
	userId: string
}) {
	const { workspaceId, userId } = args

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
				eq(compiledLocalConcepts.ownerUserId, userId),
				isNull(compiledLocalConcepts.deletedAt),
				isNull(papers.deletedAt),
			),
		)
		.orderBy(desc(compiledLocalConcepts.salienceScore))

	const graphConcepts: LocalConceptForCandidate[] = concepts.flatMap((concept) => {
		if (!CANDIDATE_KINDS.has(concept.kind as ConceptKind)) return []
		if (!concept.sourceLevelDescription?.trim()) return []
		return [{ ...concept, kind: concept.kind as ConceptKind }]
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

	const embeddingDrafts = await buildWorkspaceConceptClusterCandidatesFromEmbeddings({
		workspaceId,
		userId,
		concepts: graphConcepts,
		clusterIdByLocalConceptId,
	})
	const candidateDrafts =
		embeddingDrafts.length > 0
			? embeddingDrafts
			: buildWorkspaceConceptClusterCandidates(graphConcepts, clusterIdByLocalConceptId)

	await db.transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtext(${`workspace-concept-cluster-candidates:${workspaceId}:${userId}`}))`,
		)

		await tx
			.delete(workspaceConceptClusterCandidates)
			.where(
				and(
					eq(workspaceConceptClusterCandidates.workspaceId, workspaceId),
					eq(workspaceConceptClusterCandidates.ownerUserId, userId),
					or(
						eq(workspaceConceptClusterCandidates.decisionStatus, "candidate"),
						eq(workspaceConceptClusterCandidates.decisionStatus, "needs_review"),
						eq(workspaceConceptClusterCandidates.decisionStatus, "auto_accepted"),
					),
				),
			)

		if (candidateDrafts.length === 0) return

		await tx.insert(workspaceConceptClusterCandidates).values(
			candidateDrafts.map((candidate) => ({
				workspaceId,
				ownerUserId: userId,
				sourceLocalConceptId: candidate.sourceLocalConceptId,
				targetLocalConceptId: candidate.targetLocalConceptId,
				sourceClusterId: candidate.sourceClusterId,
				targetClusterId: candidate.targetClusterId,
				kind: candidate.kind,
				matchMethod: candidate.matchMethod ?? ("lexical_source_description" as const),
				similarityScore: candidate.similarityScore,
				decisionStatus: candidate.decisionStatus,
				rationale: candidate.rationale,
				modelName: candidate.modelName ?? "deterministic",
				promptVersion: candidate.promptVersion ?? LEXICAL_PROMPT_VERSION,
			})),
		)
	})

	return {
		workspaceId,
		candidateCount: candidateDrafts.length,
	}
}

async function buildWorkspaceConceptClusterCandidatesFromEmbeddings(args: {
	workspaceId: string
	userId: string
	concepts: LocalConceptForCandidate[]
	clusterIdByLocalConceptId: Map<string, string>
}): Promise<CandidateDraft[]> {
	const credential = await getEmbeddingCredential(args.userId)
	if (!credential || args.concepts.length === 0) return []

	const conceptById = new Map(args.concepts.map((concept) => [concept.id, concept] as const))
	const draftsByPairKey = new Map<string, CandidateDraft>()

	for (const source of args.concepts) {
		const rows = await findNearestEmbeddedConcepts({
			workspaceId: args.workspaceId,
			userId: args.userId,
			source,
			provider: credential.provider,
			model: credential.model,
			limit: EMBEDDING_TOP_K * 2,
		})

		let keptForSource = 0
		for (const row of rows) {
			if (keptForSource >= EMBEDDING_TOP_K) break
			const target = conceptById.get(row.local_concept_id)
			if (!target) continue
			if (source.id === target.id) continue
			if (source.kind !== target.kind) continue
			if (source.paperId === target.paperId) continue

			const sourceClusterId = args.clusterIdByLocalConceptId.get(source.id) ?? null
			const targetClusterId = args.clusterIdByLocalConceptId.get(target.id) ?? null
			if (sourceClusterId && targetClusterId && sourceClusterId === targetClusterId) continue

			const similarityScore = Number(row.similarity_score)
			if (!Number.isFinite(similarityScore)) continue
			if (similarityScore < EMBEDDING_NEEDS_REVIEW_THRESHOLD) continue

			const [orderedSource, orderedTarget, orderedSourceClusterId, orderedTargetClusterId] =
				orderCandidatePair(source, target, sourceClusterId, targetClusterId)
			const pairKey = `${orderedSource.id}::${orderedTarget.id}`
			const draft: CandidateDraft = {
				sourceLocalConceptId: orderedSource.id,
				targetLocalConceptId: orderedTarget.id,
				sourceClusterId: orderedSourceClusterId,
					targetClusterId: orderedTargetClusterId,
					kind: orderedSource.kind,
					similarityScore: roundScore(similarityScore),
					decisionStatus: "needs_review",
					rationale: `embedding=${roundScore(similarityScore)}`,
					matchMethod: "embedding",
					modelName: credential.model,
				promptVersion: EMBEDDING_PROMPT_VERSION,
			}
			const existing = draftsByPairKey.get(pairKey)
			if (!existing || existing.similarityScore < draft.similarityScore) {
				draftsByPairKey.set(pairKey, draft)
			}
			keptForSource += 1
		}
	}

	return [...draftsByPairKey.values()].sort((a, b) => b.similarityScore - a.similarityScore)
}

async function findNearestEmbeddedConcepts(args: {
	workspaceId: string
	userId: string
	source: LocalConceptForCandidate
	provider: string
	model: string
	limit: number
}) {
	const result = await db.execute(sql`
		with source_embedding as (
			select embedding
			from ${compiledLocalConceptEmbeddings}
			where
				local_concept_id = ${args.source.id}
				and workspace_id = ${args.workspaceId}
				and owner_user_id = ${args.userId}
				and embedding_provider = ${args.provider}
				and embedding_model = ${args.model}
				and deleted_at is null
			order by updated_at desc
			limit 1
		)
		select
			target.local_concept_id,
			1 - (target.embedding <=> source_embedding.embedding) as similarity_score
		from ${compiledLocalConceptEmbeddings} target
		inner join ${compiledLocalConcepts} concept
			on concept.id = target.local_concept_id
		cross join source_embedding
		where
			target.workspace_id = ${args.workspaceId}
			and target.owner_user_id = ${args.userId}
			and target.embedding_provider = ${args.provider}
			and target.embedding_model = ${args.model}
			and target.deleted_at is null
			and concept.deleted_at is null
			and concept.kind = ${args.source.kind}
			and concept.paper_id <> ${args.source.paperId}
			and target.local_concept_id <> ${args.source.id}
		order by target.embedding <=> source_embedding.embedding
		limit ${args.limit}
	`)
	return Array.from(result as Iterable<EmbeddingCandidateRow>)
}

export function buildWorkspaceConceptClusterCandidates(
	concepts: LocalConceptForCandidate[],
	clusterIdByLocalConceptId: Map<string, string>,
): CandidateDraft[] {
	const draftsBySource = new Map<string, CandidateDraft[]>()
	const sortedConcepts = [...concepts].sort((a, b) => a.id.localeCompare(b.id))

	for (let i = 0; i < sortedConcepts.length; i += 1) {
		for (let j = i + 1; j < sortedConcepts.length; j += 1) {
			const source = sortedConcepts[i]
			const target = sortedConcepts[j]
			if (source.kind !== target.kind) continue
			if (source.paperId === target.paperId) continue

			const sourceClusterId = clusterIdByLocalConceptId.get(source.id) ?? null
			const targetClusterId = clusterIdByLocalConceptId.get(target.id) ?? null
			if (sourceClusterId && targetClusterId && sourceClusterId === targetClusterId) continue

			const similarity = scoreWorkspaceConceptClusterCandidateSimilarity(source, target)
			if (similarity.score < NEEDS_REVIEW_THRESHOLD) continue

			const [orderedSource, orderedTarget, orderedSourceClusterId, orderedTargetClusterId] =
				orderCandidatePair(source, target, sourceClusterId, targetClusterId)
			const draft: CandidateDraft = {
				sourceLocalConceptId: orderedSource.id,
				targetLocalConceptId: orderedTarget.id,
				sourceClusterId: orderedSourceClusterId,
					targetClusterId: orderedTargetClusterId,
					kind: orderedSource.kind,
					similarityScore: roundScore(similarity.score),
					decisionStatus: "needs_review",
					rationale: similarity.rationale,
				}

			const bucket = draftsBySource.get(draft.sourceLocalConceptId) ?? []
			bucket.push(draft)
			draftsBySource.set(draft.sourceLocalConceptId, bucket)
		}
	}

	return [...draftsBySource.values()]
		.flatMap((drafts) =>
			drafts
				.sort((a, b) => b.similarityScore - a.similarityScore)
				.slice(0, MAX_CANDIDATES_PER_SOURCE),
		)
		.sort((a, b) => b.similarityScore - a.similarityScore)
}

export function scoreWorkspaceConceptClusterCandidateSimilarity(
	source: LocalConceptForCandidate,
	target: LocalConceptForCandidate,
) {
	const sourceName = `${source.displayName} ${source.canonicalName}`
	const targetName = `${target.displayName} ${target.canonicalName}`
	const nameScore = tokenJaccard(sourceName, targetName)
	const descriptionScore = tokenCosine(
		source.sourceLevelDescription ?? "",
		target.sourceLevelDescription ?? "",
	)
	const containmentScore = tokenContainment(sourceName, targetName)
	const score = Math.max(
		0.5 * descriptionScore + 0.35 * nameScore + 0.15 * containmentScore,
		0.65 * nameScore + 0.35 * descriptionScore,
	)
	const rationale = [
		`name=${roundScore(nameScore)}`,
		`description=${roundScore(descriptionScore)}`,
		`containment=${roundScore(containmentScore)}`,
	].join("; ")
	return { score, rationale }
}

function orderCandidatePair(
	source: LocalConceptForCandidate,
	target: LocalConceptForCandidate,
	sourceClusterId: string | null,
	targetClusterId: string | null,
): [LocalConceptForCandidate, LocalConceptForCandidate, string | null, string | null] {
	if (source.id.localeCompare(target.id) <= 0) {
		return [source, target, sourceClusterId, targetClusterId]
	}
	return [target, source, targetClusterId, sourceClusterId]
}

function tokenJaccard(a: string, b: string) {
	const aTokens = new Set(tokenize(a))
	const bTokens = new Set(tokenize(b))
	if (aTokens.size === 0 || bTokens.size === 0) return 0
	const intersection = [...aTokens].filter((token) => bTokens.has(token)).length
	const union = new Set([...aTokens, ...bTokens]).size
	return intersection / union
}

function tokenContainment(a: string, b: string) {
	const aTokens = new Set(tokenize(a))
	const bTokens = new Set(tokenize(b))
	if (aTokens.size === 0 || bTokens.size === 0) return 0
	const intersection = [...aTokens].filter((token) => bTokens.has(token)).length
	return intersection / Math.min(aTokens.size, bTokens.size)
}

function tokenCosine(a: string, b: string) {
	const aCounts = tokenCounts(a)
	const bCounts = tokenCounts(b)
	if (aCounts.size === 0 || bCounts.size === 0) return 0
	let dot = 0
	for (const [token, count] of aCounts) {
		dot += count * (bCounts.get(token) ?? 0)
	}
	const aNorm = Math.sqrt([...aCounts.values()].reduce((sum, count) => sum + count * count, 0))
	const bNorm = Math.sqrt([...bCounts.values()].reduce((sum, count) => sum + count * count, 0))
	if (aNorm === 0 || bNorm === 0) return 0
	return dot / (aNorm * bNorm)
}

function tokenCounts(value: string) {
	const counts = new Map<string, number>()
	for (const token of tokenize(value)) {
		counts.set(token, (counts.get(token) ?? 0) + 1)
	}
	return counts
}

function tokenize(value: string) {
	return value
		.toLowerCase()
		.replace(/&/g, " and ")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.split(/\s+/)
		.map((token) => token.trim())
		.filter((token) => token.length >= 3 && !STOPWORDS.has(token))
}

function roundScore(value: number) {
	return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000
}

const STOPWORDS = new Set([
	"the",
	"and",
	"for",
	"with",
	"that",
	"this",
	"from",
	"into",
	"used",
	"uses",
	"using",
	"paper",
	"method",
	"concept",
	"task",
	"metric",
	"model",
	"models",
	"system",
	"systems",
	"approach",
	"framework",
	"where",
	"which",
	"their",
	"they",
	"are",
	"was",
	"were",
])
