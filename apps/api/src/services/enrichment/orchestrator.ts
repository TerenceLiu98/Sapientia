import { logger } from "../../logger"
import type { ExtractedIdentifiers } from "./identifier-extractor"
import { metadataScrapers } from "./scraper-registry"
import type { EnrichedMetadata, EnrichmentQuery, EnrichmentSource } from "./types"

export interface EnrichmentResult {
	metadata: Partial<EnrichedMetadata> | null
	sources: string[]
	status: "enriched" | "partial" | "failed" | "skipped"
}

export async function enrich(ids: ExtractedIdentifiers): Promise<EnrichmentResult> {
	const log = logger.child({ component: "enrichment" })
	const results: EnrichedMetadata[] = []

	for (const scraper of metadataScrapers) {
		const queries = dedupeQueries(scraper.buildQueries(ids, { results }))
		for (const query of queries) {
			try {
				const result = await scraper.fetch(query)
				if (!result) {
					log.warn({ source: scraper.source, queryKind: query.kind }, "scraper_miss")
					continue
				}
				results.push(result)
				log.info(
					{ source: scraper.source, queryKind: query.kind, queryValue: summarizeQueryValue(query) },
					"scraper_hit",
				)
				break
			} catch (error) {
				log.warn(
					{
						source: scraper.source,
						queryKind: query.kind,
						queryValue: summarizeQueryValue(query),
						err: error instanceof Error ? error.message : String(error),
					},
					"scraper_error",
				)
			}
		}
	}

	if (results.length === 0) {
		return { metadata: null, sources: [], status: "failed" }
	}

	const merged = mergeResults(results)
	const isFull = Boolean(merged.title && merged.authors?.length && merged.year)
	return {
		metadata: merged,
		sources: uniqueSources(results),
		status: isFull ? "enriched" : "partial",
	}
}

function mergeResults(results: EnrichedMetadata[]): Partial<EnrichedMetadata> {
	const merged: Partial<EnrichedMetadata> = {}
	for (const result of results) {
		if (!merged.title && result.title) merged.title = result.title
		if (!merged.authors?.length && result.authors.length > 0) merged.authors = result.authors
		if (!merged.year && result.year) merged.year = result.year
		if (!merged.doi && result.doi) merged.doi = result.doi
		if (!merged.arxivId && result.arxivId) merged.arxivId = result.arxivId
		if (!merged.venue && result.venue) merged.venue = result.venue
		if (!merged.abstract && result.abstract) merged.abstract = result.abstract
		if (merged.citationCount == null && result.citationCount != null) {
			merged.citationCount = result.citationCount
		}
	}
	return merged
}

function uniqueSources(results: EnrichedMetadata[]): EnrichmentSource[] {
	return [...new Set(results.map((result) => result.source))]
}

function dedupeQueries(queries: EnrichmentQuery[]): EnrichmentQuery[] {
	const seen = new Set<string>()
	const unique: EnrichmentQuery[] = []
	for (const query of queries) {
		const key = `${query.kind}:${query.value}`
		if (seen.has(key)) continue
		seen.add(key)
		unique.push(query)
	}
	return unique
}

function summarizeQueryValue(query: EnrichmentQuery): string {
	if (query.kind === "title") {
		return query.value.slice(0, 80)
	}
	return query.value
}
