import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "../client"
import type { PaperWikiConcept, PaperWikiEdge } from "./papers"

export interface WorkspaceGraphPayload {
	workspaceId: string
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
				needsReview: number
				userAccepted: number
				userRejected: number
			}
			nodes: Array<{
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
		}>
		edges: Array<{
			id: string
			source: string
			target: string
			sourceConceptId: string
			targetConceptId: string
			relationType: PaperWikiEdge["relationType"]
			confidence: number | null
			evidenceBlockIds: string[]
			localEdgeCount: number
		}>
		semanticCandidates: Array<{
			id: string
			source: string
			target: string
			sourceConceptId: string
			targetConceptId: string
			sourceLocalConceptId: string
			targetLocalConceptId: string
			kind: PaperWikiConcept["kind"]
			matchMethod:
				| "lexical_source_description"
				| "embedding"
				| "llm"
				| "user_confirmed"
				similarityScore: number | null
				llmDecision: "same" | "related" | "different" | "uncertain" | null
				decisionStatus:
				| "candidate"
				| "auto_accepted"
				| "needs_review"
				| "rejected"
				| "user_accepted"
				| "user_rejected"
			rationale: string | null
		}>
	}
}

export function useWorkspaceGraph(workspaceId: string | undefined) {
	return useQuery<WorkspaceGraphPayload>({
		queryKey: ["workspace-graph", workspaceId ?? ""],
		queryFn: () => apiFetch<WorkspaceGraphPayload>(`/api/v1/workspaces/${workspaceId}/graph`),
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
