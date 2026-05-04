import {
	compiledLocalConceptEvidence,
	compiledLocalConcepts,
	conceptObservations,
	papers,
	workspaceConceptClusterCandidates,
	workspaceConceptClusterMembers,
	workspacePaperGraphEdges,
	workspacePaperGraphSnapshots,
	workspacePapers,
} from "@sapientia/db"
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm"
import { db } from "../db"

const GRAPH_CONCEPT_KINDS = new Set(["concept", "method", "task", "metric"])
export const PAPER_GRAPH_CREATE_THRESHOLD = 0.7
export const PAPER_GRAPH_KEEP_THRESHOLD = 0.55
export const PAPER_GRAPH_STALE_RETENTION_DAYS = 14
const LLM_CONFIRMED_LINK_THRESHOLD = 0.8
const UNREVIEWED_SEMANTIC_LINK_THRESHOLD = 0.55
const HIGH_SIMILARITY_SEMANTIC_LINK_THRESHOLD = 0.78

export async function loadStablePaperGraphPayload(args: { workspaceId: string; userId: string }) {
	const [snapshot] = await db
		.select({
			graphJson: workspacePaperGraphSnapshots.graphJson,
			status: workspacePaperGraphSnapshots.status,
			generatedAt: workspacePaperGraphSnapshots.generatedAt,
		})
		.from(workspacePaperGraphSnapshots)
		.where(
			and(
				eq(workspacePaperGraphSnapshots.workspaceId, args.workspaceId),
				eq(workspacePaperGraphSnapshots.ownerUserId, args.userId),
				eq(workspacePaperGraphSnapshots.status, "stable"),
			),
		)
		.limit(1)
	if (snapshot?.graphJson) {
		if (!snapshot.generatedAt) return snapshot.graphJson
		if (!(await hasGraphInputsNewerThan({ ...args, generatedAt: snapshot.generatedAt }))) {
			return snapshot.graphJson
		}
	}
	return refreshWorkspacePaperGraph(args)
}

async function hasGraphInputsNewerThan(args: {
	workspaceId: string
	userId: string
	generatedAt: Date
}) {
	const [row] = await db
		.select({ id: compiledLocalConcepts.id })
		.from(compiledLocalConcepts)
		.where(
			and(
				eq(compiledLocalConcepts.workspaceId, args.workspaceId),
				eq(compiledLocalConcepts.ownerUserId, args.userId),
				isNull(compiledLocalConcepts.deletedAt),
				gt(compiledLocalConcepts.updatedAt, args.generatedAt),
			),
		)
		.limit(1)
	return Boolean(row)
}

export async function refreshWorkspacePaperGraph(args: {
	workspaceId: string
	userId: string
}) {
	const proposed = await buildPaperGraphPayload({
		...args,
		minEdgeWeight: PAPER_GRAPH_KEEP_THRESHOLD,
	})
	const now = new Date()
	const cutoff = new Date(now.getTime() - PAPER_GRAPH_STALE_RETENTION_DAYS * 24 * 60 * 60 * 1000)
	const proposedByPair = new Map(
		proposed.graph.edges.map((edge) => [paperPairKey(edge.source, edge.target), edge] as const),
	)

	const existingRows = await db
		.select()
		.from(workspacePaperGraphEdges)
		.where(
			and(
				eq(workspacePaperGraphEdges.workspaceId, args.workspaceId),
				eq(workspacePaperGraphEdges.ownerUserId, args.userId),
				or(
					eq(workspacePaperGraphEdges.status, "active"),
					eq(workspacePaperGraphEdges.status, "stale"),
				),
			),
		)
	const existingByPair = new Map(
		existingRows.map((edge) => [paperPairKey(edge.sourcePaperId, edge.targetPaperId), edge] as const),
	)

	for (const edge of proposed.graph.edges) {
		const pair = paperPairKey(edge.source, edge.target)
		const existing = existingByPair.get(pair)
		if (!existing && edge.weight < PAPER_GRAPH_CREATE_THRESHOLD) continue
		const status = edge.weight >= PAPER_GRAPH_KEEP_THRESHOLD ? "active" : "stale"
		const lastConfirmedAt =
			edge.weight >= PAPER_GRAPH_CREATE_THRESHOLD ? now : existing?.lastConfirmedAt ?? null
		await db
			.insert(workspacePaperGraphEdges)
			.values({
				workspaceId: args.workspaceId,
				ownerUserId: args.userId,
				sourcePaperId: edge.source,
				targetPaperId: edge.target,
				edgeKind: edge.edgeKind,
				weight: edge.weight,
				confidence: edge.maxSimilarity,
				evidenceCount: edge.evidenceCount,
				topEvidenceJson: edge.topEvidence,
				lastConfirmedAt,
				status,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: [
					workspacePaperGraphEdges.workspaceId,
					workspacePaperGraphEdges.ownerUserId,
					workspacePaperGraphEdges.sourcePaperId,
					workspacePaperGraphEdges.targetPaperId,
				],
				set: {
					edgeKind: sql`excluded.edge_kind`,
					weight: sql`excluded.weight`,
					confidence: sql`excluded.confidence`,
					evidenceCount: sql`excluded.evidence_count`,
					topEvidenceJson: sql`excluded.top_evidence_json`,
					lastConfirmedAt,
					status,
					updatedAt: now,
				},
			})
	}

	for (const existing of existingRows) {
		const pair = paperPairKey(existing.sourcePaperId, existing.targetPaperId)
		if (proposedByPair.has(pair)) continue
		const status = existing.status === "stale" && existing.updatedAt < cutoff ? "superseded" : "stale"
		await db
			.update(workspacePaperGraphEdges)
			.set({ status, updatedAt: now })
			.where(eq(workspacePaperGraphEdges.id, existing.id))
	}

	const graphJson = await buildPersistedPaperGraphPayload(args)
	const inputFingerprint = stableGraphFingerprint(graphJson)
	await db
		.insert(workspacePaperGraphSnapshots)
		.values({
			workspaceId: args.workspaceId,
			ownerUserId: args.userId,
			graphJson,
			inputFingerprint,
			status: "stable",
			error: null,
			generatedAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: [
				workspacePaperGraphSnapshots.workspaceId,
				workspacePaperGraphSnapshots.ownerUserId,
			],
			set: {
				graphJson,
				inputFingerprint,
				status: "stable",
				error: null,
				generatedAt: now,
				updatedAt: now,
			},
		})

	return graphJson
}

async function buildPersistedPaperGraphPayload(args: { workspaceId: string; userId: string }) {
	const base = await buildPaperGraphPayload({
		...args,
		minEdgeWeight: PAPER_GRAPH_KEEP_THRESHOLD,
	})
	const nodeIds = new Set(base.graph.nodes.map((node) => node.id))
	const persistedEdges = await db
		.select()
		.from(workspacePaperGraphEdges)
		.where(
			and(
				eq(workspacePaperGraphEdges.workspaceId, args.workspaceId),
				eq(workspacePaperGraphEdges.ownerUserId, args.userId),
				or(
					eq(workspacePaperGraphEdges.status, "active"),
					eq(workspacePaperGraphEdges.status, "stale"),
				),
			),
		)
		.orderBy(desc(workspacePaperGraphEdges.weight))

	const edges = persistedEdges
		.filter((edge) => nodeIds.has(edge.sourcePaperId) && nodeIds.has(edge.targetPaperId))
		.map((edge) => persistedEdgeToPayloadEdge(edge))
	const degreeByPaperId = new Map<string, number>()
	for (const edge of edges) {
		degreeByPaperId.set(edge.source, (degreeByPaperId.get(edge.source) ?? 0) + 1)
		degreeByPaperId.set(edge.target, (degreeByPaperId.get(edge.target) ?? 0) + 1)
	}

	return {
		...base,
		graph: {
			...base.graph,
			edgeCount: edges.length,
			nodes: base.graph.nodes.map((node) => ({
				...node,
				degree: degreeByPaperId.get(node.id) ?? 0,
			})),
			edges,
		},
	}
}

export async function buildPaperGraphPayload(args: {
	workspaceId: string
	userId: string
	minEdgeWeight?: number
}) {
	const minEdgeWeight = args.minEdgeWeight ?? PAPER_GRAPH_CREATE_THRESHOLD
	const paperRows = await db
		.select({
			id: papers.id,
			title: papers.title,
			authors: papers.authors,
			year: papers.year,
			venue: papers.venue,
			summaryStatus: papers.summaryStatus,
			createdAt: papers.createdAt,
		})
		.from(papers)
		.innerJoin(workspacePapers, eq(workspacePapers.paperId, papers.id))
		.where(
			and(
				eq(workspacePapers.workspaceId, args.workspaceId),
				eq(papers.ownerUserId, args.userId),
				isNull(papers.deletedAt),
			),
		)
		.orderBy(desc(papers.createdAt))
	const paperById = new Map(paperRows.map((paper) => [paper.id, paper] as const))
	const paperIds = paperRows.map((paper) => paper.id)

	const conceptRows =
		paperIds.length === 0
			? []
			: await db
					.select({
						id: compiledLocalConcepts.id,
						paperId: compiledLocalConcepts.paperId,
						clusterId: workspaceConceptClusterMembers.clusterId,
						kind: compiledLocalConcepts.kind,
						displayName: compiledLocalConcepts.displayName,
						canonicalName: compiledLocalConcepts.canonicalName,
						salienceScore: compiledLocalConcepts.salienceScore,
						sourceLevelDescription: compiledLocalConcepts.sourceLevelDescription,
						promptVersion: compiledLocalConcepts.promptVersion,
					})
					.from(compiledLocalConcepts)
					.innerJoin(
						workspaceConceptClusterMembers,
						eq(workspaceConceptClusterMembers.localConceptId, compiledLocalConcepts.id),
					)
					.where(
						and(
							eq(compiledLocalConcepts.workspaceId, args.workspaceId),
							eq(compiledLocalConcepts.ownerUserId, args.userId),
							inArray(compiledLocalConcepts.paperId, paperIds),
							isNull(compiledLocalConcepts.deletedAt),
						),
					)
	const graphConcepts = conceptRows.filter((concept) => GRAPH_CONCEPT_KINDS.has(concept.kind))
	const graphConceptIds = graphConcepts.map((concept) => concept.id)
	const conceptById = new Map(graphConcepts.map((concept) => [concept.id, concept] as const))
	const conceptsByPaperId = groupBy(graphConcepts, (concept) => concept.paperId)
	const conceptsByClusterId = groupBy(graphConcepts, (concept) => concept.clusterId)
	const evidenceByConceptId = await loadEvidenceByConceptId(graphConceptIds)
	const noteSignalConceptIds = await loadNoteSignalConceptIds({
		workspaceId: args.workspaceId,
		userId: args.userId,
		conceptIds: graphConceptIds,
	})

	const semanticCandidates =
		graphConcepts.length === 0
			? []
			: await db
					.select({
						id: workspaceConceptClusterCandidates.id,
						sourceLocalConceptId: workspaceConceptClusterCandidates.sourceLocalConceptId,
						targetLocalConceptId: workspaceConceptClusterCandidates.targetLocalConceptId,
						kind: workspaceConceptClusterCandidates.kind,
						matchMethod: workspaceConceptClusterCandidates.matchMethod,
						similarityScore: workspaceConceptClusterCandidates.similarityScore,
						llmDecision: workspaceConceptClusterCandidates.llmDecision,
						llmConfidence: workspaceConceptClusterCandidates.llmConfidence,
						decisionStatus: workspaceConceptClusterCandidates.decisionStatus,
						rationale: workspaceConceptClusterCandidates.rationale,
					})
					.from(workspaceConceptClusterCandidates)
					.where(
						and(
							eq(workspaceConceptClusterCandidates.workspaceId, args.workspaceId),
							eq(workspaceConceptClusterCandidates.ownerUserId, args.userId),
							isNull(workspaceConceptClusterCandidates.deletedAt),
							or(
								eq(workspaceConceptClusterCandidates.decisionStatus, "ai_confirmed"),
								eq(workspaceConceptClusterCandidates.decisionStatus, "user_accepted"),
								eq(workspaceConceptClusterCandidates.decisionStatus, "auto_accepted"),
								eq(workspaceConceptClusterCandidates.decisionStatus, "candidate"),
								eq(workspaceConceptClusterCandidates.decisionStatus, "needs_review"),
							),
						),
					)
					.orderBy(
						desc(workspaceConceptClusterCandidates.llmConfidence),
						desc(workspaceConceptClusterCandidates.similarityScore),
					)

	const edgeDrafts = new Map<string, PaperGraphEdgeDraft>()

	for (const concepts of conceptsByClusterId.values()) {
		const conceptsByPaper = groupBy(concepts, (concept) => concept.paperId)
		const connectedPaperIds = [...conceptsByPaper.keys()].filter((paperId) => paperById.has(paperId))
		forEachPaperPair(connectedPaperIds, (sourcePaperId, targetPaperId) => {
			const sourceConcept = conceptsByPaper.get(sourcePaperId)?.[0]
			const targetConcept = conceptsByPaper.get(targetPaperId)?.[0]
			if (!sourceConcept || !targetConcept) return
			addPaperGraphEvidence(edgeDrafts, {
				sourcePaperId,
				targetPaperId,
				kind: sourceConcept.kind,
				score: 1,
				similarityScore: 1,
				sourceConceptId: sourceConcept.id,
				targetConceptId: targetConcept.id,
				sourceConceptName: sourceConcept.displayName,
				targetConceptName: targetConcept.displayName,
				matchMethod: "exact_cluster",
				llmDecision: null,
				llmConfidence: null,
				decisionStatus: "auto_accepted",
				rationale: `Shared ${sourceConcept.kind}: ${sourceConcept.displayName}`,
				sourceDescription: sourceConcept.sourceLevelDescription,
				targetDescription: targetConcept.sourceLevelDescription,
				sourcePromptVersion: sourceConcept.promptVersion,
				targetPromptVersion: targetConcept.promptVersion,
				sourceHasReaderNoteEvidence: noteSignalConceptIds.has(sourceConcept.id),
				targetHasReaderNoteEvidence: noteSignalConceptIds.has(targetConcept.id),
				sourceEvidence: evidenceByConceptId.get(sourceConcept.id) ?? [],
				targetEvidence: evidenceByConceptId.get(targetConcept.id) ?? [],
			})
		})
	}

	for (const candidate of semanticCandidates) {
		const sourceConcept = conceptById.get(candidate.sourceLocalConceptId)
		const targetConcept = conceptById.get(candidate.targetLocalConceptId)
		if (!sourceConcept || !targetConcept) continue
		if (sourceConcept.paperId === targetConcept.paperId) continue
		const similarityScore = candidate.similarityScore ?? 0
		const llmConfidence = candidate.llmConfidence ?? 0
		const score = scorePaperCandidateEvidence({
			kind: candidate.kind,
			llmDecision: candidate.llmDecision,
			llmConfidence,
			decisionStatus: candidate.decisionStatus,
			matchMethod: candidate.matchMethod,
			similarityScore,
			sourceConceptName: sourceConcept.displayName,
			targetConceptName: targetConcept.displayName,
		})
		if (score < minEdgeWeight) continue
		addPaperGraphEvidence(edgeDrafts, {
			sourcePaperId: sourceConcept.paperId,
			targetPaperId: targetConcept.paperId,
			kind: candidate.kind,
			score,
			similarityScore,
			sourceConceptId: sourceConcept.id,
			targetConceptId: targetConcept.id,
			sourceConceptName: sourceConcept.displayName,
			targetConceptName: targetConcept.displayName,
			matchMethod: candidate.matchMethod,
			llmDecision: candidate.llmDecision,
			llmConfidence,
			decisionStatus: candidate.decisionStatus,
			rationale: candidate.rationale,
			sourceDescription: sourceConcept.sourceLevelDescription,
			targetDescription: targetConcept.sourceLevelDescription,
			sourcePromptVersion: sourceConcept.promptVersion,
			targetPromptVersion: targetConcept.promptVersion,
			sourceHasReaderNoteEvidence: noteSignalConceptIds.has(sourceConcept.id),
			targetHasReaderNoteEvidence: noteSignalConceptIds.has(targetConcept.id),
			sourceEvidence: evidenceByConceptId.get(sourceConcept.id) ?? [],
			targetEvidence: evidenceByConceptId.get(targetConcept.id) ?? [],
		})
	}

	const graphEdges = [...edgeDrafts.values()]
		.map((draft) => finalizePaperGraphEdge(draft))
		.filter((edge) => edge.weight >= minEdgeWeight)
		.sort((a, b) => b.weight - a.weight)
	const degreeByPaperId = new Map<string, number>()
	for (const edge of graphEdges) {
		degreeByPaperId.set(edge.source, (degreeByPaperId.get(edge.source) ?? 0) + 1)
		degreeByPaperId.set(edge.target, (degreeByPaperId.get(edge.target) ?? 0) + 1)
	}

	return {
		workspaceId: args.workspaceId,
		view: "papers" as const,
		graph: {
			nodeCount: paperRows.length,
			edgeCount: graphEdges.length,
			nodes: paperRows.map((paper) => {
				const concepts = conceptsByPaperId.get(paper.id) ?? []
				return {
					id: paper.id,
					paperId: paper.id,
					label: paper.title,
					title: paper.title,
					authors: paper.authors ?? [],
					year: paper.year,
					venue: paper.venue,
					summaryStatus: paper.summaryStatus,
					conceptCount: concepts.length,
					degree: degreeByPaperId.get(paper.id) ?? 0,
					topConcepts: concepts
						.sort((a, b) => b.salienceScore - a.salienceScore || a.displayName.localeCompare(b.displayName))
						.slice(0, 8)
						.map((concept) => ({
							id: concept.id,
							displayName: concept.displayName,
							kind: concept.kind,
							hasReaderNoteEvidence: noteSignalConceptIds.has(concept.id),
						})),
					searchConcepts: concepts
						.sort((a, b) => a.displayName.localeCompare(b.displayName))
						.map((concept) => ({
							id: concept.id,
							displayName: concept.displayName,
							kind: concept.kind,
							hasReaderNoteEvidence: noteSignalConceptIds.has(concept.id),
						})),
				}
			}),
			edges: graphEdges,
		},
	}
}

async function loadEvidenceByConceptId(conceptIds: string[]) {
	const conceptEvidence =
		conceptIds.length === 0
			? []
			: await db
					.select({
						conceptId: compiledLocalConceptEvidence.conceptId,
						blockId: compiledLocalConceptEvidence.blockId,
						snippet: compiledLocalConceptEvidence.snippet,
					})
					.from(compiledLocalConceptEvidence)
					.where(inArray(compiledLocalConceptEvidence.conceptId, conceptIds))
	const evidenceByConceptId = new Map<string, Array<{ blockId: string; snippet: string | null }>>()
	for (const item of conceptEvidence) {
		const bucket = evidenceByConceptId.get(item.conceptId) ?? []
		bucket.push({ blockId: item.blockId, snippet: item.snippet })
		evidenceByConceptId.set(item.conceptId, uniqueEvidenceSnippets(bucket))
	}
	return evidenceByConceptId
}

async function loadNoteSignalConceptIds(args: {
	workspaceId: string
	userId: string
	conceptIds: string[]
}) {
	if (args.conceptIds.length === 0) return new Set<string>()
	const rows = await db
		.select({ conceptId: conceptObservations.localConceptId })
		.from(conceptObservations)
		.where(
			and(
				eq(conceptObservations.workspaceId, args.workspaceId),
				eq(conceptObservations.ownerUserId, args.userId),
				eq(conceptObservations.sourceType, "note"),
				inArray(conceptObservations.localConceptId, args.conceptIds),
				isNull(conceptObservations.deletedAt),
			),
		)
	return new Set(rows.map((row) => row.conceptId))
}

type PaperGraphEvidence = {
	sourcePaperId: string
	targetPaperId: string
	kind: string
	score: number
	similarityScore: number
	sourceConceptId: string
	targetConceptId: string
	sourceConceptName: string
	targetConceptName: string
	matchMethod: string
	llmDecision: string | null
	llmConfidence: number | null
	decisionStatus: string | null
	rationale: string | null
	sourceDescription: string | null
	targetDescription: string | null
	sourcePromptVersion: string | null
	targetPromptVersion: string | null
	sourceHasReaderNoteEvidence: boolean
	targetHasReaderNoteEvidence: boolean
	sourceEvidence: Array<{ blockId: string; snippet: string | null }>
	targetEvidence: Array<{ blockId: string; snippet: string | null }>
}

type PaperGraphEdgeDraft = {
	source: string
	target: string
	score: number
	evidence: PaperGraphEvidence[]
}

function addPaperGraphEvidence(drafts: Map<string, PaperGraphEdgeDraft>, evidence: PaperGraphEvidence) {
	const [source, target] =
		evidence.sourcePaperId.localeCompare(evidence.targetPaperId) <= 0
			? [evidence.sourcePaperId, evidence.targetPaperId]
			: [evidence.targetPaperId, evidence.sourcePaperId]
	const key = paperPairKey(source, target)
	const draft = drafts.get(key) ?? { source, target, score: 0, evidence: [] }
	draft.score += evidence.score
	draft.evidence.push(evidence)
	drafts.set(key, draft)
}

function finalizePaperGraphEdge(draft: PaperGraphEdgeDraft) {
	const evidence = [...draft.evidence].sort((a, b) => b.score - a.score)
	const similarities = evidence.map((item) => item.similarityScore).filter(Number.isFinite)
	const maxSimilarity = similarities.length > 0 ? Math.max(...similarities) : null
	const avgSimilarity =
		similarities.length > 0
			? Math.round((similarities.reduce((sum, value) => sum + value, 0) / similarities.length) * 1000) / 1000
			: null
	const kinds = new Set(evidence.map((item) => item.kind))
	const maxEvidenceScore = evidence.length > 0 ? Math.max(...evidence.map((item) => item.score)) : 0
	const evidenceBoost = Math.min(0.15, Math.max(0, evidence.length - 1) * 0.04)
	const weight = Math.min(1, Math.round((maxEvidenceScore + evidenceBoost) * 1000) / 1000)
	return {
		id: `paper-edge:${draft.source}:${draft.target}`,
		source: draft.source,
		target: draft.target,
		edgeKind: edgeKindForEvidence(evidence),
		weight,
		status: "active" as const,
		isRetained: weight < PAPER_GRAPH_CREATE_THRESHOLD,
		hasReaderNoteEvidence: evidence.some(
			(item) => item.sourceHasReaderNoteEvidence || item.targetHasReaderNoteEvidence,
		),
		lastConfirmedAt: null as string | null,
		evidenceCount: evidence.length,
		strongEvidenceCount: evidence.filter(
			(item) => item.matchMethod === "exact_cluster" || (item.llmConfidence ?? 0) >= LLM_CONFIRMED_LINK_THRESHOLD,
		).length,
		maxSimilarity,
		avgSimilarity,
		kinds: [...kinds],
		topEvidence: evidence.slice(0, 8).map((item) => ({
			kind: item.kind,
			sourcePaperId: item.sourcePaperId,
			targetPaperId: item.targetPaperId,
			sourceConceptId: item.sourceConceptId,
			targetConceptId: item.targetConceptId,
			sourceConceptName: item.sourceConceptName,
			targetConceptName: item.targetConceptName,
			matchMethod: item.matchMethod,
			similarityScore: item.similarityScore,
			llmDecision: item.llmDecision,
			llmConfidence: item.llmConfidence,
			decisionStatus: item.decisionStatus,
			rationale: item.rationale,
			sourceDescription: item.sourceDescription,
			targetDescription: item.targetDescription,
			sourcePromptVersion: item.sourcePromptVersion,
			targetPromptVersion: item.targetPromptVersion,
			sourceHasReaderNoteEvidence: item.sourceHasReaderNoteEvidence,
			targetHasReaderNoteEvidence: item.targetHasReaderNoteEvidence,
			sourceEvidenceBlockIds: item.sourceEvidence.map((evidenceItem) => evidenceItem.blockId),
			targetEvidenceBlockIds: item.targetEvidence.map((evidenceItem) => evidenceItem.blockId),
			sourceEvidenceSnippets: item.sourceEvidence
				.filter((evidenceItem) => evidenceItem.snippet)
				.slice(0, 1)
				.map((evidenceItem) => ({
					blockId: evidenceItem.blockId,
					snippet: evidenceItem.snippet as string,
				})),
			targetEvidenceSnippets: item.targetEvidence
				.filter((evidenceItem) => evidenceItem.snippet)
				.slice(0, 1)
				.map((evidenceItem) => ({
					blockId: evidenceItem.blockId,
					snippet: evidenceItem.snippet as string,
				})),
		})),
	}
}

function persistedEdgeToPayloadEdge(edge: typeof workspacePaperGraphEdges.$inferSelect) {
	const topEvidence = Array.isArray(edge.topEvidenceJson) ? edge.topEvidenceJson : []
	const strongEvidenceCount = topEvidence.filter((item) => {
		const record = item as Record<string, unknown>
		return record.matchMethod === "exact_cluster" || Number(record.llmConfidence ?? 0) >= LLM_CONFIRMED_LINK_THRESHOLD
	}).length
	return {
		id: `paper-edge:${edge.sourcePaperId}:${edge.targetPaperId}`,
		source: edge.sourcePaperId,
		target: edge.targetPaperId,
		edgeKind: edge.edgeKind,
		weight: edge.weight,
		status: edge.status === "stale" ? ("stale" as const) : ("active" as const),
		isRetained: edge.status === "active" && edge.weight < PAPER_GRAPH_CREATE_THRESHOLD,
		hasReaderNoteEvidence: topEvidence.some((item) => {
			const record = item as Record<string, unknown>
			return record.sourceHasReaderNoteEvidence === true || record.targetHasReaderNoteEvidence === true
		}),
		lastConfirmedAt: edge.lastConfirmedAt?.toISOString() ?? null,
		evidenceCount: Number(edge.evidenceCount),
		strongEvidenceCount,
		maxSimilarity: edge.confidence,
		avgSimilarity: edge.confidence,
		kinds: [...new Set(topEvidence.map((item) => (item as Record<string, unknown>).kind).filter(Boolean))],
		topEvidence,
	}
}

function scorePaperCandidateEvidence(args: {
	kind: string
	llmDecision: string | null
	llmConfidence: number | null
	decisionStatus: string
	matchMethod: string
	similarityScore: number
	sourceConceptName: string
	targetConceptName: string
}) {
	if (args.decisionStatus === "user_accepted") return 0.92
	if (args.decisionStatus === "auto_accepted") return 0.86
	if (
		(args.decisionStatus === "candidate" || args.decisionStatus === "needs_review") &&
		isHighSignalUnreviewedPaperCandidate(args)
	) {
		let score = Math.max(PAPER_GRAPH_KEEP_THRESHOLD, args.similarityScore)
		if (hasNameContainment(args.sourceConceptName, args.targetConceptName)) score += 0.06
		if (args.kind === "method" || args.kind === "task") score += 0.03
		return Math.min(0.82, Math.round(score * 1000) / 1000)
	}
	if (args.llmDecision !== "same" && args.llmDecision !== "related") return 0
	const confidence = args.llmConfidence ?? 0
	if (confidence < PAPER_GRAPH_KEEP_THRESHOLD) return 0

	let score = confidence
	if (args.llmDecision === "related") score *= 0.9
	if (args.kind === "method" || args.kind === "task") score += 0.05
	if (args.kind === "metric") score += 0.02

	return Math.min(1, Math.round(score * 1000) / 1000)
}

function isHighSignalUnreviewedPaperCandidate(args: {
	matchMethod: string
	similarityScore: number
	sourceConceptName: string
	targetConceptName: string
}) {
	if (args.matchMethod !== "embedding" && args.matchMethod !== "lexical_source_description") return false
	if (args.similarityScore < UNREVIEWED_SEMANTIC_LINK_THRESHOLD) return false
	if (hasNameContainment(args.sourceConceptName, args.targetConceptName)) return true
	if (args.similarityScore >= HIGH_SIMILARITY_SEMANTIC_LINK_THRESHOLD) return true
	return false
}

function hasNameContainment(sourceName: string, targetName: string) {
	const sourceTokens = meaningfulConceptNameTokens(sourceName)
	const targetTokens = meaningfulConceptNameTokens(targetName)
	if (sourceTokens.length === 0 || targetTokens.length === 0) return false
	const [shorter, longer] =
		sourceTokens.length <= targetTokens.length ? [sourceTokens, targetTokens] : [targetTokens, sourceTokens]
	const longerSet = new Set(longer)
	const contained = shorter.filter((token) => longerSet.has(token)).length
	return contained / shorter.length >= 0.75
}

function meaningfulConceptNameTokens(value: string) {
	const stopwords = new Set(["and", "for", "in", "of", "on", "the", "to", "with"])
	return value
		.toLowerCase()
		.split(/[^a-z0-9]+/g)
		.map((token) => token.trim())
		.filter((token) => token.length >= 3 && !stopwords.has(token))
}

function edgeKindForEvidence(evidence: PaperGraphEvidence[]) {
	const kinds = new Set(evidence.map((item) => item.kind))
	if (kinds.size > 1) return "mixed"
	if (kinds.has("method")) return "similar_methods"
	if (kinds.has("task")) return "same_task"
	if (kinds.has("metric")) return "related_metrics"
	if (evidence.some((item) => item.matchMethod === "exact_cluster")) return "shared_concepts"
	return "semantic_neighbor"
}

function groupBy<T, K>(items: T[], getKey: (item: T) => K) {
	const grouped = new Map<K, T[]>()
	for (const item of items) {
		const key = getKey(item)
		const bucket = grouped.get(key) ?? []
		bucket.push(item)
		grouped.set(key, bucket)
	}
	return grouped
}

function forEachPaperPair(paperIds: string[], callback: (source: string, target: string) => void) {
	const sortedIds = [...new Set(paperIds)].sort()
	for (let i = 0; i < sortedIds.length; i += 1) {
		for (let j = i + 1; j < sortedIds.length; j += 1) callback(sortedIds[i], sortedIds[j])
	}
}

function paperPairKey(source: string, target: string) {
	return source.localeCompare(target) <= 0 ? `${source}::${target}` : `${target}::${source}`
}

function uniqueEvidenceSnippets(items: Array<{ blockId: string; snippet: string | null }>) {
	const seen = new Set<string>()
	const unique: Array<{ blockId: string; snippet: string | null }> = []
	for (const item of items) {
		if (!item.blockId || seen.has(item.blockId)) continue
		seen.add(item.blockId)
		unique.push(item)
	}
	return unique
}

function stableGraphFingerprint(value: unknown) {
	return JSON.stringify(value)
}
