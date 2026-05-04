import { z } from "zod"
import { config } from "../../config"
import { EnrichmentApiError, type EnrichedMetadata } from "./types"
import { fetchWithTimeout } from "./utils"

const CROSSREF_BASE = "https://api.crossref.org"
const politeEmail = config.CROSSREF_POLITE_EMAIL ?? "support@sapientia.app"
const userAgent = `Sapientia/0.1 (mailto:${politeEmail})`

const CrossrefAuthorSchema = z.object({
	given: z.string().optional(),
	family: z.string().optional(),
	name: z.string().optional(),
})

const CrossrefMessageSchema = z.object({
	title: z.array(z.string()).optional(),
	author: z.array(CrossrefAuthorSchema).optional(),
	issued: z
		.object({
			"date-parts": z.array(z.array(z.number())).optional(),
		})
		.optional(),
	DOI: z.string().optional(),
	"container-title": z.array(z.string()).optional(),
	publisher: z.string().optional(),
	abstract: z.string().optional(),
	page: z.string().optional(),
	volume: z.string().optional(),
	issue: z.string().optional(),
	type: z.string().optional(),
	URL: z.string().optional(),
})

const CrossrefResponseSchema = z.object({
	status: z.string(),
	message: CrossrefMessageSchema,
})

export async function lookupByDoi(doi: string): Promise<EnrichedMetadata> {
	const res = await fetchWithTimeout(`${CROSSREF_BASE}/works/${encodeURIComponent(doi)}`, {
		headers: { "user-agent": userAgent },
		timeoutMs: 10_000,
	}).catch((error) => {
		if (error instanceof EnrichmentApiError && error.reason === "timeout") {
			throw new EnrichmentApiError("crossref", "timeout", error.message)
		}
		throw error
	})

	if (res.status === 404) {
		throw new EnrichmentApiError("crossref", "not_found", `DOI ${doi} not found`)
	}
	if (res.status === 429) {
		throw new EnrichmentApiError("crossref", "rate_limited", "rate limited")
	}
	if (!res.ok) {
		throw new EnrichmentApiError("crossref", "api_error", `HTTP ${res.status}`)
	}

	const parsed = CrossrefResponseSchema.parse(await res.json())
	const message = parsed.message
	const authors =
		message.author?.map((author) => {
			if (author.name) return author.name
			return [author.given, author.family].filter(Boolean).join(" ").trim()
		}).filter(Boolean) ?? []

	const year = message.issued?.["date-parts"]?.[0]?.[0] ?? null
	return {
		title: message.title?.[0] ?? null,
		authors,
		year,
		doi: message.DOI ?? doi,
		arxivId: null,
		venue: message["container-title"]?.[0] ?? message.publisher ?? null,
		abstract: message.abstract ?? null,
		citationCount: null,
		pages: message.page ?? null,
		volume: message.volume ?? null,
		issue: message.issue ?? null,
		publisher: message.publisher ?? null,
		publicationType: crossrefPublicationType(message.type),
		url: message.URL ?? null,
		matchConfidence: 1,
		matchKind: "precise",
		queryKind: "doi",
		source: "crossref",
	}
}

function crossrefPublicationType(type: string | undefined): EnrichedMetadata["publicationType"] {
	if (!type) return null
	if (/journal/i.test(type)) return "journal"
	if (/proceedings|conference/i.test(type)) return "conference"
	if (/book-chapter|chapter/i.test(type)) return "chapter"
	if (/book/i.test(type)) return "book"
	if (/posted-content|preprint/i.test(type)) return "preprint"
	return "other"
}
