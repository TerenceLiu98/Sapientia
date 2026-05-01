import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
	ReaderAnnotationBody,
	ReaderAnnotationKind,
	ReaderAnnotationTool,
} from "@/lib/reader-annotations"
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
	// Set when the annotation has been deleted but a note still cites it.
	// The reader renders these as faint ghost rects; the citation chip uses
	// them to resolve a page/y position so jumps still work.
	deletedAt: string | null
}

export interface CreateReaderAnnotationInput {
	workspaceId: string
	page: number
	kind: ReaderAnnotationTool
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
		onMutate: async (variables) => {
			const key = readerAnnotationsKey(paperId, variables.workspaceId)
			await qc.cancelQueries({ queryKey: key })
			const previous = qc.getQueryData<ReaderAnnotation[]>(key) ?? []
			const optimistic: ReaderAnnotation = {
				id: `optimistic-${variables.workspaceId}-${Date.now()}`,
				paperId,
				workspaceId: variables.workspaceId,
				userId: "optimistic",
				page: variables.page,
				kind: variables.kind,
				color: variables.color,
				body: variables.body,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				deletedAt: null,
			}
			qc.setQueryData<ReaderAnnotation[]>(key, [...previous, optimistic])
			return { key, previous, optimisticId: optimistic.id }
		},
		onError: (_error, _variables, context) => {
			if (!context) return
			qc.setQueryData(context.key, context.previous)
		},
		onSuccess: (saved, variables, context) => {
			const key = readerAnnotationsKey(paperId, variables.workspaceId)
			const current = qc.getQueryData<ReaderAnnotation[]>(key) ?? []
			qc.setQueryData<ReaderAnnotation[]>(
				key,
				current.map((annotation) =>
					annotation.id === context?.optimisticId ? saved : annotation,
				),
			)
		},
		onSettled: (_data, _error, variables) => {
			void qc.invalidateQueries({
				queryKey: readerAnnotationsKey(paperId, variables.workspaceId),
			})
		},
	})
}

export function useUpdateReaderAnnotationColor(
	paperId: string,
	workspaceId: string | undefined,
) {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: ({ annotationId, color }: { annotationId: string; color: string }) =>
			apiFetch<ReaderAnnotation>(`/api/v1/reader-annotations/${annotationId}`, {
				method: "PATCH",
				body: JSON.stringify({ color }),
			}),
		onMutate: async ({ annotationId, color }) => {
			if (!workspaceId) return
			const key = readerAnnotationsKey(paperId, workspaceId)
			await qc.cancelQueries({ queryKey: key })
			const previous = qc.getQueryData<ReaderAnnotation[]>(key) ?? []
			qc.setQueryData<ReaderAnnotation[]>(
				key,
				previous.map((annotation) =>
					annotation.id === annotationId
						? { ...annotation, color, updatedAt: new Date().toISOString() }
						: annotation,
				),
			)
			return { key, previous }
		},
		onError: (_error, _variables, context) => {
			if (!context) return
			qc.setQueryData(context.key, context.previous)
		},
		onSuccess: (saved) => {
			if (!workspaceId) return
			const key = readerAnnotationsKey(paperId, workspaceId)
			const current = qc.getQueryData<ReaderAnnotation[]>(key) ?? []
			qc.setQueryData<ReaderAnnotation[]>(
				key,
				current.map((annotation) => (annotation.id === saved.id ? saved : annotation)),
			)
		},
		onSettled: () => {
			if (!workspaceId) return
			void qc.invalidateQueries({
				queryKey: readerAnnotationsKey(paperId, workspaceId),
			})
		},
	})
}

// The server returns 204 (hard delete) or { softDeleted: true } when a note
// still references the annotation. We mirror both outcomes in cache: hard
// delete drops the row; soft delete leaves it in place but stamps deletedAt
// so the reader renders a ghost rect.
interface DeleteReaderAnnotationResponse {
	softDeleted?: boolean
}

export function useDeleteReaderAnnotation(paperId: string, workspaceId: string | undefined) {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: (annotationId: string) =>
			apiFetch<DeleteReaderAnnotationResponse | null>(
				`/api/v1/reader-annotations/${annotationId}`,
				{ method: "DELETE" },
			),
		onMutate: async (annotationId) => {
			if (!workspaceId) return
			const key = readerAnnotationsKey(paperId, workspaceId)
			await qc.cancelQueries({ queryKey: key })
			const previous = qc.getQueryData<ReaderAnnotation[]>(key) ?? []
			// Optimistically stamp deletedAt — if the server hard-deletes,
			// onSettled invalidates and the row drops out anyway.
			const stampedAt = new Date().toISOString()
			qc.setQueryData<ReaderAnnotation[]>(
				key,
				previous.map((annotation) =>
					annotation.id === annotationId ? { ...annotation, deletedAt: stampedAt } : annotation,
				),
			)
			return { key, previous }
		},
		onError: (_error, _variables, context) => {
			if (!context) return
			qc.setQueryData(context.key, context.previous)
		},
		onSettled: () => {
			if (!workspaceId) return
			void qc.invalidateQueries({
				queryKey: readerAnnotationsKey(paperId, workspaceId),
			})
		},
	})
}

export function useRestoreReaderAnnotation(paperId: string, workspaceId: string | undefined) {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: (annotationId: string) =>
			apiFetch<ReaderAnnotation>(`/api/v1/reader-annotations/${annotationId}/restore`, {
				method: "POST",
			}),
		onMutate: async (annotationId) => {
			if (!workspaceId) return
			const key = readerAnnotationsKey(paperId, workspaceId)
			await qc.cancelQueries({ queryKey: key })
			const previous = qc.getQueryData<ReaderAnnotation[]>(key) ?? []
			qc.setQueryData<ReaderAnnotation[]>(
				key,
				previous.map((annotation) =>
					annotation.id === annotationId ? { ...annotation, deletedAt: null } : annotation,
				),
			)
			return { key, previous }
		},
		onError: (_error, _variables, context) => {
			if (!context) return
			qc.setQueryData(context.key, context.previous)
		},
		onSuccess: (saved) => {
			if (!workspaceId) return
			const key = readerAnnotationsKey(paperId, workspaceId)
			const current = qc.getQueryData<ReaderAnnotation[]>(key) ?? []
			qc.setQueryData<ReaderAnnotation[]>(
				key,
				current.map((annotation) => (annotation.id === saved.id ? saved : annotation)),
			)
		},
		onSettled: () => {
			if (!workspaceId) return
			void qc.invalidateQueries({
				queryKey: readerAnnotationsKey(paperId, workspaceId),
			})
		},
	})
}
