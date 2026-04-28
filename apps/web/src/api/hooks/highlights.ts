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
		onMutate: async (variables) => {
			const key = highlightsKey(paperId, variables.workspaceId)
			await qc.cancelQueries({ queryKey: key })
			const previous = qc.getQueryData<BlockHighlight[]>(key) ?? []
			const existing = previous.find((highlight) => highlight.blockId === variables.blockId)
			const optimistic: BlockHighlight = existing
				? { ...existing, color: variables.color, updatedAt: new Date().toISOString() }
				: {
						id: `optimistic-${variables.workspaceId}-${variables.blockId}`,
						paperId,
						blockId: variables.blockId,
						userId: "optimistic",
						workspaceId: variables.workspaceId,
						color: variables.color,
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
					}
			qc.setQueryData<BlockHighlight[]>(
				key,
				existing
					? previous.map((highlight) =>
							highlight.blockId === variables.blockId ? optimistic : highlight,
						)
					: [...previous, optimistic],
			)
			return { key, previous }
		},
		onError: (_error, _variables, context) => {
			if (!context) return
			qc.setQueryData(context.key, context.previous)
		},
		onSuccess: (saved, variables) => {
			const key = highlightsKey(paperId, variables.workspaceId)
			const current = qc.getQueryData<BlockHighlight[]>(key) ?? []
			const next = current.some((highlight) => highlight.blockId === saved.blockId)
				? current.map((highlight) => (highlight.blockId === saved.blockId ? saved : highlight))
				: [...current, saved]
			qc.setQueryData<BlockHighlight[]>(key, next)
		},
		onSettled: (_data, _error, variables) => {
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
		onMutate: async (variables) => {
			const key = highlightsKey(paperId, variables.workspaceId)
			await qc.cancelQueries({ queryKey: key })
			const previous = qc.getQueryData<BlockHighlight[]>(key) ?? []
			qc.setQueryData<BlockHighlight[]>(
				key,
				previous.filter((highlight) => highlight.blockId !== variables.blockId),
			)
			return { key, previous }
		},
		onError: (_error, _variables, context) => {
			if (!context) return
			qc.setQueryData(context.key, context.previous)
		},
		onSettled: (_data, _error, variables) => {
			void qc.invalidateQueries({ queryKey: highlightsKey(paperId, variables.workspaceId) })
		},
	})
}
