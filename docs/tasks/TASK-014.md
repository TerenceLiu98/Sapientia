# TASK-014: Paper metadata enrichment + intelligent filenames + BibTeX export

**Estimated effort**: 3 working days
**Depends on**: TASK-011 (block data available)
**Phase**: 2 — Block-Level Foundation (tail end)

---

## Context

After TASK-013, users can read papers, take notes, and cite blocks. But papers in the library still show clumsy filenames and incomplete metadata. There's no way to export the corpus as BibTeX. This task fixes both, and **establishes the metadata enrichment pipeline** — Sapientia's promise that uploading a PDF produces a paper with as-complete-as-possible metadata, automatically.

This task encodes ADR-020 (read it first if you haven't). The strategic context:

Sapientia is a **standalone** tool. Users upload PDFs and get a complete library experience without first having to organize them in Zotero or PaperLib. That requires automatic metadata enrichment from public APIs. We don't reimplement PaperLib's scraping (multi-month effort, web scraping, fragile); we use four well-documented public APIs that cover ~90% of academic papers:

- **CrossRef** — DOI lookup, broadest journal coverage
- **arXiv** — preprint coverage
- **Semantic Scholar** — cross-disciplinary, venue/abstract/reference graph
- **OpenReview** — NeurIPS / ICLR / ICML / TMLR / CoLM proceedings

The enrichment runs as a separate BullMQ job in parallel with MinerU parsing. It typically completes in seconds (vs MinerU's minutes), so users see metadata fill in promptly after upload while parsing continues in the background.

Manual edit is always available as a final fallback — no automatic system catches every paper, and users sometimes need to correct bad metadata.

---

## Acceptance Criteria

1. **Schema additions** to `papers`: `year`, `venue`, `displayFilename`, `enrichmentStatus`, `enrichmentSource` (which API succeeded), `metadataEditedByUser` (jsonb tracking which fields user edited).
2. **New `paper-enrich` BullMQ queue + worker job** that runs in parallel with `paper-parse`. Triggered on paper upload immediately, not waiting for MinerU.
3. **Four API clients** in `apps/api/src/services/enrichment/`:
   - `crossref-client.ts`
   - `arxiv-client.ts`
   - `semantic-scholar-client.ts`
   - `openreview-client.ts`
4. **Identifier extraction from PDF** in `apps/api/src/services/enrichment/identifier-extractor.ts` — extracts DOI, arXiv ID, candidate title from raw PDF text (lightweight; not waiting for MinerU). Uses `pdf-parse` or similar to get first ~3 pages of text.
5. **Fallback chain orchestrator** in `apps/api/src/services/enrichment/orchestrator.ts` — runs the chain (DOI → CrossRef; arXiv ID → arXiv; title → Semantic Scholar; CS conf title → OpenReview), merges results, picks best.
6. **`displayFilename`** computed as `{firstAuthorLastName}-{year}-{first-3-words-of-title}.pdf`, sanitized.
7. **Manual edit endpoint**: `PATCH /api/v1/papers/{id}` accepts `{ title?, authors?, year?, doi?, arxivId?, venue? }`. Records user edits in `metadataEditedByUser` so future re-enrichment doesn't overwrite them.
8. **BibTeX export endpoints**: `GET /api/v1/papers/{id}/bibtex`, `GET /api/v1/workspaces/{wid}/papers/bibtex`.
9. **PDF download endpoint** updated to include `downloadFilename` in response.
10. **Frontend**: library shows real titles, "edit metadata" modal, "Export BibTeX" button, enrichment status badge (`enriching` / `enriched` / `partial` / `failed`).
11. **Tests**: each API client (mocked HTTP), identifier extractor, orchestrator fallback chain, manual edit user-fields-protection, BibTeX serialization correctness.

---

## Part 1: Schema + Migration

### Update `papers`

`packages/db/src/schema/papers.ts` — add fields:

```typescript
export const papers = pgTable(
  "papers",
  {
    // ... existing fields

    year: integer("year"),
    venue: text("venue"),
    displayFilename: text("display_filename").notNull().default(""),

    // Enrichment lifecycle
    enrichmentStatus: text("enrichment_status", {
      enum: ["pending", "enriching", "enriched", "partial", "failed", "skipped"],
    }).notNull().default("pending"),
    enrichmentSource: text("enrichment_source"),  // e.g., "crossref", "arxiv", "merged"
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),

    // Track which fields the user has manually edited; enrichment won't overwrite these
    metadataEditedByUser: jsonb("metadata_edited_by_user")
      .$type<{
        title?: boolean
        authors?: boolean
        year?: boolean
        doi?: boolean
        arxivId?: boolean
        venue?: boolean
      }>()
      .notNull()
      .default({}),

    // existing fields continue...
  },
  // existing indexes...
)
```

Generate migration:

```bash
pnpm db:generate
pnpm db:migrate
```

---

## Part 2: Identifier extraction

We need to extract DOI/arXiv ID/candidate title from the PDF **before** MinerU runs (MinerU is slow). A lightweight extractor reads the first 3 pages of text directly.

```bash
cd apps/api
bun add pdf-parse
```

`apps/api/src/services/enrichment/identifier-extractor.ts`:

```typescript
import pdfParse from "pdf-parse"

const DOI_PATTERN = /\b10\.\d{4,9}\/[^\s\]<>"]+/g
const ARXIV_ID_PATTERN = /\b(\d{4}\.\d{4,5})(v\d+)?\b/

export interface ExtractedIdentifiers {
  doi: string | null
  arxivId: string | null
  candidateTitle: string | null
  rawHeadText: string
}

/**
 * Extract identifying info from the first ~3 pages of a PDF.
 * Lightweight — runs immediately on upload, doesn't wait for MinerU.
 */
export async function extractIdentifiers(args: {
  pdfBytes: Buffer
  filename: string
}): Promise<ExtractedIdentifiers> {
  const { pdfBytes, filename } = args

  let text = ""
  try {
    const result = await pdfParse(pdfBytes, { max: 3 })
    text = result.text ?? ""
  } catch {
    // Some PDFs can't be parsed by pdf-parse; that's OK, we'll fall through
    text = ""
  }

  // DOI: first match in the text, sanitized
  const doiMatches = text.match(DOI_PATTERN)
  const doi = doiMatches?.[0]?.replace(/[.,;:]+$/, "") ?? null

  // arXiv ID: from filename first (more reliable), then from text
  let arxivId: string | null = null
  const fileMatch = filename.match(ARXIV_ID_PATTERN)
  if (fileMatch) {
    arxivId = fileMatch[1]
  } else {
    const textMatch = text.match(ARXIV_ID_PATTERN)
    if (textMatch) arxivId = textMatch[1]
  }

  // Candidate title: first non-empty line that's reasonably title-like
  // (10-300 chars, mostly capitalized words, not all caps)
  const candidateTitle = extractCandidateTitle(text)

  return {
    doi,
    arxivId,
    candidateTitle,
    rawHeadText: text.slice(0, 5000),
  }
}

function extractCandidateTitle(text: string): string | null {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  for (const line of lines.slice(0, 30)) {
    if (line.length < 10 || line.length > 300) continue
    if (line === line.toUpperCase()) continue  // skip all-caps headers
    if (/^(abstract|introduction|page|figure|table)\b/i.test(line)) continue
    if (/^\d+$/.test(line)) continue
    // Looks plausibly like a title: has letters and is not garbage
    if (/[a-z]/.test(line) && /[a-zA-Z]{3,}/.test(line)) {
      return line.slice(0, 300)
    }
  }
  return null
}
```

> **Note**: `pdf-parse` works in most cases but fails on encrypted/scanned PDFs. That's OK — we fall through to "no identifiers extracted, no enrichment, manual edit only" gracefully.

---

## Part 3: API Clients

Each client is independent, returns a normalized shape, throws on error.

### Normalized shape

`apps/api/src/services/enrichment/types.ts`:

```typescript
export interface EnrichedMetadata {
  title: string | null
  authors: string[]
  year: number | null
  doi: string | null
  arxivId: string | null
  venue: string | null
  abstract: string | null
  citationCount: number | null  // Optional, for v0.2 features
  source: "crossref" | "arxiv" | "semantic_scholar" | "openreview"
}

export class EnrichmentApiError extends Error {
  constructor(
    public source: string,
    public reason: "not_found" | "rate_limited" | "api_error" | "timeout",
    message: string,
  ) {
    super(`[${source}] ${reason}: ${message}`)
  }
}
```

### CrossRef client

`apps/api/src/services/enrichment/crossref-client.ts`:

```typescript
import { z } from "zod"
import { config } from "../../config"
import { logger } from "../../logger"
import { EnrichmentApiError, type EnrichedMetadata } from "./types"

const CROSSREF_BASE = "https://api.crossref.org"
const POLITE_EMAIL = config.CROSSREF_POLITE_EMAIL  // optional; gives priority routing
const USER_AGENT = `Sapientia/0.1 (mailto:${POLITE_EMAIL ?? "support@sapientia.app"})`

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
  type: z.string().optional(),
  abstract: z.string().optional(),
})

const CrossrefResponseSchema = z.object({
  status: z.string(),
  message: CrossrefMessageSchema,
})

export async function lookupByDoi(doi: string): Promise<EnrichedMetadata> {
  const url = `${CROSSREF_BASE}/works/${encodeURIComponent(doi)}`
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(10_000),
  })

  if (res.status === 404) {
    throw new EnrichmentApiError("crossref", "not_found", `DOI ${doi} not in CrossRef`)
  }
  if (res.status === 429) {
    throw new EnrichmentApiError("crossref", "rate_limited", "rate limited")
  }
  if (!res.ok) {
    throw new EnrichmentApiError("crossref", "api_error", `HTTP ${res.status}`)
  }

  const json = await res.json()
  const parsed = CrossrefResponseSchema.parse(json)
  const m = parsed.message

  const authors = (m.author ?? []).map((a) => {
    if (a.name) return a.name
    return [a.given, a.family].filter(Boolean).join(" ").trim()
  }).filter(Boolean)

  const year = m.issued?.["date-parts"]?.[0]?.[0] ?? null

  return {
    title: m.title?.[0] ?? null,
    authors,
    year,
    doi: m.DOI ?? doi,
    arxivId: null,
    venue: m["container-title"]?.[0] ?? null,
    abstract: m.abstract ?? null,
    citationCount: null,
    source: "crossref",
  }
}
```

### arXiv client

`apps/api/src/services/enrichment/arxiv-client.ts`:

```typescript
import { config } from "../../config"
import { EnrichmentApiError, type EnrichedMetadata } from "./types"

const ARXIV_BASE = "http://export.arxiv.org/api/query"
const USER_AGENT = `Sapientia/0.1 (mailto:${config.CROSSREF_POLITE_EMAIL ?? "support@sapientia.app"})`

/**
 * Look up a paper by arXiv ID.
 * Note: arXiv API returns Atom XML, not JSON. We do minimal parsing.
 */
export async function lookupByArxivId(arxivId: string): Promise<EnrichedMetadata> {
  const url = `${ARXIV_BASE}?id_list=${arxivId}&max_results=1`
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    throw new EnrichmentApiError("arxiv", "api_error", `HTTP ${res.status}`)
  }

  const xml = await res.text()
  const entry = extractFirstEntry(xml)
  if (!entry) {
    throw new EnrichmentApiError("arxiv", "not_found", `arXiv ID ${arxivId} not found`)
  }

  const title = (entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "")
    .replace(/\s+/g, " ")
    .trim() || null

  const summary = (entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? "")
    .replace(/\s+/g, " ")
    .trim() || null

  const authors = Array.from(
    entry.matchAll(/<author>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<\/author>/g),
  ).map((m) => m[1].trim()).filter(Boolean)

  const publishedMatch = entry.match(/<published>(\d{4})-/)
  const year = publishedMatch ? parseInt(publishedMatch[1], 10) : null

  // arXiv ID year sanity check
  const arxivYear = 2000 + parseInt(arxivId.slice(0, 2), 10)
  const finalYear = year ?? (arxivYear >= 2007 ? arxivYear : null)

  // Try to extract journal-ref / venue
  const journalRef = entry.match(/<arxiv:journal_ref[^>]*>([^<]+)<\/arxiv:journal_ref>/)?.[1]?.trim() ?? null

  // DOI sometimes present
  const doi = entry.match(/<arxiv:doi[^>]*>([^<]+)<\/arxiv:doi>/)?.[1]?.trim() ?? null

  return {
    title,
    authors,
    year: finalYear,
    doi,
    arxivId,
    venue: journalRef,
    abstract: summary,
    citationCount: null,
    source: "arxiv",
  }
}

function extractFirstEntry(xml: string): string | null {
  const match = xml.match(/<entry>([\s\S]*?)<\/entry>/)
  return match?.[1] ?? null
}
```

> **Note**: minimal regex-based XML parsing. A proper XML parser (e.g., `fast-xml-parser`) is more robust if you want to invest 30 minutes; for arXiv's stable API the regex is fine.

### Semantic Scholar client

`apps/api/src/services/enrichment/semantic-scholar-client.ts`:

```typescript
import { z } from "zod"
import { config } from "../../config"
import { EnrichmentApiError, type EnrichedMetadata } from "./types"

const S2_BASE = "https://api.semanticscholar.org/graph/v1"
const FIELDS = "title,authors,year,venue,abstract,externalIds,citationCount"

const S2PaperSchema = z.object({
  paperId: z.string(),
  title: z.string().nullable().optional(),
  authors: z.array(z.object({ name: z.string().nullable().optional() })).optional(),
  year: z.number().nullable().optional(),
  venue: z.string().nullable().optional(),
  abstract: z.string().nullable().optional(),
  citationCount: z.number().nullable().optional(),
  externalIds: z.record(z.string(), z.string().nullable()).optional(),
})

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  if (config.SEMANTIC_SCHOLAR_API_KEY) {
    headers["x-api-key"] = config.SEMANTIC_SCHOLAR_API_KEY
  }
  return headers
}

/** Look up by DOI or arXiv ID. */
export async function lookupById(args: {
  doi?: string | null
  arxivId?: string | null
}): Promise<EnrichedMetadata> {
  let query: string
  if (args.doi) query = `DOI:${args.doi}`
  else if (args.arxivId) query = `arXiv:${args.arxivId}`
  else throw new EnrichmentApiError("semantic_scholar", "api_error", "no identifier")

  const url = `${S2_BASE}/paper/${encodeURIComponent(query)}?fields=${FIELDS}`
  const res = await fetch(url, {
    headers: buildHeaders(),
    signal: AbortSignal.timeout(10_000),
  })

  if (res.status === 404) {
    throw new EnrichmentApiError("semantic_scholar", "not_found", `${query} not found`)
  }
  if (res.status === 429) {
    throw new EnrichmentApiError("semantic_scholar", "rate_limited", "rate limited")
  }
  if (!res.ok) {
    throw new EnrichmentApiError("semantic_scholar", "api_error", `HTTP ${res.status}`)
  }

  return mapPaper(S2PaperSchema.parse(await res.json()))
}

/** Search by title for fuzzy match — fallback when no identifier. */
export async function searchByTitle(title: string): Promise<EnrichedMetadata | null> {
  const url = `${S2_BASE}/paper/search?query=${encodeURIComponent(title)}&fields=${FIELDS}&limit=3`
  const res = await fetch(url, {
    headers: buildHeaders(),
    signal: AbortSignal.timeout(10_000),
  })

  if (res.status === 429) {
    throw new EnrichmentApiError("semantic_scholar", "rate_limited", "rate limited")
  }
  if (!res.ok) {
    throw new EnrichmentApiError("semantic_scholar", "api_error", `HTTP ${res.status}`)
  }

  const json = await res.json()
  const data = z.object({ data: z.array(S2PaperSchema).optional() }).parse(json)
  const candidates = data.data ?? []
  if (candidates.length === 0) return null

  // Pick the best match: highest title similarity
  const best = pickBestTitleMatch(title, candidates)
  if (!best) return null

  return mapPaper(best)
}

function mapPaper(p: z.infer<typeof S2PaperSchema>): EnrichedMetadata {
  return {
    title: p.title ?? null,
    authors: (p.authors ?? []).map((a) => a.name ?? "").filter(Boolean),
    year: p.year ?? null,
    doi: p.externalIds?.DOI ?? null,
    arxivId: p.externalIds?.ArXiv ?? null,
    venue: p.venue ?? null,
    abstract: p.abstract ?? null,
    citationCount: p.citationCount ?? null,
    source: "semantic_scholar",
  }
}

function pickBestTitleMatch(
  query: string,
  candidates: Array<z.infer<typeof S2PaperSchema>>,
): z.infer<typeof S2PaperSchema> | null {
  const q = normalizeTitle(query)
  let best: { paper: z.infer<typeof S2PaperSchema>; score: number } | null = null
  for (const p of candidates) {
    if (!p.title) continue
    const score = titleSimilarity(q, normalizeTitle(p.title))
    if (!best || score > best.score) best = { paper: p, score }
  }
  // Reject if similarity is too low
  return best && best.score > 0.7 ? best.paper : null
}

function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim()
}

function titleSimilarity(a: string, b: string): number {
  // Jaccard on word sets — simple and effective for title fuzzy match
  const setA = new Set(a.split(" ").filter((w) => w.length > 2))
  const setB = new Set(b.split(" ").filter((w) => w.length > 2))
  const intersection = new Set([...setA].filter((w) => setB.has(w)))
  const union = new Set([...setA, ...setB])
  return union.size === 0 ? 0 : intersection.size / union.size
}
```

### OpenReview client

`apps/api/src/services/enrichment/openreview-client.ts`:

```typescript
import { z } from "zod"
import { EnrichmentApiError, type EnrichedMetadata } from "./types"

const OPENREVIEW_BASE = "https://api2.openreview.net"

const OpenReviewNoteSchema = z.object({
  id: z.string(),
  forum: z.string().optional(),
  content: z.object({
    title: z.object({ value: z.string() }).optional(),
    authors: z.object({ value: z.array(z.string()) }).optional(),
    abstract: z.object({ value: z.string() }).optional(),
    venue: z.object({ value: z.string() }).optional(),
    venueid: z.object({ value: z.string() }).optional(),
    pdate: z.object({ value: z.number() }).optional(),  // ms since epoch
  }),
})

const OpenReviewSearchResponseSchema = z.object({
  notes: z.array(OpenReviewNoteSchema),
  count: z.number().optional(),
})

export async function searchByTitle(title: string): Promise<EnrichedMetadata | null> {
  const url = `${OPENREVIEW_BASE}/notes/search?term=${encodeURIComponent(title)}&type=terms&content=all&group=all&source=forum&limit=5`
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })

  if (res.status === 429) {
    throw new EnrichmentApiError("openreview", "rate_limited", "rate limited")
  }
  if (!res.ok) {
    throw new EnrichmentApiError("openreview", "api_error", `HTTP ${res.status}`)
  }

  const json = await res.json()
  const parsed = OpenReviewSearchResponseSchema.parse(json)
  const notes = parsed.notes ?? []
  if (notes.length === 0) return null

  // Pick best match by title similarity
  const queryNorm = normalizeTitle(title)
  let best: { note: z.infer<typeof OpenReviewNoteSchema>; score: number } | null = null
  for (const note of notes) {
    const noteTitle = note.content.title?.value
    if (!noteTitle) continue
    const score = titleSimilarity(queryNorm, normalizeTitle(noteTitle))
    if (!best || score > best.score) best = { note, score }
  }
  if (!best || best.score < 0.7) return null

  const c = best.note.content
  const venue = c.venue?.value ?? c.venueid?.value ?? null

  let year: number | null = null
  if (c.pdate?.value) {
    year = new Date(c.pdate.value).getUTCFullYear()
  } else if (venue) {
    const m = venue.match(/\b(20\d{2})\b/)
    if (m) year = parseInt(m[1], 10)
  }

  return {
    title: c.title?.value ?? null,
    authors: c.authors?.value ?? [],
    year,
    doi: null,
    arxivId: null,
    venue,
    abstract: c.abstract?.value ?? null,
    citationCount: null,
    source: "openreview",
  }
}

// Re-use the helpers from semantic-scholar-client (extract to shared util if duplicated)
function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim()
}
function titleSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(" ").filter((w) => w.length > 2))
  const setB = new Set(b.split(" ").filter((w) => w.length > 2))
  const intersection = new Set([...setA].filter((w) => setB.has(w)))
  const union = new Set([...setA, ...setB])
  return union.size === 0 ? 0 : intersection.size / union.size
}
```

Move `normalizeTitle` and `titleSimilarity` to `apps/api/src/services/enrichment/utils.ts` if you want to dedupe.

---

## Part 4: Orchestrator

`apps/api/src/services/enrichment/orchestrator.ts`:

```typescript
import { logger } from "../../logger"
import type { EnrichedMetadata } from "./types"
import type { ExtractedIdentifiers } from "./identifier-extractor"
import * as crossref from "./crossref-client"
import * as arxiv from "./arxiv-client"
import * as semanticScholar from "./semantic-scholar-client"
import * as openreview from "./openreview-client"

export interface EnrichmentResult {
  metadata: Partial<EnrichedMetadata> | null
  sources: string[]  // Which APIs contributed
  status: "enriched" | "partial" | "failed" | "skipped"
}

/**
 * Run the enrichment chain. Returns merged metadata or null.
 * Never throws — all errors are caught and logged.
 */
export async function enrich(
  ids: ExtractedIdentifiers,
): Promise<EnrichmentResult> {
  const log = logger.child({ component: "enrichment" })
  const results: EnrichedMetadata[] = []

  // Tier 1: DOI → CrossRef (highest quality for journal papers)
  if (ids.doi) {
    try {
      const r = await crossref.lookupByDoi(ids.doi)
      results.push(r)
      log.info({ doi: ids.doi }, "crossref_hit")
    } catch (err) {
      log.warn({ doi: ids.doi, err: (err as Error).message }, "crossref_miss")
    }
  }

  // Tier 2: arXiv ID → arXiv API
  if (ids.arxivId) {
    try {
      const r = await arxiv.lookupByArxivId(ids.arxivId)
      results.push(r)
      log.info({ arxivId: ids.arxivId }, "arxiv_hit")
    } catch (err) {
      log.warn({ arxivId: ids.arxivId, err: (err as Error).message }, "arxiv_miss")
    }
  }

  // Tier 3: Semantic Scholar (by ID if we have one, otherwise by title)
  if (ids.doi || ids.arxivId) {
    try {
      const r = await semanticScholar.lookupById({
        doi: ids.doi,
        arxivId: ids.arxivId,
      })
      results.push(r)
      log.info("s2_id_hit")
    } catch (err) {
      log.warn({ err: (err as Error).message }, "s2_id_miss")
    }
  } else if (ids.candidateTitle) {
    try {
      const r = await semanticScholar.searchByTitle(ids.candidateTitle)
      if (r) {
        results.push(r)
        log.info({ title: ids.candidateTitle }, "s2_title_hit")
      }
    } catch (err) {
      log.warn({ err: (err as Error).message }, "s2_title_miss")
    }
  }

  // Tier 4: OpenReview (CS conference fallback by title)
  // Run only if no other source got a venue, and we have a candidate title
  const hasVenue = results.some((r) => r.venue)
  if (!hasVenue && ids.candidateTitle) {
    try {
      const r = await openreview.searchByTitle(ids.candidateTitle)
      if (r) {
        results.push(r)
        log.info({ title: ids.candidateTitle }, "openreview_hit")
      }
    } catch (err) {
      log.warn({ err: (err as Error).message }, "openreview_miss")
    }
  }

  if (results.length === 0) {
    return { metadata: null, sources: [], status: "failed" }
  }

  // Merge: prefer earlier sources (= higher tier) for conflicting fields
  const merged: Partial<EnrichedMetadata> = {}
  for (const r of results) {
    if (!merged.title && r.title) merged.title = r.title
    if (!merged.authors?.length && r.authors.length > 0) merged.authors = r.authors
    if (!merged.year && r.year) merged.year = r.year
    if (!merged.doi && r.doi) merged.doi = r.doi
    if (!merged.arxivId && r.arxivId) merged.arxivId = r.arxivId
    if (!merged.venue && r.venue) merged.venue = r.venue
    if (!merged.abstract && r.abstract) merged.abstract = r.abstract
    if (merged.citationCount == null && r.citationCount != null) {
      merged.citationCount = r.citationCount
    }
  }

  // "enriched" = title + authors + year all present
  const isFull = !!(merged.title && merged.authors?.length && merged.year)
  return {
    metadata: merged,
    sources: results.map((r) => r.source),
    status: isFull ? "enriched" : "partial",
  }
}
```

---

## Part 5: Worker job

### Queue

`apps/api/src/queues/paper-enrich.ts`:

```typescript
import { Queue } from "bullmq"
import { queueConnection } from "./connection"

export const PAPER_ENRICH_QUEUE = "paper-enrich"

export interface PaperEnrichJobData {
  paperId: string
  userId: string
}

export const paperEnrichQueue = new Queue<PaperEnrichJobData>(PAPER_ENRICH_QUEUE, {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
})

export async function enqueuePaperEnrich(data: PaperEnrichJobData) {
  return paperEnrichQueue.add(`enrich-${data.paperId}`, data, {
    jobId: `paper-enrich:${data.paperId}`,
  })
}
```

### Worker

`apps/api/src/workers/paper-enrich.worker.ts`:

```typescript
import { Worker, type Job } from "bullmq"
import { eq } from "drizzle-orm"
import { papers, createDbClient } from "@sapientia/db"
import { config } from "../config"
import { logger } from "../logger"
import { queueConnection } from "../queues/connection"
import {
  PAPER_ENRICH_QUEUE,
  type PaperEnrichJobData,
} from "../queues/paper-enrich"
import { extractIdentifiers } from "../services/enrichment/identifier-extractor"
import { enrich } from "../services/enrichment/orchestrator"
import { buildDisplayFilename } from "../services/filename"
import { s3Client } from "../services/s3-client"
import { GetObjectCommand } from "@aws-sdk/client-s3"

const { db } = createDbClient(config.DATABASE_URL)

async function processEnrich(job: Job<PaperEnrichJobData>): Promise<void> {
  const { paperId, userId } = job.data
  const log = logger.child({ jobId: job.id, paperId })

  const [paper] = await db.select().from(papers).where(eq(papers.id, paperId)).limit(1)
  if (!paper) {
    log.warn("paper_not_found")
    return
  }

  await db
    .update(papers)
    .set({ enrichmentStatus: "enriching", updatedAt: new Date() })
    .where(eq(papers.id, paperId))

  // Download PDF from MinIO
  let pdfBytes: Buffer
  try {
    const res = await s3Client.send(
      new GetObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: paper.pdfObjectKey,
      }),
    )
    const stream = res.Body as ReadableStream
    const chunks: Uint8Array[] = []
    const reader = stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
    pdfBytes = Buffer.concat(chunks)
  } catch (err) {
    log.error({ err }, "pdf_download_failed")
    await db
      .update(papers)
      .set({ enrichmentStatus: "failed", updatedAt: new Date() })
      .where(eq(papers.id, paperId))
    return
  }

  // Extract identifiers
  const ids = await extractIdentifiers({
    pdfBytes,
    filename: paper.title,  // initial title is the filename
  })
  log.info({ doi: ids.doi, arxivId: ids.arxivId, hasTitle: !!ids.candidateTitle }, "identifiers_extracted")

  if (!ids.doi && !ids.arxivId && !ids.candidateTitle) {
    log.info("no_identifiers_found")
    await db
      .update(papers)
      .set({ enrichmentStatus: "skipped", updatedAt: new Date() })
      .where(eq(papers.id, paperId))
    return
  }

  // Run enrichment chain
  const result = await enrich(ids)

  // Apply, respecting user-edited fields
  const protectedFields = paper.metadataEditedByUser ?? {}
  const updates: Partial<typeof papers.$inferInsert> = {
    enrichmentStatus: result.status,
    enrichmentSource: result.sources.join(","),
    enrichedAt: new Date(),
    updatedAt: new Date(),
  }

  if (result.metadata) {
    if (!protectedFields.title && result.metadata.title) updates.title = result.metadata.title
    if (!protectedFields.authors && result.metadata.authors?.length) updates.authors = result.metadata.authors
    if (!protectedFields.year && result.metadata.year) updates.year = result.metadata.year
    if (!protectedFields.doi && result.metadata.doi) updates.doi = result.metadata.doi
    if (!protectedFields.arxivId && result.metadata.arxivId) updates.arxivId = result.metadata.arxivId
    if (!protectedFields.venue && result.metadata.venue) updates.venue = result.metadata.venue

    // Recompute displayFilename
    updates.displayFilename = buildDisplayFilename({
      paperId: paper.id,
      title: (updates.title as string) ?? paper.title,
      authors: (updates.authors as string[]) ?? paper.authors ?? [],
      year: (updates.year as number) ?? paper.year,
    })
  }

  await db.update(papers).set(updates).where(eq(papers.id, paperId))
  log.info({ status: result.status, sources: result.sources }, "enrichment_completed")
}

export function createPaperEnrichWorker() {
  return new Worker<PaperEnrichJobData>(PAPER_ENRICH_QUEUE, processEnrich, {
    connection: queueConnection,
    concurrency: 4,
  })
}
```

Register in `worker.ts`:

```typescript
import { createPaperEnrichWorker } from "./workers/paper-enrich.worker"
const enrichWorker = createPaperEnrichWorker()
// ... add to shutdown handler
```

### Trigger on upload

In `apps/api/src/services/paper.ts`, the existing `uploadPaper` enqueues `paper-parse` (TASK-009). Now also enqueue `paper-enrich` after fresh insert (not on dedup):

```typescript
import { enqueuePaperEnrich } from "../queues/paper-enrich"
// ...
// at the end of fresh-insert path:
await enqueuePaperParse({ paperId: paper.id, userId })
await enqueuePaperEnrich({ paperId: paper.id, userId })
```

---

## Part 6: Filename builder

`apps/api/src/services/filename.ts`:

```typescript
const MAX_LEN = 100

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "in", "on", "at",
  "to", "for", "with", "by", "from", "as", "is", "are", "was", "were",
])

export function buildDisplayFilename(args: {
  paperId: string
  title: string | null
  authors: string[]
  year: number | null
}): string {
  const { paperId, title, authors, year } = args

  const lastName = authors[0] ? extractLastName(authors[0]) : null
  const yearStr = year ? String(year) : null
  const titleSlug = title ? sluggifyTitle(title) : null

  const parts: string[] = []
  if (lastName) parts.push(lastName)
  if (yearStr) parts.push(yearStr)
  if (titleSlug) parts.push(titleSlug)

  if (parts.length === 0) {
    return `paper-${paperId.slice(0, 8)}.pdf`
  }

  let name = parts.join("-")
  name = name.replace(/[^A-Za-z0-9\-.]/g, "")
  name = name.replace(/-+/g, "-").replace(/^-|-$/g, "")

  if (name.length > MAX_LEN - 4) name = name.slice(0, MAX_LEN - 4)
  return `${name}.pdf`
}

function extractLastName(fullName: string): string {
  const trimmed = fullName.trim()
  if (trimmed.includes(",")) {
    return trimmed.split(",")[0].trim().replace(/\s+/g, "")
  }
  const parts = trimmed.split(/\s+/)
  return parts[parts.length - 1] ?? trimmed
}

function sluggifyTitle(title: string): string {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w))
    .slice(0, 5)
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join("-")
}
```

---

## Part 7: Manual edit endpoint

`apps/api/src/routes/papers.ts` (extend):

```typescript
import { z } from "zod"

const PatchPaperSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  authors: z.array(z.string()).max(50).optional(),
  year: z.number().int().min(1900).max(2100).nullable().optional(),
  doi: z.string().max(200).nullable().optional(),
  arxivId: z.string().max(50).nullable().optional(),
  venue: z.string().max(200).nullable().optional(),
})

paperRoutes.patch("/papers/:id", requireAuth, async (c) => {
  const id = c.req.param("id")
  const user = c.get("user")
  const body = PatchPaperSchema.parse(await c.req.json())

  const [paper] = await db.select().from(papers).where(eq(papers.id, id)).limit(1)
  if (!paper || paper.deletedAt) return c.json({ error: "not found" }, 404)
  if (!(await userCanAccessPaper(user.id, paper.id, db))) {
    return c.json({ error: "forbidden" }, 403)
  }

  // Track which fields the user is editing — protects them from re-enrichment
  const editedFields = { ...(paper.metadataEditedByUser ?? {}) }
  for (const field of ["title", "authors", "year", "doi", "arxivId", "venue"] as const) {
    if (field in body) editedFields[field] = true
  }

  // Recompute displayFilename if metadata changed
  const newTitle = body.title ?? paper.title
  const newAuthors = body.authors ?? paper.authors ?? []
  const newYear = body.year !== undefined ? body.year : paper.year
  const displayFilename = buildDisplayFilename({
    paperId: paper.id,
    title: newTitle,
    authors: newAuthors,
    year: newYear,
  })

  const [updated] = await db
    .update(papers)
    .set({
      ...body,
      displayFilename,
      metadataEditedByUser: editedFields,
      updatedAt: new Date(),
    })
    .where(eq(papers.id, id))
    .returning()

  return c.json(updated)
})
```

---

## Part 8: BibTeX export

`apps/api/src/services/bibtex.ts`:

```typescript
import type { Paper } from "@sapientia/db"

const LATEX_ESCAPES: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "{": "\\{",
  "}": "\\}",
  "$": "\\$",
  "&": "\\&",
  "#": "\\#",
  "%": "\\%",
  "_": "\\_",
  "^": "\\^{}",
  "~": "\\~{}",
}

function escapeLatex(s: string): string {
  return s.replace(/[\\{}$&#%_^~]/g, (c) => LATEX_ESCAPES[c] ?? c)
}

function bibtexKey(paper: Pick<Paper, "id" | "authors" | "year" | "title">): string {
  const lastName = paper.authors?.[0]
    ? extractLastName(paper.authors[0]).toLowerCase()
    : null
  const year = paper.year ? String(paper.year) : null
  const titleWord = paper.title
    ? paper.title.toLowerCase().split(/\s+/).find((w) => w.length > 3) ?? null
    : null
  const parts = [lastName, year, titleWord].filter(Boolean)
  if (parts.length === 0) return `paper-${paper.id.slice(0, 8)}`
  return parts.join("").replace(/[^a-z0-9]/g, "")
}

function extractLastName(fullName: string): string {
  if (fullName.includes(",")) return fullName.split(",")[0].trim()
  const parts = fullName.trim().split(/\s+/)
  return parts[parts.length - 1] ?? fullName
}

export function paperToBibtex(paper: Paper): string {
  const key = bibtexKey(paper)

  let entryType = "article"
  if (paper.arxivId && !paper.venue) entryType = "misc"
  if (paper.venue?.toLowerCase().match(/conference|proceedings|workshop|symposium/)) {
    entryType = "inproceedings"
  }

  const fields: string[] = []

  if (paper.title) fields.push(`  title = {${escapeLatex(paper.title)}}`)
  if (paper.authors && paper.authors.length > 0) {
    const authorStr = paper.authors.map(escapeLatex).join(" and ")
    fields.push(`  author = {${authorStr}}`)
  }
  if (paper.year) fields.push(`  year = {${paper.year}}`)
  if (paper.doi) fields.push(`  doi = {${escapeLatex(paper.doi)}}`)
  if (paper.arxivId) {
    fields.push(`  eprint = {${paper.arxivId}}`)
    fields.push(`  archivePrefix = {arXiv}`)
  }
  if (paper.venue) {
    const venueField = entryType === "inproceedings" ? "booktitle" : "journal"
    fields.push(`  ${venueField} = {${escapeLatex(paper.venue)}}`)
  }

  return `@${entryType}{${key},\n${fields.join(",\n")}\n}`
}

export function papersToBibtex(papers: Paper[]): string {
  const header = `% BibTeX export from Sapientia\n% Generated: ${new Date().toISOString()}\n\n`
  return header + papers.map(paperToBibtex).join("\n\n") + "\n"
}
```

Endpoints in `apps/api/src/routes/papers.ts`:

```typescript
paperRoutes.get("/papers/:id/bibtex", requireAuth, async (c) => {
  // ... access check
  const bib = paperToBibtex(paper)
  c.header("content-type", "application/x-bibtex; charset=utf-8")
  c.header("content-disposition", `attachment; filename="${paper.displayFilename.replace(/\.pdf$/, ".bib")}"`)
  return c.body(bib)
})

paperRoutes.get(
  "/workspaces/:workspaceId/papers/bibtex",
  requireAuth,
  requireMembership("reader"),
  async (c) => {
    // ... fetch all papers in workspace
    const bib = papersToBibtex(rows.map((r) => r.paper))
    c.header("content-type", "application/x-bibtex; charset=utf-8")
    c.header("content-disposition", `attachment; filename="sapientia-${workspaceId.slice(0, 8)}.bib"`)
    return c.body(bib)
  },
)
```

---

## Part 9: PDF download with displayFilename

```typescript
paperRoutes.get("/papers/:id/pdf-url", requireAuth, async (c) => {
  // ... existing access checks

  const url = await generatePresignedGetUrl(paper.pdfObjectKey, 3600)
  return c.json({
    url,
    expiresInSeconds: 3600,
    downloadFilename: paper.displayFilename || `paper-${paper.id.slice(0, 8)}.pdf`,
  })
})
```

---

## Part 10: Frontend

### Library shows real titles + enrichment badge

Update `LibraryTable`:

```typescript
columnHelper.accessor("title", {
  header: "Title",
  cell: (info) => {
    const paper = info.row.original
    return (
      <div className="flex items-center gap-2">
        <Link to="/papers/$paperId" params={{ paperId: paper.id }}>
          {paper.title || `Untitled (${paper.id.slice(0, 8)})`}
        </Link>
        <EnrichmentBadge status={paper.enrichmentStatus} />
      </div>
    )
  },
}),
columnHelper.accessor("authors", {
  header: "Authors",
  cell: (info) => {
    const a = info.getValue() ?? []
    if (a.length === 0) return ""
    if (a.length === 1) return a[0]
    return `${a[0]} et al.`
  },
}),
columnHelper.accessor("year", {
  header: "Year",
  cell: (info) => info.getValue() ?? "",
}),
```

`EnrichmentBadge`:

```typescript
function EnrichmentBadge({ status }: { status?: string }) {
  if (status === "enriching" || status === "pending") {
    return <span className="text-xs text-text-tertiary">enriching…</span>
  }
  if (status === "partial") {
    return <span className="text-xs text-text-secondary">partial metadata</span>
  }
  if (status === "failed" || status === "skipped") {
    return null  // silent; user can manually edit
  }
  return null
}
```

### Edit metadata modal

(Same as before — see TASK-014 v1; implementation unchanged. Triggers `useUpdatePaper` mutation, which records edited fields and protects them from future re-enrichment.)

### Export BibTeX button + Download with proper filename

Same as before.

---

## Tests

`apps/api/test/identifier-extractor.test.ts`:
- DOI regex matches across line breaks
- arXiv ID from filename has priority over text
- Title extraction skips "Abstract", "Introduction"
- Encrypted/unparseable PDF returns nulls without throwing

`apps/api/test/crossref-client.test.ts` (mocked HTTP):
- Successful response → normalized metadata
- 404 → EnrichmentApiError("not_found")
- 429 → EnrichmentApiError("rate_limited")
- Author with only `name` field handled
- Author with `given` + `family` handled
- Year extracted from `issued.date-parts[0][0]`

`apps/api/test/arxiv-client.test.ts`:
- Atom XML parsed correctly
- Multiple authors extracted
- DOI extracted when present
- Year derived from arXiv ID when published date missing

`apps/api/test/semantic-scholar-client.test.ts`:
- Lookup by DOI maps externalIds correctly
- Title search picks highest-similarity match
- Title search rejects matches below similarity threshold
- 429 → EnrichmentApiError("rate_limited")

`apps/api/test/openreview-client.test.ts`:
- Title search finds match
- Year derived from `pdate` epoch
- venue / venueid fields handled

`apps/api/test/orchestrator.test.ts`:
- DOI present → CrossRef called first
- arXiv ID present → arXiv called
- No DOI/arXiv but title → Semantic Scholar fuzzy + OpenReview
- All fail → status: "failed", metadata: null
- Partial success (title only) → status: "partial"
- Source priority on conflict (CrossRef year wins over arXiv year)

`apps/api/test/paper-enrich-worker.test.ts`:
- Worker picks up enrich job after upload
- User-edited fields are not overwritten by enrichment
- Enrichment failure marks paper as `failed` but doesn't throw
- displayFilename recomputed after enrichment

`apps/api/test/bibtex.test.ts`:
- Article entry produced correctly
- LaTeX escapes for `&`, `$`, `_`, etc.
- Inproceedings detected from venue keywords
- Eprint field for arXiv
- BibTeX key generation deterministic
- Workspace export joins multiple entries correctly

`apps/web/test/components/EditMetadataModal.test.tsx`:
- Renders all fields with current values
- Save calls mutation with parsed authors
- Cancel closes without saving
- After save, `metadataEditedByUser` includes the edited fields

---

## Do Not

- **Do not implement web scraping.** Only the four documented public APIs (CrossRef, arXiv, Semantic Scholar, OpenReview). No IEEE Xplore, no Google Scholar, no Springer page scraping.
- **Do not add user-configurable API priority.** The fallback chain order is opinionated and fixed. Users can't tune it. Resist scope creep.
- **Do not block the upload response on enrichment.** Enrichment is async, separate worker job. The upload returns immediately; enrichment fills in seconds later.
- **Do not block enrichment on MinerU.** They are independent jobs running in parallel. Enrichment uses its own lightweight pdf-parse, doesn't need MinerU's output.
- **Do not let enrichment failure mark the paper as broken.** Enrichment is best-effort. A paper with no enrichment is still a fully usable paper (manual edit available, MinerU continues independently).
- **Do not call the four APIs in parallel for the same paper.** Sequential, with early termination if higher-priority sources succeed. Saves rate limit budget.
- **Do not retry on rate-limit errors aggressively.** BullMQ default backoff (30s) is fine. If rate-limit persists, that's a sign to raise concerns, not retry harder.
- **Do not log full API response bodies at info level.** They contain abstract text and other potentially-large payloads. Debug level only.
- **Do not strip user-edited metadata if user clears a field.** Setting `title: null` should clear the title and mark it as "user-edited" (so re-enrichment doesn't restore it).
- **Do not preserve `metadataEditedByUser` on re-upload (new paper row).** It's row-scoped; same content uploaded as a new paper starts fresh.
- **Do not auto-trigger re-enrichment after manual edit.** Manual edit is the user's intentional override; respect it. v0.2 may add a "re-enrich" button.
- **Do not put external API keys in code.** `SEMANTIC_SCHOLAR_API_KEY` and `CROSSREF_POLITE_EMAIL` go in env, validated by Zod config.
- **Do not call OpenReview as the first try.** Its title search is OK but lower precision than Semantic Scholar; only use it as fallback for CS conference papers without DOI.
- **Do not catch `EnrichmentApiError` at the orchestrator level and silently swallow.** Each API attempt logs at warn level so you can see what's happening in production.
- **Do not make MinerU's later metadata extraction (TASK-010 fallback) run if enrichment succeeded.** Enrichment metadata wins; MinerU's heuristics only fill in when nothing else worked.

---

## Decisions Recorded for This Task

- **Enrichment is a separate BullMQ queue** (not piggy-backed on `paper-parse`). Enrichment is fast (seconds), parsing is slow (minutes); coupling them would force the user to wait for parsing to see metadata.
- **Identifier extraction uses `pdf-parse`, not MinerU.** MinerU is overkill for a 3-page text dump. `pdf-parse` is fast and good enough for finding DOI/arXiv/title.
- **Fallback chain priority**: DOI > arXiv ID > Semantic Scholar (by ID, then by title) > OpenReview (CS conference fallback). DOI/CrossRef has the highest precision; OpenReview has the lowest because title-based search is fuzzy.
- **Source priority on conflicts**: earlier sources win. CrossRef year overrides Semantic Scholar year if both present.
- **`metadataEditedByUser` per-field tracking**: prevents re-enrichment from clobbering user corrections. v0.2 may add a "reset to enrichment" UI for individual fields.
- **No retries within enrichment chain.** If CrossRef fails, we move on; we don't retry CrossRef. BullMQ retries the whole job if needed.
- **Title fuzzy match threshold 0.7 Jaccard.** Tuned for "this is plausibly the same paper". Below this we don't trust the match.
- **OpenReview only triggers if other sources don't provide venue.** It's a venue-supplement source for CS papers; running it always is wasteful.
- **CitationCount is captured but not displayed in v0.1.** Stored for v0.2+ features (relevance ranking, "highly cited" badges).

---

## Definition of Done — Quick Checklist

- [ ] DECISIONS.md has updated ADR-020 (already done in this task)
- [ ] PRD §10 reflects new positioning (TASK-016 demoted)
- [ ] Schema migration applied (year, venue, displayFilename, enrichmentStatus, etc.)
- [ ] Four API clients implemented + unit tested with mocked HTTP
- [ ] Identifier extractor handles real PDFs (test on 5+ fixtures)
- [ ] Orchestrator chain runs all tiers correctly
- [ ] Worker enqueued on upload, runs in parallel with paper-parse
- [ ] Enrichment status visible in library
- [ ] Manual edit endpoint protects fields from re-enrichment
- [ ] BibTeX endpoints work for single + workspace
- [ ] Library shows real titles + authors + year
- [ ] Edit metadata modal works
- [ ] PDF download uses displayFilename
- [ ] All tests pass
- [ ] Existing tests still pass
- [ ] STATUS.md updated, commit `[TASK-014] Metadata enrichment via public APIs + manual edit + BibTeX export`

---

## Report Back

After completing:
- **Real-world accuracy on 10-20 papers from your library**: % with full enrichment vs partial vs failed. Note which API tier hit most often.
- Specific failure patterns (e.g., "old papers from before 2000 routinely fail because no DOI/arXiv ID"). These inform v0.2 enrichment improvements.
- API rate limit issues, if any. Did Semantic Scholar 429 you? Did you need to register for a key?
- Identifier extractor precision: false positives on DOI (e.g., bibliography DOIs picked instead of paper DOI), false positives on arXiv ID, etc.
- Suggest improvements: should we extract abstract from S2/CrossRef and store it? (yes, probably). Should we surface citation counts? (v0.2.) Should we extract reference lists for v0.2 graph features?
- Performance: enrichment time for a typical paper end-to-end (extract identifiers + run chain).
- Bibtex output validated against a real LaTeX compile (try one entry).