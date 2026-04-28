import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "../client"

export type NoteAnchorKind = "page" | "block" | "highlight" | "underline"

export interface Note {
	id: string
	workspaceId: string
	ownerUserId: string
	paperId: string | null
	title: string
	currentVersion: number
	// Marginalia anchor: a note pins to a (page, yRatio) plus optionally a
	// structural source. `anchorKind` declares which id is the user's
	// primary intent — block / highlight / underline / page (no id).
	// Both `anchorBlockId` and `anchorAnnotationId` may co-exist (e.g. a
	// highlight-anchored note also remembers the block it landed inside, so
	// the slip kicker can show "block 7" as a secondary structural tag and
	// jump-to-anchor has a stable fallback if the highlight is later
	// deleted).
	anchorPage: number | null
	anchorYRatio: number | null
	anchorKind: NoteAnchorKind | null
	anchorBlockId: string | null
	anchorAnnotationId: string | null
	createdAt: string
	updatedAt: string
}

export interface NoteWithUrl extends Note {
	jsonUrl: string
	expiresInSeconds: number
}

export function useNotes(workspaceId: string, paperId?: string | null) {
	const qs = paperId === undefined ? "" : paperId === null ? "?paperId=null" : `?paperId=${paperId}`
	return useQuery<Note[]>({
		queryKey: ["notes", workspaceId, paperId ?? "all"],
		queryFn: () => apiFetch<Note[]>(`/api/v1/workspaces/${workspaceId}/notes${qs}`),
		enabled: Boolean(workspaceId),
	})
}

export function useNote(noteId: string) {
	return useQuery<NoteWithUrl>({
		queryKey: ["note", noteId],
		queryFn: () => apiFetch<NoteWithUrl>(`/api/v1/notes/${noteId}`),
		enabled: Boolean(noteId),
		// The presigned URL expires in 30 min; refetch a little before that.
		staleTime: 25 * 60 * 1000,
	})
}

export interface CreateNoteInput {
	paperId?: string | null
	title?: string
	blocknoteJson: unknown
	anchorPage?: number | null
	anchorYRatio?: number | null
	anchorKind?: NoteAnchorKind | null
	anchorBlockId?: string | null
	anchorAnnotationId?: string | null
}

export function useCreateNote(workspaceId: string) {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: (input: CreateNoteInput) =>
			apiFetch<Note>(`/api/v1/workspaces/${workspaceId}/notes`, {
				method: "POST",
				body: JSON.stringify(input),
			}),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["notes", workspaceId] })
		},
	})
}

export interface UpdateNoteInput {
	noteId: string
	title?: string
	blocknoteJson?: unknown
	anchorPage?: number | null
	anchorYRatio?: number | null
	anchorKind?: NoteAnchorKind | null
	anchorBlockId?: string | null
	anchorAnnotationId?: string | null
}

export function useUpdateNote() {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: ({ noteId, ...rest }: UpdateNoteInput) =>
			apiFetch<Note>(`/api/v1/notes/${noteId}`, {
				method: "PUT",
				body: JSON.stringify(rest),
			}),
		onSuccess: (_, variables) => {
			qc.invalidateQueries({ queryKey: ["note", variables.noteId] })
			qc.invalidateQueries({ queryKey: ["notes"] })
		},
	})
}

export function useDeleteNote(workspaceId: string) {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: (noteId: string) => apiFetch<null>(`/api/v1/notes/${noteId}`, { method: "DELETE" }),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["notes", workspaceId] })
		},
	})
}
