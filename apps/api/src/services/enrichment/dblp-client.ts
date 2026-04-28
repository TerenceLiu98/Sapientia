import { z } from "zod"
import { EnrichmentApiError, type EnrichedMetadata } from "./types"
import { fetchWithTimeout, normalizeTitle, titleSimilarity } from "./utils"

const DBLP_BASE = "https://dblp.org/search/publ/api"

const DblpAuthorSchema = z.union([
	z.string(),
	z.object({
		text: z.string().optional(),
	}),
])

const DblpInfoSchema = z.object({
	title: z.string().optional(),
	venue: z.string().optional(),
	year: z.union([z.string(), z.number()]).optional(),
	doi: z.string().optional(),
	ee: z.string().optional(),
	authors: z
		.object({
			author: z.union([DblpAuthorSchema, z.array(DblpAuthorSchema)]).optional(),
		})
		.optional(),
})

const DblpHitSchema = z.object({
	info: DblpInfoSchema,
})

const DblpResponseSchema = z.object({
	result: z.object({
		hits: z.object({
			hit: z.union([DblpHitSchema, z.array(DblpHitSchema)]).optional(),
		}),
	}),
})

export async function searchByTitle(title: string): Promise<EnrichedMetadata | null> {
	const res = await fetchWithTimeout(
		`${DBLP_BASE}?q=${encodeURIComponent(title)}&format=json&h=5`,
		{ timeoutMs: 10_000 },
	).catch((error) => {
		if (error instanceof EnrichmentApiError && error.reason === "timeout") {
			throw new EnrichmentApiError("dblp", "timeout", error.message)
		}
		throw error
	})

	if (res.status === 429) {
		throw new EnrichmentApiError("dblp", "rate_limited", "rate limited")
	}
	if (!res.ok) {
		throw new EnrichmentApiError("dblp", "api_error", `HTTP ${res.status}`)
	}

	const parsed = DblpResponseSchema.parse(await res.json())
	const hits = parsed.result.hits.hit
	if (!hits) return null

	const hitList = Array.isArray(hits) ? hits : [hits]
	const normalizedQuery = normalizeTitle(title)
	let best: { info: z.infer<typeof DblpInfoSchema>; score: number } | null = null
	for (const hit of hitList) {
		const hitTitle = hit.info.title
		if (!hitTitle) continue
		const score = titleSimilarity(normalizedQuery, normalizeTitle(hitTitle))
		if (!best || score > best.score) best = { info: hit.info, score }
	}

	if (!best || best.score < 0.7) return null

	const info = best.info
	return {
		title: info.title ?? null,
		authors: normalizeAuthors(info.authors?.author),
		year: normalizeYear(info.year),
		doi: normalizeDoi(info.doi, info.ee),
		arxivId: null,
		venue: info.venue ?? null,
		abstract: null,
		citationCount: null,
		source: "dblp",
	}
}

function normalizeAuthors(
	authors: z.infer<typeof DblpAuthorSchema> | Array<z.infer<typeof DblpAuthorSchema>> | undefined,
): string[] {
	if (!authors) return []
	const authorList = Array.isArray(authors) ? authors : [authors]
	return authorList
		.map((author) => {
			if (typeof author === "string") return author.trim()
			return author.text?.trim() ?? ""
		})
		.filter((author) => author.length > 0)
}

function normalizeYear(year: string | number | undefined): number | null {
	if (typeof year === "number") return year
	if (!year) return null
	const parsed = Number.parseInt(year, 10)
	return Number.isFinite(parsed) ? parsed : null
}

function normalizeDoi(doi: string | undefined, ee: string | undefined): string | null {
	if (doi?.trim()) return doi.trim()
	if (!ee) return null
	const match = ee.match(/^https?:\/\/(?:dx\.)?doi\.org\/(.+)$/i)
	return match?.[1] ? decodeURIComponent(match[1]) : null
}
