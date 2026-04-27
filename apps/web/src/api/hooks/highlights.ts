import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "../client"

// Color is now a free-form string (server-side); the frontend defines a
// builtin palette plus a localStorage-backed user palette in
// `lib/highlight-palette.ts`. The backend just stores whatever string
// the frontend sends, so adding a new color is purely a client change.
export type HighlightColor = string

export interface BlockHighlight {
	id: string
	paperId: string
	blockId: string
	userId: string
	workspaceId: string
	color: HighlightColor
	createdAt: string
	updatedAt: string
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

interface SetInput {
	workspaceId: string
	blockId: string
	color: HighlightColor
}

interface ClearInput {
	workspaceId: string
	blockId: string
}

// PUT: idempotent. Setting the same color twice is a no-op (last-write-wins
// at the DB level via the `(paperId, blockId, userId, workspaceId)` unique
// constraint + ON CONFLICT DO UPDATE).
export function useSetBlockHighlight(paperId: string) {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: (input: SetInput) =>
			apiFetch<BlockHighlight>(`/api/v1/papers/${paperId}/highlights`, {
				method: "PUT",
				body: JSON.stringify(input),
			}),
		onSuccess: (_, variables) => {
			void qc.invalidateQueries({ queryKey: highlightsKey(paperId, variables.workspaceId) })
		},
	})
}

export function useClearBlockHighlight(paperId: string) {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: (input: ClearInput) =>
			apiFetch<{ removed: boolean }>(`/api/v1/papers/${paperId}/highlights`, {
				method: "DELETE",
				body: JSON.stringify(input),
			}),
		onSuccess: (_, variables) => {
			void qc.invalidateQueries({ queryKey: highlightsKey(paperId, variables.workspaceId) })
		},
	})
}
