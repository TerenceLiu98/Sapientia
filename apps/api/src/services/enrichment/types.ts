import type { ExtractedIdentifiers } from "./identifier-extractor"

export type EnrichmentSource =
	| "crossref"
	| "arxiv"
	| "semantic_scholar"
	| "dblp"
	| "openreview"

export type PublicationType = "journal" | "conference" | "preprint" | "book" | "chapter" | "other"
export type MetadataMatchKind = "precise" | "fuzzy"
export type MetadataField =
	| "title"
	| "authors"
	| "year"
	| "doi"
	| "arxivId"
	| "venue"
	| "abstract"
	| "citationCount"
	| "pages"
	| "volume"
	| "issue"
	| "publisher"
	| "publicationType"
	| "url"

export interface EnrichedMetadata {
	title: string | null
	authors: string[]
	year: number | null
	doi: string | null
	arxivId: string | null
	venue: string | null
	abstract: string | null
	citationCount: number | null
	pages: string | null
	volume: string | null
	issue: string | null
	publisher: string | null
	publicationType: PublicationType | null
	url: string | null
	matchConfidence: number
	matchKind: MetadataMatchKind
	queryKind: EnrichmentQuery["kind"]
	source: EnrichmentSource
}

export interface MetadataFieldProvenance {
	source: EnrichmentSource
	queryKind: EnrichmentQuery["kind"]
	matchKind: MetadataMatchKind
	confidence: number
	updatedAt: string
}

export type MetadataProvenance = Partial<Record<MetadataField, MetadataFieldProvenance>>

export interface MetadataCandidate {
	id: string
	source: EnrichmentSource
	queryKind: EnrichmentQuery["kind"]
	matchKind: MetadataMatchKind
	confidence: number
	metadata: Partial<EnrichedMetadata>
	createdAt: string
}

export type EnrichmentQuery =
	| { kind: "doi"; value: string }
	| { kind: "arxiv_id"; value: string }
	| { kind: "title"; value: string }

export interface EnrichmentPipelineState {
	results: EnrichedMetadata[]
}

export interface EnrichmentOptions {
	semanticScholarApiKey?: string | null
}

export interface MetadataScraper {
	source: EnrichmentSource
	buildQueries: (
		input: ExtractedIdentifiers,
		state: EnrichmentPipelineState,
	) => EnrichmentQuery[]
	fetch: (query: EnrichmentQuery, options: EnrichmentOptions) => Promise<EnrichedMetadata | null>
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
