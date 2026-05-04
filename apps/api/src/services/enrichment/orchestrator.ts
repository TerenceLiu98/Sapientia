import { logger } from "../../logger"
import type { ExtractedIdentifiers } from "./identifier-extractor"
import { metadataScrapers } from "./scraper-registry"
import type {
	EnrichedMetadata,
	EnrichmentOptions,
	EnrichmentQuery,
	EnrichmentSource,
	MetadataCandidate,
	MetadataField,
	MetadataProvenance,
} from "./types"

export interface EnrichmentResult {
	metadata: Partial<EnrichedMetadata> | null
	candidates: MetadataCandidate[]
	provenance: MetadataProvenance
	sources: string[]
	status: "enriched" | "partial" | "failed" | "skipped"
}

const AUTO_FUZZY_THRESHOLD = 0.86
const CANDIDATE_FUZZY_THRESHOLD = 0.72

const metadataFields = [
	"title",
	"authors",
	"year",
	"doi",
	"arxivId",
	"venue",
	"abstract",
	"citationCount",
	"pages",
	"volume",
	"issue",
	"publisher",
	"publicationType",
	"url",
] as const satisfies readonly MetadataField[]

export async function enrich(
	ids: ExtractedIdentifiers,
	options: EnrichmentOptions = {},
): Promise<EnrichmentResult> {
	const log = logger.child({ component: "enrichment" })
	const results: EnrichedMetadata[] = []

	for (const scraper of metadataScrapers) {
		const queries = dedupeQueries(scraper.buildQueries(ids, { results }))
		for (const query of queries) {
			try {
				const result = await scraper.fetch(query, options)
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
		return { metadata: null, candidates: [], provenance: {}, sources: [], status: "failed" }
	}

	const followUpResults = await fetchDoiFollowUp(ids, results, options)
	results.push(...followUpResults)

	const candidates = buildCandidates(results)
	const mergeableResults = results.filter(isAutoMergeable)
	const { metadata: merged, provenance } = mergeResults(mergeableResults)
	const isFull = Boolean(merged.title && merged.authors?.length && merged.year)
	const hasAnyMetadata = metadataFields.some((field) => hasValue(merged[field]))
	return {
		metadata: hasAnyMetadata ? merged : null,
		candidates,
		provenance,
		sources: uniqueSources(results),
		status: isFull ? "enriched" : hasAnyMetadata || candidates.length > 0 ? "partial" : "failed",
	}
}

async function fetchDoiFollowUp(
	ids: ExtractedIdentifiers,
	results: EnrichedMetadata[],
	options: EnrichmentOptions,
): Promise<EnrichedMetadata[]> {
	if (ids.doi || results.some((result) => result.source === "crossref")) return []
	const doi = results.find((result) => result.doi)?.doi
	if (!doi) return []

	const crossref = metadataScrapers.find((scraper) => scraper.source === "crossref")
	if (!crossref) return []

	try {
		const result = await crossref.fetch({ kind: "doi", value: doi }, options)
		return result ? [result] : []
	} catch (error) {
		logger.warn(
			{ source: "crossref", queryKind: "doi", err: error instanceof Error ? error.message : String(error) },
			"scraper_follow_up_error",
		)
		return []
	}
}

function mergeResults(results: EnrichedMetadata[]): {
	metadata: Partial<EnrichedMetadata>
	provenance: MetadataProvenance
} {
	const merged: Partial<EnrichedMetadata> = {}
	const provenance: MetadataProvenance = {}
	const bestScores = new Map<MetadataField, number>()

	for (const result of results) {
		for (const field of metadataFields) {
			const value = result[field]
			if (!hasValue(value)) continue
			const score = fieldPriority(field, result) + result.matchConfidence
			if (score <= (bestScores.get(field) ?? Number.NEGATIVE_INFINITY)) continue
			bestScores.set(field, score)
			;(merged as Record<MetadataField, unknown>)[field] = value
			provenance[field] = {
				source: result.source,
				queryKind: result.queryKind,
				matchKind: result.matchKind,
				confidence: result.matchConfidence,
				updatedAt: new Date().toISOString(),
			}
		}
	}

	return { metadata: merged, provenance }
}

function isAutoMergeable(result: EnrichedMetadata): boolean {
	if (result.matchKind === "precise") return true
	return result.matchConfidence >= AUTO_FUZZY_THRESHOLD
}

function buildCandidates(results: EnrichedMetadata[]): MetadataCandidate[] {
	return results
		.filter((result) => result.matchKind === "fuzzy")
		.filter((result) => result.matchConfidence >= CANDIDATE_FUZZY_THRESHOLD)
		.filter((result) => result.matchConfidence < AUTO_FUZZY_THRESHOLD)
		.map((result) => ({
			id: candidateId(result),
			source: result.source,
			queryKind: result.queryKind,
			matchKind: result.matchKind,
			confidence: result.matchConfidence,
			metadata: result,
			createdAt: new Date().toISOString(),
		}))
}

function fieldPriority(field: MetadataField, result: EnrichedMetadata): number {
	const preciseBonus = result.matchKind === "precise" ? 10 : 0
	if (["title", "authors", "year", "doi", "arxivId"].includes(field)) {
		return sourcePriority(result.source, {
			semantic_scholar: 100,
			crossref: 95,
			arxiv: 80,
			dblp: 75,
			openreview: 65,
		}) + preciseBonus
	}

	if (["venue", "pages", "volume", "issue", "publisher", "publicationType"].includes(field)) {
		return sourcePriority(result.source, {
			crossref: 100,
			dblp: 90,
			semantic_scholar: 70,
			openreview: 60,
			arxiv: 50,
		}) + preciseBonus
	}

	if (["abstract", "citationCount"].includes(field)) {
		return sourcePriority(result.source, {
			semantic_scholar: 100,
			arxiv: 80,
			openreview: 70,
			crossref: 60,
			dblp: 10,
		}) + preciseBonus
	}

	return sourcePriority(result.source, {
		semantic_scholar: 90,
		crossref: 80,
		arxiv: 70,
		dblp: 60,
		openreview: 50,
	}) + preciseBonus
}

function sourcePriority(
	source: EnrichmentSource,
	priorities: Partial<Record<EnrichmentSource, number>>,
): number {
	return priorities[source] ?? 0
}

function hasValue(value: unknown): boolean {
	if (value == null) return false
	if (Array.isArray(value)) return value.length > 0
	if (typeof value === "string") return value.trim().length > 0
	return true
}

function candidateId(result: EnrichedMetadata): string {
	const seed = [
		result.source,
		result.queryKind,
		result.matchConfidence.toFixed(3),
		result.doi ?? "",
		result.arxivId ?? "",
		result.title ?? "",
	].join(":")
	let hash = 0
	for (let index = 0; index < seed.length; index += 1) {
		hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
	}
	return `${result.source}-${hash.toString(36)}`
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
