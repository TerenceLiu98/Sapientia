import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "../client"

export type HighlightColor = "questioning" | "important" | "original" | "pending" | "background"

export interface BlockHighlight {
	id: string
	paperId: string
	blockId: string
	userId: string
	workspaceId: string
	charStart: number | null
	charEnd: number | null
	selectedText: string
	color: HighlightColor
	createdAt: string
	updatedAt: string
}

export interface HighlightInput {
	blockId: string
	charStart: number | null
	charEnd: number | null
	selectedText: string
}

interface BatchInput {
	workspaceId: string
	color: HighlightColor
	highlights: HighlightInput[]
}

interface DeleteByRangeInput {
	workspaceId: string
	ranges: Array<{ blockId: string; charStart: number | null; charEnd: number | null }>
}

const highlightsKey = (paperId: string, workspaceId: string) =>
	["highlights", paperId, workspaceId] as const

export function useHighlights(paperId: string, workspaceId: string | undefined) {
	return useQuery<BlockHighlight[]>({
		queryKey: highlightsKey(paperId, workspaceId ?? ""),
		queryFn: () =>
			apiFetch<BlockHighlight[]>(`/api/v1/papers/${paperId}/highlights?workspaceId=${workspaceId}`),
		enabled: Boolean(paperId) && Boolean(workspaceId),
		staleTime: 60 * 1000,
	})
}

export function useCreateHighlightBatch(paperId: string) {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: (input: BatchInput) =>
			apiFetch<BlockHighlight[]>(`/api/v1/papers/${paperId}/highlights/batch`, {
				method: "POST",
				body: JSON.stringify(input),
			}),
		onSuccess: (_, variables) => {
			void qc.invalidateQueries({ queryKey: highlightsKey(paperId, variables.workspaceId) })
		},
	})
}

export function useUpdateHighlightColor(paperId: string, workspaceId: string | undefined) {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: (input: { id: string; color: HighlightColor }) =>
			apiFetch<BlockHighlight>(`/api/v1/highlights/${input.id}`, {
				method: "PATCH",
				body: JSON.stringify({ color: input.color }),
			}),
		onSuccess: () => {
			if (workspaceId) {
				void qc.invalidateQueries({ queryKey: highlightsKey(paperId, workspaceId) })
			}
		},
	})
}

export function useDeleteHighlight(paperId: string, workspaceId: string | undefined) {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: (id: string) => apiFetch<void>(`/api/v1/highlights/${id}`, { method: "DELETE" }),
		onSuccess: () => {
			if (workspaceId) {
				void qc.invalidateQueries({ queryKey: highlightsKey(paperId, workspaceId) })
			}
		},
	})
}

export function useDeleteHighlightsByRange(paperId: string) {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: (input: DeleteByRangeInput) =>
			apiFetch<{ deleted: number }>(`/api/v1/papers/${paperId}/highlights/by-range`, {
				method: "DELETE",
				body: JSON.stringify(input),
			}),
		onSuccess: (_, variables) => {
			void qc.invalidateQueries({ queryKey: highlightsKey(paperId, variables.workspaceId) })
		},
	})
}
