import { z } from "zod"
import { EnrichmentApiError, type EnrichedMetadata } from "./types"
import { fetchWithTimeout, normalizeTitle, titleSimilarity } from "./utils"

const OPENREVIEW_BASE = "https://api2.openreview.net"

const OpenReviewNoteSchema = z.object({
	id: z.string(),
	content: z.object({
		title: z.object({ value: z.string() }).optional(),
		authors: z.object({ value: z.array(z.string()) }).optional(),
		abstract: z.object({ value: z.string() }).optional(),
		venue: z.object({ value: z.string() }).optional(),
		venueid: z.object({ value: z.string() }).optional(),
		pdate: z.object({ value: z.number() }).optional(),
	}),
})

const OpenReviewSearchResponseSchema = z.object({
	notes: z.array(OpenReviewNoteSchema),
	count: z.number().optional(),
})

export async function searchByTitle(title: string): Promise<EnrichedMetadata | null> {
	const res = await fetchWithTimeout(
		`${OPENREVIEW_BASE}/notes/search?term=${encodeURIComponent(title)}&type=terms&content=all&group=all&source=forum&limit=5`,
		{ timeoutMs: 10_000 },
	).catch((error) => {
		if (error instanceof EnrichmentApiError && error.reason === "timeout") {
			throw new EnrichmentApiError("openreview", "timeout", error.message)
		}
		throw error
	})

	if (res.status === 429) {
		throw new EnrichmentApiError("openreview", "rate_limited", "rate limited")
	}
	if (!res.ok) {
		throw new EnrichmentApiError("openreview", "api_error", `HTTP ${res.status}`)
	}

	const parsed = OpenReviewSearchResponseSchema.parse(await res.json())
	if (parsed.notes.length === 0) return null

	const normalizedQuery = normalizeTitle(title)
	let best: { note: z.infer<typeof OpenReviewNoteSchema>; score: number } | null = null
	for (const note of parsed.notes) {
		const noteTitle = note.content.title?.value
		if (!noteTitle) continue
		const score = titleSimilarity(normalizedQuery, normalizeTitle(noteTitle))
		if (!best || score > best.score) best = { note, score }
	}
	if (!best || best.score < 0.7) return null

	const venue = best.note.content.venue?.value ?? best.note.content.venueid?.value ?? null
	const year = best.note.content.pdate?.value
		? new Date(best.note.content.pdate.value).getUTCFullYear()
		: venue?.match(/\b(20\d{2})\b/)?.[1]
			? Number.parseInt(venue.match(/\b(20\d{2})\b/)?.[1] ?? "", 10)
			: null

	return {
		title: best.note.content.title?.value ?? null,
		authors: best.note.content.authors?.value ?? [],
		year,
		doi: null,
		arxivId: null,
		venue,
		abstract: best.note.content.abstract?.value ?? null,
		citationCount: null,
		pages: null,
		volume: null,
		issue: null,
		publisher: null,
		publicationType: venue && !/openreview|corr|arxiv/i.test(venue) ? "conference" : "preprint",
		url: `https://openreview.net/forum?id=${best.note.id}`,
		matchConfidence: best.score,
		matchKind: "fuzzy",
		queryKind: "title",
		source: "openreview",
	}
}
