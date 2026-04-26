import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "../client"

export interface Workspace {
	id: string
	name: string
	type: "personal" | "shared"
	role: "owner" | "editor" | "reader"
	createdAt: string
}

export function useWorkspaces() {
	return useQuery<Workspace[]>({
		queryKey: ["workspaces"],
		queryFn: () => apiFetch<Workspace[]>("/api/v1/workspaces"),
	})
}

export function useCurrentWorkspace() {
	const { data, ...rest } = useWorkspaces()
	return { ...rest, data: data?.[0] }
}
