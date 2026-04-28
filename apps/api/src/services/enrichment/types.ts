import type { ExtractedIdentifiers } from "./identifier-extractor"

export type EnrichmentSource =
	| "crossref"
	| "arxiv"
	| "semantic_scholar"
	| "dblp"
	| "openreview"

export interface EnrichedMetadata {
	title: string | null
	authors: string[]
	year: number | null
	doi: string | null
	arxivId: string | null
	venue: string | null
	abstract: string | null
	citationCount: number | null
	source: EnrichmentSource
}

export type EnrichmentQuery =
	| { kind: "doi"; value: string }
	| { kind: "arxiv_id"; value: string }
	| { kind: "title"; value: string }

export interface EnrichmentPipelineState {
	results: EnrichedMetadata[]
}

export interface MetadataScraper {
	source: EnrichmentSource
	buildQueries: (
		input: ExtractedIdentifiers,
		state: EnrichmentPipelineState,
	) => EnrichmentQuery[]
	fetch: (query: EnrichmentQuery) => Promise<EnrichedMetadata | null>
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
