import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "../client"

export type LlmProvider = "anthropic" | "openai"

export interface CredentialsStatus {
	hasMineruToken: boolean
	hasLlmKey: boolean
	llmProvider: LlmProvider | null
	llmBaseUrl: string | null
	llmModel: string | null
}

export interface CredentialsUpdate {
	mineruToken?: string | null
	llmProvider?: LlmProvider | null
	llmApiKey?: string | null
	llmBaseUrl?: string | null
	llmModel?: string | null
}

export function useCredentialsStatus() {
	return useQuery<CredentialsStatus>({
		queryKey: ["credentials", "status"],
		queryFn: () => apiFetch<CredentialsStatus>("/api/v1/me/credentials/status"),
	})
}

export function useUpdateCredentials() {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: (updates: CredentialsUpdate) =>
			apiFetch<{ ok: true }>("/api/v1/me/credentials", {
				method: "PATCH",
				body: JSON.stringify(updates),
			}),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["credentials", "status"] })
		},
	})
}
