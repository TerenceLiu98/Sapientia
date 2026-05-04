import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "../client"

export interface Workspace {
	id: string
	name: string
	type: "personal" | "shared"
	role: "owner" | "editor" | "reader"
	createdAt: string
}

export function useWorkspaces(options?: { enabled?: boolean }) {
	return useQuery<Workspace[]>({
		queryKey: ["workspaces"],
		queryFn: () => apiFetch<Workspace[]>("/api/v1/workspaces"),
		enabled: options?.enabled ?? true,
	})
}

export function useCurrentWorkspace(options?: { enabled?: boolean }) {
	const { data, ...rest } = useWorkspaces(options)
	return { ...rest, data: data?.[0] }
}
