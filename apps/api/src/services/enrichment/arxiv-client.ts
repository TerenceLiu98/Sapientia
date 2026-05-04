import { EnrichmentApiError, type EnrichedMetadata } from "./types"
import { fetchWithTimeout, stripTrailingPunctuation } from "./utils"

const ARXIV_BASE = "http://export.arxiv.org/api/query"

export async function lookupByArxivId(arxivId: string): Promise<EnrichedMetadata> {
	const res = await fetchWithTimeout(
		`${ARXIV_BASE}?id_list=${encodeURIComponent(arxivId)}&max_results=1`,
		{ timeoutMs: 10_000 },
	).catch((error) => {
		if (error instanceof EnrichmentApiError && error.reason === "timeout") {
			throw new EnrichmentApiError("arxiv", "timeout", error.message)
		}
		throw error
	})

	if (res.status === 429) {
		throw new EnrichmentApiError("arxiv", "rate_limited", "rate limited")
	}
	if (!res.ok) {
		throw new EnrichmentApiError("arxiv", "api_error", `HTTP ${res.status}`)
	}

	const xml = await res.text()
	const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/)?.[1]
	if (!entry) {
		throw new EnrichmentApiError("arxiv", "not_found", `arXiv ID ${arxivId} not found`)
	}

	const title = decodeXml(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "").replace(/\s+/g, " ").trim()
	const authors = [...entry.matchAll(/<name>([^<]+)<\/name>/g)].map((match) => decodeXml(match[1]).trim())
	const summary = decodeXml(entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? "")
		.replace(/\s+/g, " ")
		.trim()
	const published = entry.match(/<published>([^<]+)<\/published>/)?.[1] ?? null
	const year = published ? new Date(published).getUTCFullYear() : inferArxivYear(arxivId)
	const journalRef = decodeXml(entry.match(/<arxiv:journal_ref[^>]*>([^<]+)<\/arxiv:journal_ref>/)?.[1] ?? "").trim()
	const doi = stripTrailingPunctuation(
		decodeXml(entry.match(/<arxiv:doi[^>]*>([^<]+)<\/arxiv:doi>/)?.[1] ?? "").trim(),
	)

	return {
		title: title || null,
		authors,
		year,
		doi: doi || null,
		arxivId,
		venue: journalRef || "arXiv",
		abstract: summary || null,
		citationCount: null,
		pages: null,
		volume: null,
		issue: null,
		publisher: null,
		publicationType: journalRef ? "journal" : "preprint",
		url: `https://arxiv.org/abs/${arxivId}`,
		matchConfidence: 1,
		matchKind: "precise",
		queryKind: "arxiv_id",
		source: "arxiv",
	}
}

function inferArxivYear(arxivId: string): number | null {
	const yy = Number.parseInt(arxivId.slice(0, 2), 10)
	if (!Number.isFinite(yy)) return null
	const year = 2000 + yy
	return year >= 2007 ? year : null
}

function decodeXml(value: string): string {
	return value
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
}
