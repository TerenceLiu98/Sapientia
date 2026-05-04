import type { ExtractedIdentifiers } from "./identifier-extractor"
import * as arxiv from "./arxiv-client"
import * as crossref from "./crossref-client"
import * as dblp from "./dblp-client"
import * as openreview from "./openreview-client"
import * as semanticScholar from "./semantic-scholar-client"
import type { EnrichmentPipelineState, EnrichmentQuery, MetadataScraper } from "./types"

function titleQuery(input: ExtractedIdentifiers): EnrichmentQuery[] {
	return input.candidateTitle ? [{ kind: "title", value: input.candidateTitle }] : []
}

export const metadataScrapers: MetadataScraper[] = [
	{
		source: "crossref",
		buildQueries(input) {
			return input.doi ? [{ kind: "doi", value: input.doi }] : []
		},
		async fetch(query) {
			if (query.kind !== "doi") return null
			return crossref.lookupByDoi(query.value)
		},
	},
	{
		source: "arxiv",
		buildQueries(input) {
			return input.arxivId ? [{ kind: "arxiv_id", value: input.arxivId }] : []
		},
		async fetch(query) {
			if (query.kind !== "arxiv_id") return null
			return arxiv.lookupByArxivId(query.value)
		},
	},
	{
		source: "semantic_scholar",
		buildQueries(input) {
			if (input.doi) return [{ kind: "doi", value: input.doi }]
			if (input.arxivId) return [{ kind: "arxiv_id", value: input.arxivId }]
			return titleQuery(input)
		},
		async fetch(query, options) {
			if (query.kind === "doi") {
				return semanticScholar.lookupById({
					doi: query.value,
					apiKey: options.semanticScholarApiKey,
				})
			}
			if (query.kind === "arxiv_id") {
				return semanticScholar.lookupById({
					arxivId: query.value,
					apiKey: options.semanticScholarApiKey,
				})
			}
			if (query.kind === "title") {
				return semanticScholar.searchByTitle(query.value, {
					apiKey: options.semanticScholarApiKey,
				})
			}
			return null
		},
	},
	{
		source: "dblp",
		buildQueries(input) {
			return titleQuery(input)
		},
		async fetch(query) {
			if (query.kind !== "title") return null
			return dblp.searchByTitle(query.value)
		},
	},
	{
		source: "openreview",
		buildQueries(input, state: EnrichmentPipelineState) {
			if (state.results.some((result) => result.venue)) return []
			return titleQuery(input)
		},
		async fetch(query) {
			if (query.kind !== "title") return null
			return openreview.searchByTitle(query.value)
		},
	},
]
