import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "../client"

export type BlockType =
	| "text"
	| "heading"
	| "figure"
	| "table"
	| "equation"
	| "list"
	| "code"
	| "other"

export interface Block {
	paperId: string
	blockId: string
	blockIndex: number
	type: BlockType
	page: number
	bbox: { x: number; y: number; w: number; h: number } | null
	text: string
	headingLevel: number | null
	caption: string | null
	imageObjectKey: string | null
	metadata: Record<string, unknown> | null
}

export function useBlocks(paperId: string) {
	return useQuery<Block[]>({
		queryKey: ["paper", paperId, "blocks"],
		queryFn: () => apiFetch<Block[]>(`/api/v1/papers/${paperId}/blocks`),
		enabled: Boolean(paperId),
		staleTime: 60 * 1000,
	})
}
