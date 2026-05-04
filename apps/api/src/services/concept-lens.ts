import {
	blocks,
	compiledLocalConceptEvidence,
	compiledLocalConcepts,
	conceptObservations,
	noteAnnotationRefs,
	noteBlockRefs,
	notes,
	papers,
	readerAnnotations,
	workspaceConceptClusterCandidates,
	workspaceConceptClusterMembers,
	workspaceConceptClusters,
	workspacePapers,
} from "@sapientia/db"
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm"
import { db } from "../db"
import { loadStablePaperGraphPayload } from "./workspace-paper-graph"

const PUBLIC_CONCEPT_KINDS = new Set(["concept", "method", "task", "metric", "dataset"])
const NOTE_CONCEPT_PROMPT_VERSION = "note-concept-extract-v1"

export type ConceptLensScope = "block" | "note" | "annotation" | "concept"

type StablePaperGraphPayload = {
	graph: {
		nodes: Array<{
			id: string
			paperId: string
			title: string
			authors: string[]
			year: number | null
			venue: string | null
		}>
		edges: Array<{
			id: string
			source: string
			target: string
			edgeKind: string
			weight: number
			status?: string
			isRetained?: boolean
			hasReaderNoteEvidence?: boolean
			topEvidence: Array<{
				sourceConceptId: string
				targetConceptId: string
				sourceConceptName: string
				targetConceptName: string
				rationale: string | null
				sourceEvidenceBlockIds: string[]
				targetEvidenceBlockIds: string[]
				sourceEvidenceSnippets: Array<{ blockId: string; snippet: string }>
				targetEvidenceSnippets: Array<{ blockId: string; snippet: string }>
			}>
		}>
	}
}

export async function loadBlockConceptLensPayload(args: {
	workspaceId: string
	paperId: string
	blockId: string
	userId: string
}) {
	const payload = await loadConceptLensPayload({
		...args,
		scope: "block",
	})
	return blockCompatiblePayload(payload)
}

export async function loadConceptLensPayload(args: {
	workspaceId: string
	paperId: string
	userId: string
	scope?: ConceptLensScope
	blockId?: string
	noteId?: string
	annotationId?: string
	conceptId?: string
}) {
	const scope = args.scope ?? inferScope(args)
	const paper = await loadPaperContext(args)
	const context = await loadLensContext({ ...args, scope, paper })
	const conceptRows = await loadLensConceptRows({
		...args,
		scope,
		blockIds: context.blockIds,
		noteId: context.note?.id ?? args.noteId,
		annotationId: context.annotation?.id ?? args.annotationId,
		conceptId: args.conceptId,
	})
	const publicRows = conceptRows.filter((row) => PUBLIC_CONCEPT_KINDS.has(row.kind))
	const readerNoteConceptIds = await loadReaderNoteConceptIds({
		workspaceId: args.workspaceId,
		paperId: args.paperId,
		userId: args.userId,
		conceptIds: uniqueStrings(publicRows.map((row) => row.conceptId)),
	})
	const concepts = toConceptPayload(publicRows, context.blockIds, readerNoteConceptIds)
	const semanticCandidates = await loadSemanticCandidates({
		workspaceId: args.workspaceId,
		userId: args.userId,
		clusterIds: uniqueStrings(publicRows.flatMap((row) => (row.clusterId ? [row.clusterId] : []))),
	})
	const relatedPapers = await loadRelatedPapers({
		workspaceId: args.workspaceId,
		userId: args.userId,
		paperId: args.paperId,
		conceptIds: new Set(publicRows.map((row) => row.conceptId)),
	})

	return {
		workspaceId: args.workspaceId,
		paperId: args.paperId,
		scope,
		blockId: context.primaryBlockId,
		context: {
			paper,
			block: context.block,
			note: context.note,
			annotation: context.annotation,
			conceptId: args.conceptId ?? null,
		},
		concepts,
		semanticCandidates,
		relatedPapers,
		freshness: summarizeFreshness(concepts, semanticCandidates, relatedPapers),
		feedbackActions: [] as string[],
	}
}

function inferScope(args: {
	blockId?: string
	noteId?: string
	annotationId?: string
	conceptId?: string
}): ConceptLensScope {
	if (args.noteId) return "note"
	if (args.annotationId) return "annotation"
	if (args.conceptId) return "concept"
	return "block"
}

async function loadPaperContext(args: { workspaceId: string; paperId: string; userId: string }) {
	const [paper] = await db
		.select({
			id: papers.id,
			title: papers.title,
			authors: papers.authors,
			year: papers.year,
			venue: papers.venue,
			summaryStatus: papers.summaryStatus,
			parseStatus: papers.parseStatus,
		})
		.from(papers)
		.innerJoin(workspacePapers, eq(workspacePapers.paperId, papers.id))
		.where(
			and(
				eq(papers.id, args.paperId),
				eq(papers.ownerUserId, args.userId),
				eq(workspacePapers.workspaceId, args.workspaceId),
				isNull(papers.deletedAt),
			),
		)
		.limit(1)
	return paper ?? null
}

async function loadLensContext(args: {
	workspaceId: string
	paperId: string
	userId: string
	scope: ConceptLensScope
	blockId?: string
	noteId?: string
	annotationId?: string
	paper: Awaited<ReturnType<typeof loadPaperContext>>
}) {
	if (args.scope === "note" && args.noteId) {
		const [note] = await db
			.select({
				id: notes.id,
				title: notes.title,
				currentVersion: notes.currentVersion,
				anchorKind: notes.anchorKind,
				anchorBlockId: notes.anchorBlockId,
				anchorAnnotationId: notes.anchorAnnotationId,
				updatedAt: notes.updatedAt,
			})
			.from(notes)
			.where(
				and(
					eq(notes.id, args.noteId),
					eq(notes.workspaceId, args.workspaceId),
					eq(notes.ownerUserId, args.userId),
					eq(notes.paperId, args.paperId),
					isNull(notes.deletedAt),
				),
			)
			.limit(1)
		const blockIds = note ? await loadNoteBlockIds({ noteId: note.id, paperId: args.paperId }) : []
		const primaryBlockId = note?.anchorBlockId ?? blockIds[0] ?? null
		return {
			blockIds,
			primaryBlockId,
			block: primaryBlockId ? await loadBlock(args.paperId, primaryBlockId) : null,
			note: note
				? {
						id: note.id,
						title: note.title,
						currentVersion: note.currentVersion,
						anchorKind: note.anchorKind,
						anchorBlockId: note.anchorBlockId,
						anchorAnnotationId: note.anchorAnnotationId,
						updatedAt: note.updatedAt.toISOString(),
					}
				: null,
			annotation: null,
		}
	}

	if (args.scope === "annotation" && args.annotationId) {
		const [annotation] = await db
			.select({
				id: readerAnnotations.id,
				page: readerAnnotations.page,
				kind: readerAnnotations.kind,
				color: readerAnnotations.color,
				body: readerAnnotations.body,
				updatedAt: readerAnnotations.updatedAt,
			})
			.from(readerAnnotations)
			.where(
				and(
					eq(readerAnnotations.id, args.annotationId),
					eq(readerAnnotations.workspaceId, args.workspaceId),
					eq(readerAnnotations.userId, args.userId),
					eq(readerAnnotations.paperId, args.paperId),
					isNull(readerAnnotations.deletedAt),
				),
			)
			.limit(1)
		const blockIds = annotation
			? await loadAnnotationBlockIds({ paperId: args.paperId, page: annotation.page, body: annotation.body })
			: []
		const primaryBlockId = blockIds[0] ?? null
		return {
			blockIds,
			primaryBlockId,
			block: primaryBlockId ? await loadBlock(args.paperId, primaryBlockId) : null,
			note: null,
			annotation: annotation
				? {
						id: annotation.id,
						page: annotation.page,
						kind: annotation.kind,
						color: annotation.color,
						quote: annotation.body.quote,
						updatedAt: annotation.updatedAt.toISOString(),
					}
				: null,
		}
	}

	const primaryBlockId = args.blockId ?? null
	return {
		blockIds: primaryBlockId ? [primaryBlockId] : [],
		primaryBlockId,
		block: primaryBlockId ? await loadBlock(args.paperId, primaryBlockId) : null,
		note: null,
		annotation: null,
	}
}

async function loadBlock(paperId: string, blockId: string) {
	const [block] = await db
		.select({
			blockId: blocks.blockId,
			blockIndex: blocks.blockIndex,
			type: blocks.type,
			page: blocks.page,
			text: blocks.text,
		})
		.from(blocks)
		.where(and(eq(blocks.paperId, paperId), eq(blocks.blockId, blockId)))
		.limit(1)
	if (!block) return null
	return {
		...block,
		text: truncateText(block.text, 500),
	}
}

async function loadNoteBlockIds(args: { noteId: string; paperId: string }) {
	const blockRows = await db
		.select({ blockId: noteBlockRefs.blockId })
		.from(noteBlockRefs)
		.where(eq(noteBlockRefs.noteId, args.noteId))
	const blockIds = blockRows.map((row) => row.blockId)
	const annotationRows = await db
		.select({
			page: readerAnnotations.page,
			body: readerAnnotations.body,
		})
		.from(noteAnnotationRefs)
		.innerJoin(
			readerAnnotations,
			and(
				eq(readerAnnotations.id, noteAnnotationRefs.annotationId),
				eq(readerAnnotations.paperId, noteAnnotationRefs.paperId),
				isNull(readerAnnotations.deletedAt),
			),
		)
		.where(eq(noteAnnotationRefs.noteId, args.noteId))
	for (const annotation of annotationRows) {
		blockIds.push(
			...(await loadAnnotationBlockIds({
				paperId: args.paperId,
				page: annotation.page,
				body: annotation.body,
			})),
		)
	}
	return uniqueStrings(blockIds)
}

async function loadAnnotationBlockIds(args: {
	paperId: string
	page: number
	body: { rects: Array<{ x: number; y: number; w: number; h: number }> }
}) {
	const bbox = annotationBodyBoundingBox(args.body)
	if (!bbox) return []
	const paperBlocks = await db
		.select({
			blockId: blocks.blockId,
			page: blocks.page,
			bbox: blocks.bbox,
		})
		.from(blocks)
		.where(eq(blocks.paperId, args.paperId))
	return uniqueStrings(
		paperBlocks
			.filter((block) => block.page === args.page && rectOverlapRatio(block.bbox, bbox) >= 0.08)
			.sort((a, b) => rectOverlapRatio(b.bbox, bbox) - rectOverlapRatio(a.bbox, bbox))
			.slice(0, 4)
			.map((block) => block.blockId),
	)
}

async function loadLensConceptRows(args: {
	workspaceId: string
	paperId: string
	userId: string
	scope: ConceptLensScope
	blockIds: string[]
	noteId?: string
	annotationId?: string
	conceptId?: string
}) {
	const rows = await loadConceptRows({
		workspaceId: args.workspaceId,
		paperId: args.paperId,
		userId: args.userId,
		blockIds: args.blockIds,
		conceptIds: args.conceptId ? [args.conceptId] : [],
	})
	if (args.scope !== "note" || !args.noteId) return rows

	const noteRows = await loadConceptRowsForNote({
		workspaceId: args.workspaceId,
		paperId: args.paperId,
		userId: args.userId,
		noteId: args.noteId,
		blockIds: args.blockIds,
	})
	return dedupeConceptRows([...noteRows, ...rows])
}

async function loadConceptRows(args: {
	workspaceId: string
	paperId: string
	userId: string
	blockIds: string[]
	conceptIds: string[]
}) {
	if (args.blockIds.length === 0 && args.conceptIds.length === 0) return []
	const filters = [
		eq(compiledLocalConceptEvidence.paperId, args.paperId),
		eq(compiledLocalConcepts.workspaceId, args.workspaceId),
		eq(compiledLocalConcepts.ownerUserId, args.userId),
		isNull(compiledLocalConcepts.deletedAt),
	]
	if (args.blockIds.length > 0 && args.conceptIds.length > 0) {
		filters.push(
			or(
				inArray(compiledLocalConceptEvidence.blockId, args.blockIds),
				inArray(compiledLocalConcepts.id, args.conceptIds),
			) as NonNullable<ReturnType<typeof or>>,
		)
	} else if (args.blockIds.length > 0) {
		filters.push(inArray(compiledLocalConceptEvidence.blockId, args.blockIds))
	} else {
		filters.push(inArray(compiledLocalConcepts.id, args.conceptIds))
	}
	return db
		.select({
			conceptId: compiledLocalConcepts.id,
			kind: compiledLocalConcepts.kind,
			canonicalName: compiledLocalConcepts.canonicalName,
			displayName: compiledLocalConcepts.displayName,
			status: compiledLocalConcepts.status,
			salienceScore: compiledLocalConcepts.salienceScore,
			highlightCount: compiledLocalConcepts.highlightCount,
			noteCitationCount: compiledLocalConcepts.noteCitationCount,
			sourceLevelDescription: compiledLocalConcepts.sourceLevelDescription,
			sourceLevelDescriptionStatus: compiledLocalConcepts.sourceLevelDescriptionStatus,
			readerSignalSummary: compiledLocalConcepts.readerSignalSummary,
			promptVersion: compiledLocalConcepts.promptVersion,
			evidenceBlockId: compiledLocalConceptEvidence.blockId,
			evidenceSnippet: compiledLocalConceptEvidence.snippet,
			evidenceConfidence: compiledLocalConceptEvidence.confidence,
			clusterId: workspaceConceptClusters.id,
			clusterDisplayName: workspaceConceptClusters.displayName,
			clusterCanonicalName: workspaceConceptClusters.canonicalName,
			clusterKind: workspaceConceptClusters.kind,
			clusterMemberCount: workspaceConceptClusters.memberCount,
			clusterPaperCount: workspaceConceptClusters.paperCount,
		})
		.from(compiledLocalConceptEvidence)
		.innerJoin(
			compiledLocalConcepts,
			eq(compiledLocalConcepts.id, compiledLocalConceptEvidence.conceptId),
		)
		.leftJoin(
			workspaceConceptClusterMembers,
			eq(workspaceConceptClusterMembers.localConceptId, compiledLocalConcepts.id),
		)
		.leftJoin(
			workspaceConceptClusters,
			eq(workspaceConceptClusters.id, workspaceConceptClusterMembers.clusterId),
		)
		.where(and(...filters))
		.orderBy(desc(compiledLocalConcepts.salienceScore), asc(compiledLocalConcepts.displayName))
}

async function loadConceptRowsForNote(args: {
	workspaceId: string
	paperId: string
	userId: string
	noteId: string
	blockIds: string[]
}) {
	const rows = await db
		.select({
			conceptId: compiledLocalConcepts.id,
			kind: compiledLocalConcepts.kind,
			canonicalName: compiledLocalConcepts.canonicalName,
			displayName: compiledLocalConcepts.displayName,
			status: compiledLocalConcepts.status,
			salienceScore: compiledLocalConcepts.salienceScore,
			highlightCount: compiledLocalConcepts.highlightCount,
			noteCitationCount: compiledLocalConcepts.noteCitationCount,
			sourceLevelDescription: compiledLocalConcepts.sourceLevelDescription,
			sourceLevelDescriptionStatus: compiledLocalConcepts.sourceLevelDescriptionStatus,
			readerSignalSummary: compiledLocalConcepts.readerSignalSummary,
			promptVersion: compiledLocalConcepts.promptVersion,
			observationText: conceptObservations.observationText,
			observationBlockIds: conceptObservations.blockIds,
			clusterId: workspaceConceptClusters.id,
			clusterDisplayName: workspaceConceptClusters.displayName,
			clusterCanonicalName: workspaceConceptClusters.canonicalName,
			clusterKind: workspaceConceptClusters.kind,
			clusterMemberCount: workspaceConceptClusters.memberCount,
			clusterPaperCount: workspaceConceptClusters.paperCount,
		})
		.from(conceptObservations)
		.innerJoin(compiledLocalConcepts, eq(compiledLocalConcepts.id, conceptObservations.localConceptId))
		.leftJoin(
			workspaceConceptClusterMembers,
			eq(workspaceConceptClusterMembers.localConceptId, compiledLocalConcepts.id),
		)
		.leftJoin(
			workspaceConceptClusters,
			eq(workspaceConceptClusters.id, workspaceConceptClusterMembers.clusterId),
		)
		.where(
			and(
				eq(conceptObservations.workspaceId, args.workspaceId),
				eq(conceptObservations.ownerUserId, args.userId),
				eq(conceptObservations.paperId, args.paperId),
				eq(conceptObservations.sourceType, "note"),
				eq(conceptObservations.sourceId, `note:${args.noteId}`),
				isNull(conceptObservations.deletedAt),
				isNull(compiledLocalConcepts.deletedAt),
			),
		)
	return rows.map((row) => ({
		...row,
		evidenceBlockId: firstString(row.observationBlockIds, args.blockIds),
		evidenceSnippet: truncateText(row.observationText, 220),
		evidenceConfidence: 0.65,
	}))
}

type ConceptRow = Awaited<ReturnType<typeof loadConceptRows>>[number]

async function loadReaderNoteConceptIds(args: {
	workspaceId: string
	paperId: string
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
				eq(conceptObservations.paperId, args.paperId),
				eq(conceptObservations.sourceType, "note"),
				inArray(conceptObservations.localConceptId, args.conceptIds),
				isNull(conceptObservations.deletedAt),
			),
		)
	return new Set(rows.map((row) => row.conceptId))
}

function toConceptPayload(
	rows: ConceptRow[],
	contextBlockIds: string[],
	readerNoteConceptIds: Set<string>,
) {
	return dedupeConceptRows(rows).map((row) => ({
		id: row.conceptId,
		kind: row.kind,
		canonicalName: row.canonicalName,
		displayName: row.displayName,
		status: row.status,
		salienceScore: row.salienceScore,
		highlightCount: row.highlightCount,
		noteCitationCount: row.noteCitationCount,
		sourceLevelDescription: row.sourceLevelDescription,
		sourceLevelDescriptionStatus: row.sourceLevelDescriptionStatus,
		readerSignalSummary: row.readerSignalSummary,
		promptVersion: row.promptVersion,
		hasReaderNoteEvidence:
			row.promptVersion === NOTE_CONCEPT_PROMPT_VERSION || readerNoteConceptIds.has(row.conceptId),
		evidence: {
			blockId: row.evidenceBlockId ?? contextBlockIds[0] ?? "",
			snippet: row.evidenceSnippet,
			confidence: row.evidenceConfidence,
		},
		cluster: row.clusterId
			? {
					id: row.clusterId,
					displayName: row.clusterDisplayName,
					canonicalName: row.clusterCanonicalName,
					kind: row.clusterKind,
					memberCount: row.clusterMemberCount,
					paperCount: row.clusterPaperCount,
				}
			: null,
	}))
}

async function loadSemanticCandidates(args: {
	workspaceId: string
	userId: string
	clusterIds: string[]
}) {
	if (args.clusterIds.length === 0) return []
	const candidates = await db
		.select({
			id: workspaceConceptClusterCandidates.id,
			sourceLocalConceptId: workspaceConceptClusterCandidates.sourceLocalConceptId,
			targetLocalConceptId: workspaceConceptClusterCandidates.targetLocalConceptId,
			sourceClusterId: workspaceConceptClusterCandidates.sourceClusterId,
			targetClusterId: workspaceConceptClusterCandidates.targetClusterId,
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
				eq(workspaceConceptClusterCandidates.decisionStatus, "ai_confirmed"),
				or(
					inArray(workspaceConceptClusterCandidates.sourceClusterId, args.clusterIds),
					inArray(workspaceConceptClusterCandidates.targetClusterId, args.clusterIds),
				),
			),
		)
		.orderBy(
			desc(workspaceConceptClusterCandidates.llmConfidence),
			desc(workspaceConceptClusterCandidates.similarityScore),
		)
	const candidateClusterIds = uniqueStrings(
		candidates.flatMap((candidate) =>
			[candidate.sourceClusterId, candidate.targetClusterId].filter(isString),
		),
	)
	const candidateClusters =
		candidateClusterIds.length === 0
			? []
			: await db
					.select({
						id: workspaceConceptClusters.id,
						kind: workspaceConceptClusters.kind,
						displayName: workspaceConceptClusters.displayName,
						canonicalName: workspaceConceptClusters.canonicalName,
						memberCount: workspaceConceptClusters.memberCount,
						paperCount: workspaceConceptClusters.paperCount,
					})
					.from(workspaceConceptClusters)
					.where(
						and(
							inArray(workspaceConceptClusters.id, candidateClusterIds),
							eq(workspaceConceptClusters.workspaceId, args.workspaceId),
							eq(workspaceConceptClusters.ownerUserId, args.userId),
							isNull(workspaceConceptClusters.deletedAt),
						),
					)
	const clusterById = new Map(candidateClusters.map((cluster) => [cluster.id, cluster] as const))
	return candidates.flatMap((candidate) => {
		if (!candidate.sourceClusterId || !candidate.targetClusterId) return []
		const relatedClusterId = args.clusterIds.includes(candidate.sourceClusterId)
			? candidate.targetClusterId
			: candidate.sourceClusterId
		const relatedCluster = clusterById.get(relatedClusterId)
		return [
			{
				id: candidate.id,
				sourceClusterId: candidate.sourceClusterId,
				targetClusterId: candidate.targetClusterId,
				sourceLocalConceptId: candidate.sourceLocalConceptId,
				targetLocalConceptId: candidate.targetLocalConceptId,
				kind: candidate.kind,
				matchMethod: candidate.matchMethod,
				similarityScore: candidate.similarityScore,
				llmDecision: candidate.llmDecision,
				llmConfidence: candidate.llmConfidence,
				decisionStatus: candidate.decisionStatus,
				rationale: candidate.rationale,
				relatedCluster: relatedCluster
					? {
							id: relatedCluster.id,
							displayName: relatedCluster.displayName,
							canonicalName: relatedCluster.canonicalName,
							kind: relatedCluster.kind,
							memberCount: relatedCluster.memberCount,
							paperCount: relatedCluster.paperCount,
						}
					: null,
			},
		]
	})
}

async function loadRelatedPapers(args: {
	workspaceId: string
	userId: string
	paperId: string
	conceptIds: Set<string>
}) {
	const payload = (await loadStablePaperGraphPayload({
		workspaceId: args.workspaceId,
		userId: args.userId,
	})) as StablePaperGraphPayload
	const papersById = new Map(payload.graph.nodes.map((paper) => [paper.id, paper] as const))
	return payload.graph.edges
		.filter((edge) => edge.source === args.paperId || edge.target === args.paperId)
		.map((edge) => {
			const otherPaperId = edge.source === args.paperId ? edge.target : edge.source
			const strongestEvidence = edge.topEvidence.find(
				(item) =>
					args.conceptIds.size === 0 ||
					args.conceptIds.has(item.sourceConceptId) ||
					args.conceptIds.has(item.targetConceptId),
			) ?? edge.topEvidence[0]
			return {
				id: edge.id,
				paper: papersById.get(otherPaperId) ?? null,
				edgeKind: edge.edgeKind,
				weight: edge.weight,
				status: edge.status,
				isRetained: edge.isRetained,
				hasReaderNoteEvidence: edge.hasReaderNoteEvidence,
				strongestEvidence: strongestEvidence
					? {
							sourceConceptId: strongestEvidence.sourceConceptId,
							targetConceptId: strongestEvidence.targetConceptId,
							sourceConceptName: strongestEvidence.sourceConceptName,
							targetConceptName: strongestEvidence.targetConceptName,
							rationale: strongestEvidence.rationale,
							sourceEvidenceBlockIds: strongestEvidence.sourceEvidenceBlockIds,
							targetEvidenceBlockIds: strongestEvidence.targetEvidenceBlockIds,
							currentEvidenceBlockIds:
								edge.source === args.paperId
									? strongestEvidence.sourceEvidenceBlockIds
									: strongestEvidence.targetEvidenceBlockIds,
							otherEvidenceBlockIds:
								edge.source === args.paperId
									? strongestEvidence.targetEvidenceBlockIds
									: strongestEvidence.sourceEvidenceBlockIds,
							sourceEvidenceSnippets: strongestEvidence.sourceEvidenceSnippets,
							targetEvidenceSnippets: strongestEvidence.targetEvidenceSnippets,
						}
					: null,
			}
		})
		.sort((a, b) => b.weight - a.weight)
		.slice(0, 8)
}

function blockCompatiblePayload(payload: Awaited<ReturnType<typeof loadConceptLensPayload>>) {
	return {
		workspaceId: payload.workspaceId,
		paperId: payload.paperId,
		blockId: payload.blockId ?? "",
		scope: payload.scope,
		context: payload.context,
		concepts: payload.concepts,
		semanticCandidates: payload.semanticCandidates,
		relatedPapers: payload.relatedPapers,
		freshness: payload.freshness,
		feedbackActions: payload.feedbackActions,
	}
}

function summarizeFreshness(
	concepts: ReturnType<typeof toConceptPayload>,
	semanticCandidates: Awaited<ReturnType<typeof loadSemanticCandidates>>,
	relatedPapers: Awaited<ReturnType<typeof loadRelatedPapers>>,
) {
	const conceptStatuses = new Set(concepts.map((concept) => concept.status))
	const descriptionStatuses = new Set(concepts.map((concept) => concept.sourceLevelDescriptionStatus))
	return {
		concepts: statusSummary(conceptStatuses),
		descriptions: statusSummary(descriptionStatuses),
		semantic: semanticCandidates.length > 0 ? "done" : "empty",
		graph: relatedPapers.length > 0 ? "done" : "empty",
	}
}

function statusSummary(statuses: Set<string>) {
	if (statuses.size === 0) return "empty"
	if (statuses.has("failed")) return "failed"
	if (statuses.has("running") || statuses.has("pending")) return "running"
	return "done"
}

function dedupeConceptRows<T extends { conceptId: string; evidenceBlockId?: string | null }>(
	rows: T[],
) {
	const byId = new Map<string, T>()
	for (const row of rows) {
		const existing = byId.get(row.conceptId)
		if (!existing || (!existing.evidenceBlockId && row.evidenceBlockId)) byId.set(row.conceptId, row)
	}
	return [...byId.values()]
}

function annotationBodyBoundingBox(body: {
	rects: Array<{ x: number; y: number; w: number; h: number }>
}) {
	const rects = body.rects.filter((rect) => rect.w > 0 && rect.h > 0)
	if (rects.length === 0) return null
	const minX = Math.min(...rects.map((rect) => rect.x))
	const minY = Math.min(...rects.map((rect) => rect.y))
	const maxX = Math.max(...rects.map((rect) => rect.x + rect.w))
	const maxY = Math.max(...rects.map((rect) => rect.y + rect.h))
	return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function rectOverlapRatio(
	a: { x: number; y: number; w: number; h: number } | null,
	b: { x: number; y: number; w: number; h: number },
) {
	if (!a) return 0
	const x1 = Math.max(a.x, b.x)
	const y1 = Math.max(a.y, b.y)
	const x2 = Math.min(a.x + a.w, b.x + b.w)
	const y2 = Math.min(a.y + a.h, b.y + b.h)
	const overlap = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
	const area = Math.max(0.000001, b.w * b.h)
	return overlap / area
}

function firstString(values: unknown, fallback: string[]) {
	if (Array.isArray(values)) {
		const value = values.find((item) => typeof item === "string" && item)
		if (typeof value === "string") return value
	}
	return fallback[0] ?? null
}

function truncateText(value: string | null, max: number) {
	const normalized = (value ?? "").replace(/\s+/g, " ").trim()
	return normalized.length <= max ? normalized : `${normalized.slice(0, max - 3)}...`
}

function uniqueStrings(values: string[]) {
	return [...new Set(values.filter(Boolean))]
}

function isString(value: string | null): value is string {
	return typeof value === "string"
}
