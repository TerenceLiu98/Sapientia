import { useMutation } from "@tanstack/react-query"
import { apiFetch } from "../client"

export interface AskAgentForNoteInput {
	paperId: string
	workspaceId: string
	question: string
	selectionContext?: {
		blockIds: string[]
		selectedText?: string
	}
}

export interface AskAgentForNoteResponse {
	answer: string
	model: string
	promptId: string
	inputTokens: number
	outputTokens: number
}

export function useAskAgentForNote() {
	return useMutation({
		mutationFn: (input: AskAgentForNoteInput) =>
			apiFetch<AskAgentForNoteResponse>("/api/v1/agent/note-ask", {
				method: "POST",
				body: JSON.stringify(input),
			}),
	})
}
