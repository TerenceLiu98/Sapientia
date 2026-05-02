import {
	compiledLocalConceptEvidence,
	compiledLocalConcepts,
	papers,
	workspaceConceptClusterCandidates,
} from "@sapientia/db"
import { fillPrompt, loadPrompt } from "@sapientia/shared"
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "../db"
import { getLlmCredential } from "./credentials"
import { completeObject, LlmCredentialMissingError } from "./llm-client"

export const SEMANTIC_CANDIDATE_JUDGEMENT_PROMPT_VERSION = "semantic-candidate-judgement-v1"

const MAX_CANDIDATES_PER_JUDGEMENT_CALL = 32
const DEFAULT_MAX_CANDIDATES_PER_RUN = 500
const LLM_CONFIRMATION_CONFIDENCE_THRESHOLD = 0.8
const EVIDENCE_SNIPPETS_PER_SIDE = 1

const semanticCandidateJudgementOutputSchema = z.object({
	judgements: z.array(
		z.object({
			candidateId: z.string().uuid(),
			decision: z.enum(["same", "related", "different", "uncertain"]),
			confidence: z.number().finite().min(0).max(1),
			rationale: z.string().trim().min(1).max(600),
		}),
	),
})

type SemanticCandidateJudgementOutput = z.infer<typeof semanticCandidateJudgementOutputSchema>

export async function judgeWorkspaceSemanticCandidates(args: {
	workspaceId: string
	userId: string
	limit?: number
	force?: boolean
}) {
	const credential = await getLlmCredential(args.userId)
	if (!credential) throw new LlmCredentialMissingError()

	const limit = Math.max(
		1,
		Math.min(args.limit ?? DEFAULT_MAX_CANDIDATES_PER_RUN, DEFAULT_MAX_CANDIDATES_PER_RUN),
	)
	const candidates = await db
		.select({
			id: workspaceConceptClusterCandidates.id,
			sourceLocalConceptId: workspaceConceptClusterCandidates.sourceLocalConceptId,
			targetLocalConceptId: workspaceConceptClusterCandidates.targetLocalConceptId,
			kind: workspaceConceptClusterCandidates.kind,
			matchMethod: workspaceConceptClusterCandidates.matchMethod,
			similarityScore: workspaceConceptClusterCandidates.similarityScore,
			rationale: workspaceConceptClusterCandidates.rationale,
			llmDecision: workspaceConceptClusterCandidates.llmDecision,
		})
		.from(workspaceConceptClusterCandidates)
		.where(
			and(
				eq(workspaceConceptClusterCandidates.workspaceId, args.workspaceId),
				eq(workspaceConceptClusterCandidates.ownerUserId, args.userId),
				or(
					eq(workspaceConceptClusterCandidates.decisionStatus, "candidate"),
					eq(workspaceConceptClusterCandidates.decisionStatus, "needs_review"),
				),
				args.force ? sql`true` : isNull(workspaceConceptClusterCandidates.llmDecision),
				isNull(workspaceConceptClusterCandidates.deletedAt),
			),
		)
		.orderBy(desc(workspaceConceptClusterCandidates.similarityScore))
		.limit(limit)

	if (candidates.length === 0) {
		return {
			workspaceId: args.workspaceId,
			judgedCount: 0,
			skippedCount: 0,
		}
	}

	const localConceptIds = [
		...new Set(
			candidates.flatMap((candidate) => [
				candidate.sourceLocalConceptId,
				candidate.targetLocalConceptId,
			]),
		),
	]
	const concepts = await db
		.select({
			id: compiledLocalConcepts.id,
			displayName: compiledLocalConcepts.displayName,
			canonicalName: compiledLocalConcepts.canonicalName,
			kind: compiledLocalConcepts.kind,
			sourceLevelDescription: compiledLocalConcepts.sourceLevelDescription,
			paperTitle: papers.title,
		})
		.from(compiledLocalConcepts)
		.innerJoin(papers, eq(papers.id, compiledLocalConcepts.paperId))
		.where(
			and(
				inArray(compiledLocalConcepts.id, localConceptIds),
				isNull(compiledLocalConcepts.deletedAt),
				isNull(papers.deletedAt),
			),
		)
	const conceptById = new Map(concepts.map((concept) => [concept.id, concept] as const))
	const evidenceRows = await db
		.select({
			conceptId: compiledLocalConceptEvidence.conceptId,
			snippet: compiledLocalConceptEvidence.snippet,
			blockId: compiledLocalConceptEvidence.blockId,
			confidence: compiledLocalConceptEvidence.confidence,
		})
		.from(compiledLocalConceptEvidence)
		.where(inArray(compiledLocalConceptEvidence.conceptId, localConceptIds))
	const evidenceSnippetsByConceptId = new Map<
		string,
		Array<{ blockId: string; snippet: string; confidence: number | null }>
	>()
	for (const row of evidenceRows) {
		const snippet = row.snippet?.replace(/\s+/g, " ").trim()
		if (!snippet) continue
		const bucket = evidenceSnippetsByConceptId.get(row.conceptId) ?? []
		if (bucket.length >= EVIDENCE_SNIPPETS_PER_SIDE) continue
		bucket.push({ blockId: row.blockId, snippet, confidence: row.confidence })
		evidenceSnippetsByConceptId.set(row.conceptId, bucket)
	}
	const promptItems = candidates.flatMap((candidate) => {
		const source = conceptById.get(candidate.sourceLocalConceptId)
		const target = conceptById.get(candidate.targetLocalConceptId)
		if (!source?.sourceLevelDescription || !target?.sourceLevelDescription) return []
		return [
			{
				candidateId: candidate.id,
				kind: candidate.kind,
				retrieval: {
					matchMethod: candidate.matchMethod,
					similarityScore: candidate.similarityScore,
					rationale: candidate.rationale,
				},
				source: formatConceptForPrompt(
					source,
					evidenceSnippetsByConceptId.get(candidate.sourceLocalConceptId) ?? [],
				),
				target: formatConceptForPrompt(
					target,
					evidenceSnippetsByConceptId.get(candidate.targetLocalConceptId) ?? [],
				),
			},
		]
	})

	if (promptItems.length === 0) {
		return {
			workspaceId: args.workspaceId,
			judgedCount: 0,
			skippedCount: candidates.length,
		}
	}

	let judgedCount = 0
	for (const batch of chunk(promptItems, MAX_CANDIDATES_PER_JUDGEMENT_CALL)) {
		const prompt = fillPrompt(loadPrompt(SEMANTIC_CANDIDATE_JUDGEMENT_PROMPT_VERSION), {
			candidates: JSON.stringify(batch, null, 2),
		})
		const result = await completeObject({
			userId: args.userId,
			workspaceId: args.workspaceId,
			promptId: SEMANTIC_CANDIDATE_JUDGEMENT_PROMPT_VERSION,
			model: credential.model,
			messages: [{ role: "user", content: prompt }],
			schema: semanticCandidateJudgementOutputSchema,
			maxTokens: 8_000,
			temperature: 0.1,
		})
		const updateResult = await applySemanticCandidateJudgements({
			output: result.object,
			candidateIds: new Set(batch.map((item) => item.candidateId)),
			model: result.model,
		})
		judgedCount += updateResult.judgedCount
	}

	return {
		workspaceId: args.workspaceId,
		judgedCount,
		skippedCount: candidates.length - judgedCount,
	}
}

export async function applySemanticCandidateJudgements(args: {
	output: SemanticCandidateJudgementOutput
	candidateIds: Set<string>
	model: string
}) {
	let judgedCount = 0
	const now = new Date()
	for (const judgement of args.output.judgements) {
		if (!args.candidateIds.has(judgement.candidateId)) continue
		const [updated] = await db
			.update(workspaceConceptClusterCandidates)
			.set({
				llmDecision: judgement.decision,
				llmConfidence: judgement.confidence,
				decisionStatus: semanticCandidateStatusForJudgement(judgement),
				rationale: formatJudgementRationale(judgement),
				modelName: args.model,
				promptVersion: SEMANTIC_CANDIDATE_JUDGEMENT_PROMPT_VERSION,
				updatedAt: now,
			})
			.where(
				and(
					eq(workspaceConceptClusterCandidates.id, judgement.candidateId),
					or(
						eq(workspaceConceptClusterCandidates.decisionStatus, "candidate"),
						eq(workspaceConceptClusterCandidates.decisionStatus, "needs_review"),
					),
					isNull(workspaceConceptClusterCandidates.deletedAt),
				),
			)
			.returning({ id: workspaceConceptClusterCandidates.id })
		if (updated) judgedCount += 1
	}
	return { judgedCount }
}

function formatConceptForPrompt(
	concept: {
		displayName: string
		canonicalName: string
		kind: string
		sourceLevelDescription: string | null
		paperTitle: string | null
	},
	evidenceSnippets: Array<{ blockId: string; snippet: string; confidence: number | null }>,
) {
	return {
		name: concept.displayName,
		canonicalName: concept.canonicalName,
		kind: concept.kind,
		paperTitle: concept.paperTitle,
		sourceLevelDescription: concept.sourceLevelDescription,
		evidenceBlockSnippets: evidenceSnippets,
	}
}

function semanticCandidateStatusForJudgement(judgement: { decision: string; confidence: number }) {
	if (
		(judgement.decision === "same" || judgement.decision === "related") &&
		judgement.confidence >= LLM_CONFIRMATION_CONFIDENCE_THRESHOLD
	) {
		return "ai_confirmed" as const
	}
	return "ai_rejected" as const
}

function formatJudgementRationale(judgement: {
	decision: string
	confidence: number
	rationale: string
}) {
	return `llm=${judgement.decision}; confidence=${roundConfidence(judgement.confidence)}; ${judgement.rationale}`
}

function roundConfidence(value: number) {
	return Math.round(value * 100) / 100
}

function chunk<T>(items: T[], size: number) {
	const chunks: T[][] = []
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size))
	}
	return chunks
}
