import { EnrichmentApiError } from "./types"

export function normalizeTitle(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
}

export function titleSimilarity(a: string, b: string): number {
	const setA = new Set(a.split(" ").filter((word) => word.length > 2))
	const setB = new Set(b.split(" ").filter((word) => word.length > 2))
	const intersection = new Set([...setA].filter((word) => setB.has(word)))
	const union = new Set([...setA, ...setB])
	return union.size === 0 ? 0 : intersection.size / union.size
}

export async function fetchWithTimeout(
	url: string,
	init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
	const { timeoutMs = 10_000, ...rest } = init
	try {
		return await fetch(url, {
			...rest,
			signal: AbortSignal.timeout(timeoutMs),
		})
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		if (message.toLowerCase().includes("timeout")) {
			throw new EnrichmentApiError("network", "timeout", message)
		}
		throw error
	}
}

export function stripTrailingPunctuation(value: string): string {
	return value.replace(/[.,;:]+$/, "")
}
