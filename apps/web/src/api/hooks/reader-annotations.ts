import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ReaderAnnotationBody, ReaderAnnotationKind } from "@/lib/reader-annotations"
import { apiFetch } from "../client"

export interface ReaderAnnotation {
	id: string
	paperId: string
	workspaceId: string
	userId: string
	page: number
	kind: ReaderAnnotationKind
	color: string
	body: ReaderAnnotationBody
	createdAt: string
	updatedAt: string
}

export interface CreateReaderAnnotationInput {
	workspaceId: string
	page: number
	kind: ReaderAnnotationKind
	color: string
	body: ReaderAnnotationBody
}

const readerAnnotationsKey = (paperId: string, workspaceId: string) =>
	["reader-annotations", paperId, workspaceId] as const

export function useReaderAnnotations(paperId: string, workspaceId: string | undefined) {
	return useQuery<ReaderAnnotation[]>({
		queryKey: readerAnnotationsKey(paperId, workspaceId ?? ""),
		queryFn: () =>
			apiFetch<ReaderAnnotation[]>(
				`/api/v1/papers/${paperId}/reader-annotations?workspaceId=${workspaceId}`,
			),
		enabled: Boolean(paperId) && Boolean(workspaceId),
		staleTime: 60 * 1000,
	})
}

export function useCreateReaderAnnotation(paperId: string) {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: (input: CreateReaderAnnotationInput) =>
			apiFetch<ReaderAnnotation>(`/api/v1/papers/${paperId}/reader-annotations`, {
				method: "POST",
				body: JSON.stringify(input),
			}),
		onSuccess: (_, variables) => {
			void qc.invalidateQueries({
				queryKey: readerAnnotationsKey(paperId, variables.workspaceId),
			})
		},
	})
}

export function useDeleteReaderAnnotation(paperId: string, workspaceId: string | undefined) {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: (annotationId: string) =>
			apiFetch<void>(`/api/v1/reader-annotations/${annotationId}`, { method: "DELETE" }),
		onSuccess: () => {
			if (!workspaceId) return
			void qc.invalidateQueries({
				queryKey: readerAnnotationsKey(paperId, workspaceId),
			})
		},
	})
}
