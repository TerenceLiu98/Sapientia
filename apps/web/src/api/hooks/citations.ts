import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "../client"

export interface CitationCount {
	blockId: string
	count: number
}

export interface NoteCitingBlock {
	noteId: string
	title: string
	workspaceId: string
	citationCount: number
	updatedAt: string
}

export function usePaperCitationCounts(paperId: string) {
	return useQuery<CitationCount[]>({
		queryKey: ["paper", paperId, "citation-counts"],
		queryFn: () => apiFetch<CitationCount[]>(`/api/v1/papers/${paperId}/citation-counts`),
		enabled: Boolean(paperId),
		staleTime: 60 * 1000,
	})
}

export function useNotesForBlock(paperId: string, blockId: string | null) {
	return useQuery<NoteCitingBlock[]>({
		queryKey: ["paper", paperId, "block", blockId, "notes"],
		queryFn: () => apiFetch<NoteCitingBlock[]>(`/api/v1/papers/${paperId}/blocks/${blockId}/notes`),
		enabled: Boolean(paperId && blockId),
	})
}

export interface NoteCitations {
	noteId: string
	blockIds: string[]
	annotations: Array<{ id: string; kind: "highlight" | "underline" }>
}

// All citations grouped by note for the given paper. Drives the
// marginalia rail dot colors — each dot mixes the colors of every block
// or annotation the note cites in its body.
export function usePaperNoteCitations(paperId: string) {
	return useQuery<NoteCitations[]>({
		queryKey: ["paper", paperId, "note-citations"],
		queryFn: () => apiFetch<NoteCitations[]>(`/api/v1/papers/${paperId}/note-citations`),
		enabled: Boolean(paperId),
		staleTime: 60 * 1000,
	})
}
