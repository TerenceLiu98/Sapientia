export interface EnrichedMetadata {
	title: string | null
	authors: string[]
	year: number | null
	doi: string | null
	arxivId: string | null
	venue: string | null
	abstract: string | null
	citationCount: number | null
	source: "crossref" | "arxiv" | "semantic_scholar" | "openreview"
}

export class EnrichmentApiError extends Error {
	constructor(
		public source: string,
		public reason: "not_found" | "rate_limited" | "api_error" | "timeout",
		message: string,
	) {
		super(`[${source}] ${reason}: ${message}`)
		this.name = "EnrichmentApiError"
	}
}
