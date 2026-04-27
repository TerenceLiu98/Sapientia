import { logger } from "../../logger"
import * as arxiv from "./arxiv-client"
import * as crossref from "./crossref-client"
import type { ExtractedIdentifiers } from "./identifier-extractor"
import * as openreview from "./openreview-client"
import * as semanticScholar from "./semantic-scholar-client"
import type { EnrichedMetadata } from "./types"

export interface EnrichmentResult {
	metadata: Partial<EnrichedMetadata> | null
	sources: string[]
	status: "enriched" | "partial" | "failed" | "skipped"
}

export async function enrich(ids: ExtractedIdentifiers): Promise<EnrichmentResult> {
	const log = logger.child({ component: "enrichment" })
	const results: EnrichedMetadata[] = []

	if (ids.doi) {
		try {
			results.push(await crossref.lookupByDoi(ids.doi))
			log.info({ doi: ids.doi }, "crossref_hit")
		} catch (error) {
			log.warn({ doi: ids.doi, err: error instanceof Error ? error.message : String(error) }, "crossref_miss")
		}
	}

	if (ids.arxivId) {
		try {
			results.push(await arxiv.lookupByArxivId(ids.arxivId))
			log.info({ arxivId: ids.arxivId }, "arxiv_hit")
		} catch (error) {
			log.warn(
				{ arxivId: ids.arxivId, err: error instanceof Error ? error.message : String(error) },
				"arxiv_miss",
			)
		}
	}

	if (ids.doi || ids.arxivId) {
		try {
			results.push(await semanticScholar.lookupById({ doi: ids.doi, arxivId: ids.arxivId }))
			log.info("semantic_scholar_id_hit")
		} catch (error) {
			log.warn({ err: error instanceof Error ? error.message : String(error) }, "semantic_scholar_id_miss")
		}
	} else if (ids.candidateTitle) {
		try {
			const result = await semanticScholar.searchByTitle(ids.candidateTitle)
			if (result) {
				results.push(result)
				log.info({ title: ids.candidateTitle }, "semantic_scholar_title_hit")
			}
		} catch (error) {
			log.warn({ err: error instanceof Error ? error.message : String(error) }, "semantic_scholar_title_miss")
		}
	}

	const hasVenue = results.some((result) => result.venue)
	if (!hasVenue && ids.candidateTitle) {
		try {
			const result = await openreview.searchByTitle(ids.candidateTitle)
			if (result) {
				results.push(result)
				log.info({ title: ids.candidateTitle }, "openreview_hit")
			}
		} catch (error) {
			log.warn({ err: error instanceof Error ? error.message : String(error) }, "openreview_miss")
		}
	}

	if (results.length === 0) {
		return { metadata: null, sources: [], status: "failed" }
	}

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

	const isFull = Boolean(merged.title && merged.authors?.length && merged.year)
	return {
		metadata: merged,
		sources: results.map((result) => result.source),
		status: isFull ? "enriched" : "partial",
	}
}
