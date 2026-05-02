import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "../client"
import type { PaperWikiConcept, PaperWikiEdge } from "./papers"

export type WorkspaceGraphViewMode = "papers" | "concepts"

export type ConceptGraphPayload = {
	workspaceId: string
	view?: "concepts"
	visibility: {
		defaultNodeKinds: PaperWikiConcept["kind"][]
		supportingNodeKinds: Array<"dataset" | "person" | "organization">
	}
	graph: {
		nodeCount: number
		edgeCount: number
		relationCounts: Partial<Record<PaperWikiEdge["relationType"], number>>
		semanticCandidateCounts: {
			total: number
			generated: number
			needsReview: number
			userAccepted: number
			userRejected: number
		}
		nodes: ConceptGraphNode[]
		edges: ConceptGraphEdge[]
		semanticCandidates: SemanticCandidate[]
	}
}

export type ConceptGraphNode = {
	id: string
	clusterId: string
	conceptId: string
	label: string
	kind: PaperWikiConcept["kind"]
	canonicalName: string
	status: PaperWikiConcept["status"]
	memberCount: number
	paperCount: number
	salienceScore: number
	confidence: number | null
	updatedAt: string
	degree: number
	evidenceBlockIds: string[]
	members: Array<{
		localConceptId: string
		paperId: string
		paperTitle: string | null
		displayName: string
		canonicalName: string
		salienceScore: number
		sourceLevelDescription: string | null
		sourceLevelDescriptionStatus: "pending" | "running" | "done" | "failed"
		readerSignalSummary: string | null
		evidenceBlockIds: string[]
	}>
}

export type ConceptGraphEdge = {
	id: string
	source: string
	target: string
	sourceConceptId: string
	targetConceptId: string
	relationType: PaperWikiEdge["relationType"]
	confidence: number | null
	evidenceBlockIds: string[]
	localEdgeCount: number
}

export type SemanticCandidate = {
	id: string
	source: string
	target: string
	sourceConceptId: string
	targetConceptId: string
	sourceLocalConceptId: string
	targetLocalConceptId: string
	kind: PaperWikiConcept["kind"]
	matchMethod: "lexical_source_description" | "embedding" | "llm" | "user_confirmed"
	similarityScore: number | null
	llmDecision: "same" | "related" | "different" | "uncertain" | null
	llmConfidence: number | null
	decisionStatus:
		| "candidate"
		| "auto_accepted"
		| "ai_confirmed"
		| "ai_rejected"
		| "needs_review"
		| "rejected"
		| "user_accepted"
		| "user_rejected"
	rationale: string | null
}

export type PaperGraphPayload = {
	workspaceId: string
	view: "papers"
	graph: {
		nodeCount: number
		edgeCount: number
		nodes: PaperGraphNode[]
		edges: PaperGraphEdge[]
	}
}

export type PaperGraphNode = {
	id: string
	paperId: string
	label: string
	title: string
	authors: string[]
	year: number | null
	venue: string | null
	summaryStatus: string
	conceptCount: number
	degree: number
	topConcepts: Array<{
		id: string
		displayName: string
		kind: PaperWikiConcept["kind"]
	}>
}

export type PaperGraphEdge = {
	id: string
	source: string
	target: string
	edgeKind:
		| "shared_concepts"
		| "similar_methods"
		| "same_task"
		| "related_metrics"
		| "semantic_neighbor"
		| "mixed"
	weight: number
	evidenceCount: number
	strongEvidenceCount: number
	maxSimilarity: number | null
	avgSimilarity: number | null
	kinds: string[]
	topEvidence: Array<{
		kind: string
		sourcePaperId: string
		targetPaperId: string
		sourceConceptId: string
		targetConceptId: string
		sourceConceptName: string
		targetConceptName: string
		matchMethod: string
		similarityScore: number
		llmDecision: string | null
		llmConfidence: number | null
		rationale: string | null
		sourceDescription: string | null
		targetDescription: string | null
		sourceEvidenceBlockIds: string[]
		targetEvidenceBlockIds: string[]
		sourceEvidenceSnippets: Array<{
			blockId: string
			snippet: string
		}>
		targetEvidenceSnippets: Array<{
			blockId: string
			snippet: string
		}>
	}>
}

export type WorkspaceGraphPayload = PaperGraphPayload | ConceptGraphPayload

export function useWorkspaceGraph(
	workspaceId: string | undefined,
	view: WorkspaceGraphViewMode = "papers",
) {
	return useQuery<WorkspaceGraphPayload>({
		queryKey: ["workspace-graph", workspaceId ?? "", view],
		queryFn: () =>
			apiFetch<WorkspaceGraphPayload>(`/api/v1/workspaces/${workspaceId}/graph?view=${view}`),
		enabled: Boolean(workspaceId),
		retry: false,
	})
}

export function useReviewSemanticCandidate(workspaceId: string | undefined) {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: {
			candidateId: string
			decisionStatus: "user_accepted" | "user_rejected"
		}) =>
			apiFetch<{ id: string; decisionStatus: "user_accepted" | "user_rejected" }>(
				`/api/v1/workspaces/${workspaceId}/graph/semantic-candidates/${input.candidateId}`,
				{
					method: "PATCH",
					body: JSON.stringify({ decisionStatus: input.decisionStatus }),
				},
			),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["workspace-graph", workspaceId ?? ""] })
			void queryClient.invalidateQueries({ queryKey: ["paper-block-concept-lens"] })
		},
	})
}
