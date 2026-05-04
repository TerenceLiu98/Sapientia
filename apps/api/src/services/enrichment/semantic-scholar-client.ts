import { z } from "zod"
import { config } from "../../config"
import { EnrichmentApiError, type EnrichedMetadata } from "./types"
import { fetchWithTimeout, normalizeTitle, titleSimilarity } from "./utils"

const SEMANTIC_SCHOLAR_BASE = "https://api.semanticscholar.org/graph/v1"
const fields = ["title", "authors", "year", "venue", "abstract", "citationCount", "externalIds"].join(",")

const SemanticScholarAuthorSchema = z.object({
	name: z.string(),
})

const SemanticScholarPaperSchema = z.object({
	title: z.string().nullable().optional(),
	authors: z.array(SemanticScholarAuthorSchema).optional(),
	year: z.number().nullable().optional(),
	venue: z.string().nullable().optional(),
	abstract: z.string().nullable().optional(),
	citationCount: z.number().nullable().optional(),
	externalIds: z
		.object({
			DOI: z.string().nullable().optional(),
			ArXiv: z.string().nullable().optional(),
		})
		.nullable()
		.optional(),
})

const SemanticScholarSearchResponseSchema = z.object({
	data: z.array(SemanticScholarPaperSchema),
})

function semanticScholarHeaders(apiKey?: string | null) {
	const effectiveApiKey = apiKey?.trim() || config.SEMANTIC_SCHOLAR_API_KEY
	return effectiveApiKey
		? { "x-api-key": effectiveApiKey }
		: undefined
}

export async function lookupById(args: {
	doi?: string | null
	arxivId?: string | null
	apiKey?: string | null
}): Promise<EnrichedMetadata> {
	let identifier: string | null = null
	if (args.doi) identifier = `DOI:${args.doi}`
	else if (args.arxivId) identifier = `ARXIV:${args.arxivId}`
	if (!identifier) {
		throw new EnrichmentApiError("semantic_scholar", "not_found", "no identifier provided")
	}

	const res = await fetchWithTimeout(
		`${SEMANTIC_SCHOLAR_BASE}/paper/${encodeURIComponent(identifier)}?fields=${fields}`,
		{ headers: semanticScholarHeaders(args.apiKey), timeoutMs: 10_000 },
	).catch((error) => {
		if (error instanceof EnrichmentApiError && error.reason === "timeout") {
			throw new EnrichmentApiError("semantic_scholar", "timeout", error.message)
		}
		throw error
	})

	if (res.status === 404) {
		throw new EnrichmentApiError("semantic_scholar", "not_found", `${identifier} not found`)
	}
	if (res.status === 429) {
		throw new EnrichmentApiError("semantic_scholar", "rate_limited", "rate limited")
	}
	if (!res.ok) {
		throw new EnrichmentApiError("semantic_scholar", "api_error", `HTTP ${res.status}`)
	}

	const paper = SemanticScholarPaperSchema.parse(await res.json())
	return normalizePaper(paper)
}

export async function searchByTitle(
	title: string,
	options: { apiKey?: string | null } = {},
): Promise<EnrichedMetadata | null> {
	const res = await fetchWithTimeout(
		`${SEMANTIC_SCHOLAR_BASE}/paper/search?query=${encodeURIComponent(title)}&limit=5&fields=${fields}`,
		{ headers: semanticScholarHeaders(options.apiKey), timeoutMs: 10_000 },
	).catch((error) => {
		if (error instanceof EnrichmentApiError && error.reason === "timeout") {
			throw new EnrichmentApiError("semantic_scholar", "timeout", error.message)
		}
		throw error
	})

	if (res.status === 429) {
		throw new EnrichmentApiError("semantic_scholar", "rate_limited", "rate limited")
	}
	if (!res.ok) {
		throw new EnrichmentApiError("semantic_scholar", "api_error", `HTTP ${res.status}`)
	}

	const parsed = SemanticScholarSearchResponseSchema.parse(await res.json())
	if (parsed.data.length === 0) return null

	const normalizedQuery = normalizeTitle(title)
	let best: { paper: z.infer<typeof SemanticScholarPaperSchema>; score: number } | null = null
	for (const paper of parsed.data) {
		if (!paper.title) continue
		const score = titleSimilarity(normalizedQuery, normalizeTitle(paper.title))
		if (!best || score > best.score) best = { paper, score }
	}
	if (!best || best.score < 0.7) return null
	return normalizePaper(best.paper)
}

function normalizePaper(paper: z.infer<typeof SemanticScholarPaperSchema>): EnrichedMetadata {
	return {
		title: paper.title ?? null,
		authors: paper.authors?.map((author) => author.name) ?? [],
		year: paper.year ?? null,
		doi: paper.externalIds?.DOI ?? null,
		arxivId: paper.externalIds?.ArXiv ?? null,
		venue: paper.venue ?? null,
		abstract: paper.abstract ?? null,
		citationCount: paper.citationCount ?? null,
		source: "semantic_scholar",
	}
}
