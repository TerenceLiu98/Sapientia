# TASK-011: Block schema + block API + paper detail page block list

**Estimated effort**: 5-7 hours
**Depends on**: TASK-010
**Phase**: 2 — Block-Level Foundation

---

## Context

MinerU now produces `blocks.json` in MinIO when papers are parsed. Now we extract those blocks into Postgres so they're queryable, and surface them in the UI as a paper-side panel.

This is the **foundation for citations**: every wiki page and note will eventually reference blocks via stable `{paperId}#{blockId}` identifiers. The block_id is the SHA-256 prefix of block content, meaning re-parsing a paper produces the same block_ids for unchanged content — citation links survive re-parsing.

This task does NOT implement citations themselves (TASK-013). It establishes the data layer + display.

---

## Acceptance Criteria

1. **`blocks` schema** with: paper_id, block_id (8-char content hash), block_index (display order), type (text/heading/figure/table/equation/list), page, bbox (jsonb: x, y, w, h), text content, optional image_object_key.
2. **`paper-parse` worker extension**: after writing blocks.json to MinIO, parse it and bulk-insert into `blocks` table. Idempotent (delete existing blocks for paper before insert, since re-parsing replaces).
3. **API endpoint**: `GET /api/v1/papers/{id}/blocks` returns full block list ordered by `block_index`. Cache-friendly (ETag based on paper.updatedAt).
4. **Frontend `BlocksPanel` component** rendered alongside `PdfViewer`:
   - Shows blocks grouped by page
   - Each block: type icon + truncated text preview + page number
   - Click a block → scrolls PDF to that page (no precise block highlighting yet)
   - Loading + empty + error states
5. **Layout update**: paper detail page now shows PDF viewer + blocks panel side by side. Default split: 65% PDF / 35% blocks.
6. **Tests**: blocks parser handles MinerU `content_list.json` shape, idempotent re-insert, API returns ordered list, panel renders correctly.

---

## What to Build

### Understand the MinerU content_list.json shape

Per MinerU docs, `content_list.json` is a flat array of content items. Based on their open-source MinerU project (and their cloud API which mirrors it), each item looks roughly like:

```json
[
  {
    "type": "text",
    "text": "1 Introduction",
    "text_level": 1,
    "page_idx": 0
  },
  {
    "type": "text",
    "text": "Recent advances in language models...",
    "page_idx": 0
  },
  {
    "type": "image",
    "img_path": "images/abc123.jpg",
    "img_caption": ["Figure 1: System architecture"],
    "page_idx": 1
  },
  {
    "type": "table",
    "table_body": "<table>...</table>",
    "table_caption": ["Table 1: Results"],
    "page_idx": 3
  },
  {
    "type": "equation",
    "text": "$$ E = mc^2 $$",
    "text_format": "latex",
    "page_idx": 2
  }
]
```

> **Important**: MinerU's exact field names may differ slightly between versions. Use a discriminated union with Zod for parsing, and treat unknown types as `"text"` to stay robust.

The output may also include layout coordinates (`bbox`) when using the VLM model. Check the actual response — TASK-010's report-back step is supposed to confirm shape. If `bbox` isn't present, store `null` for now and revisit.

### Schema

`packages/db/src/schema/blocks.ts`:

```typescript
import { pgTable, uuid, text, integer, jsonb, timestamp, primaryKey, index } from "drizzle-orm/pg-core"
import { papers } from "./papers"
import { relations } from "drizzle-orm"

export const blocks = pgTable(
  "blocks",
  {
    paperId: uuid("paper_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    blockId: text("block_id").notNull(),
    blockIndex: integer("block_index").notNull(),
    type: text("type", {
      enum: ["text", "heading", "figure", "table", "equation", "list", "code", "other"],
    }).notNull(),
    page: integer("page").notNull(),
    bbox: jsonb("bbox").$type<{ x: number; y: number; w: number; h: number } | null>(),
    text: text("text").notNull().default(""),  // text content (may be empty for figure-only)
    headingLevel: integer("heading_level"),  // 1-6, only for type=heading
    imageObjectKey: text("image_object_key"),  // MinIO key for figure/table image, null otherwise
    caption: text("caption"),  // figure/table caption
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),  // overflow for type-specific fields
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.paperId, table.blockId] }),
    index("idx_blocks_paper_index").on(table.paperId, table.blockIndex),
    index("idx_blocks_paper_page").on(table.paperId, table.page),
  ],
)

export const blocksRelations = relations(blocks, ({ one }) => ({
  paper: one(papers, {
    fields: [blocks.paperId],
    references: [papers.id],
  }),
}))

export type Block = typeof blocks.$inferSelect
export type NewBlock = typeof blocks.$inferInsert
```

Add to schema barrel + generate migration.

### Block parser

`apps/api/src/services/block-parser.ts`:

```typescript
import { z } from "zod"
import { createHash } from "node:crypto"
import type { NewBlock } from "@sapientia/db"

// Lenient schema — MinerU may add fields, we don't care.
const RawContentItemSchema = z
  .object({
    type: z.string().optional(),
    text: z.string().optional(),
    text_level: z.number().optional(),
    text_format: z.string().optional(),
    img_path: z.string().optional(),
    img_caption: z.array(z.string()).optional(),
    table_body: z.string().optional(),
    table_caption: z.array(z.string()).optional(),
    page_idx: z.number().optional(),
    bbox: z.array(z.number()).length(4).optional(),  // [x, y, w, h] or [x1, y1, x2, y2]
  })
  .passthrough()

const ContentListSchema = z.array(RawContentItemSchema)

const VALID_TYPES = ["text", "heading", "figure", "table", "equation", "list", "code", "other"] as const
type BlockType = (typeof VALID_TYPES)[number]

export interface ParsedBlock extends Omit<NewBlock, "paperId"> {}

/** 8-character content hash. Stable across re-parsing for unchanged content. */
function blockIdFromContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 8)
}

function mapType(rawType: string | undefined, hasTextLevel: boolean): BlockType {
  if (rawType === "image") return "figure"
  if (rawType === "equation") return "equation"
  if (rawType === "table") return "table"
  if (rawType === "code") return "code"
  if (rawType === "list") return "list"
  if (rawType === "text" && hasTextLevel) return "heading"
  if (rawType === "text") return "text"
  return "other"
}

function bboxFromArray(bbox: number[] | undefined): { x: number; y: number; w: number; h: number } | null {
  if (!bbox || bbox.length !== 4) return null
  // Assume [x, y, w, h] form. If MinerU uses [x1,y1,x2,y2] adjust here.
  const [x, y, w, h] = bbox
  return { x, y, w, h }
}

export function parseContentList(jsonBytes: Buffer): ParsedBlock[] {
  const raw = JSON.parse(jsonBytes.toString("utf8")) as unknown
  const items = ContentListSchema.parse(raw)

  const blocks: ParsedBlock[] = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const type = mapType(item.type, item.text_level != null)

    let text = ""
    let caption: string | null = null
    if (type === "heading" || type === "text" || type === "list" || type === "code") {
      text = item.text ?? ""
    } else if (type === "equation") {
      text = item.text ?? ""
    } else if (type === "figure") {
      caption = (item.img_caption ?? []).join(" ")
      text = caption  // for searchability, store caption as text too
    } else if (type === "table") {
      caption = (item.table_caption ?? []).join(" ")
      // For tables, prefer caption as searchable text;
      // table_body is HTML and stored in metadata
      text = caption
    }

    const contentForHash = JSON.stringify({
      type,
      text,
      caption,
      page: item.page_idx ?? 0,
      img: item.img_path ?? null,
    })
    const blockId = blockIdFromContent(contentForHash)

    blocks.push({
      blockId,
      blockIndex: i,
      type,
      page: (item.page_idx ?? 0) + 1,  // MinerU is 0-indexed; we use 1-indexed for UI
      bbox: bboxFromArray(item.bbox),
      text,
      headingLevel: type === "heading" ? item.text_level ?? null : null,
      caption,
      imageObjectKey: null,  // populated below if needed; figures' images live in zip but we don't unpack to MinIO yet
      metadata: type === "table" && item.table_body
        ? { tableHtml: item.table_body }
        : null,
    })
  }

  // De-duplicate block_ids: in the rare case two items have identical content,
  // append index to make it unique. This breaks "stable across re-parse" for
  // duplicate content, but that's acceptable.
  const seen = new Set<string>()
  for (const b of blocks) {
    let id = b.blockId
    let suffix = 1
    while (seen.has(id)) {
      id = `${b.blockId}-${suffix++}`
    }
    seen.add(id)
    b.blockId = id
  }

  return blocks
}
```

### Wire into paper-parse worker

In `apps/api/src/workers/paper-parse.worker.ts`, after the `blocks.json` upload:

```typescript
import { blocks as blocksTable } from "@sapientia/db"
import { eq } from "drizzle-orm"
import { parseContentList } from "../services/block-parser"

// ... after uploading blocks.json:

// Parse and bulk-insert blocks
const parsed = parseContentList(blocksJson)

// Idempotent: delete existing blocks for this paper before insert
await db.delete(blocksTable).where(eq(blocksTable.paperId, paperId))

if (parsed.length > 0) {
  // Drizzle bulk insert
  await db.insert(blocksTable).values(
    parsed.map((b) => ({ ...b, paperId })),
  )
}

log.info({ blockCount: parsed.length }, "blocks_persisted")
```

### Block API

`apps/api/src/routes/papers.ts` (extend):

```typescript
import { eq, asc } from "drizzle-orm"
import { blocks, papers, createDbClient } from "@sapientia/db"
// ... existing imports

paperRoutes.get("/papers/:id/blocks", requireAuth, async (c) => {
  const id = c.req.param("id")
  const user = c.get("user")

  const [paper] = await db.select().from(papers).where(eq(papers.id, id)).limit(1)
  if (!paper || paper.deletedAt) return c.json({ error: "not found" }, 404)
  if (!(await userCanAccessPaper(user.id, paper.id, db))) {
    return c.json({ error: "forbidden" }, 403)
  }

  // ETag based on paper.updatedAt
  const etag = `"${paper.updatedAt.getTime()}"`
  if (c.req.header("if-none-match") === etag) {
    return new Response(null, { status: 304 })
  }

  const rows = await db
    .select()
    .from(blocks)
    .where(eq(blocks.paperId, id))
    .orderBy(asc(blocks.blockIndex))

  c.header("etag", etag)
  c.header("cache-control", "private, max-age=60")
  return c.json(rows)
})
```

### Frontend block panel

> **⚠️ UX direction note**: the right-panel block-list UX described below was the original v1 design. After implementation review (and per PHILOSOPHY.md's "notes are spatial, not abstract"), the right panel's primary role evolves to a **note view that follows PDF scroll** — see TASK-018 (to be drafted). The data layer (block schema, API, DOM `data-block-id` markers) **stays exactly as designed in this task**. The visual panel UI may be replaced or moved to a secondary "outline mode" toggle. Implement TASK-011 as written for the data substrate; treat the BlocksPanel UI as one mode among future right-panel modes, not the final form.

`apps/web/src/api/hooks/blocks.ts`:

```typescript
import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "../client"

export interface Block {
  paperId: string
  blockId: string
  blockIndex: number
  type: "text" | "heading" | "figure" | "table" | "equation" | "list" | "code" | "other"
  page: number
  bbox: { x: number; y: number; w: number; h: number } | null
  text: string
  headingLevel: number | null
  caption: string | null
  imageObjectKey: string | null
}

export function useBlocks(paperId: string) {
  return useQuery<Block[]>({
    queryKey: ["paper", paperId, "blocks"],
    queryFn: () => apiFetch(`/api/v1/papers/${paperId}/blocks`),
    staleTime: 60 * 1000,
  })
}
```

`apps/web/src/components/reader/BlocksPanel.tsx`:

```typescript
import { useMemo } from "react"
import { useBlocks, type Block } from "@/api/hooks/blocks"

interface Props {
  paperId: string
  onSelectBlock?: (block: Block) => void
  currentPage?: number
}

const TYPE_ICONS: Record<Block["type"], string> = {
  text: "¶",
  heading: "§",
  figure: "📊",
  table: "▦",
  equation: "∑",
  list: "•",
  code: "</>",
  other: "·",
}

export function BlocksPanel({ paperId, onSelectBlock, currentPage }: Props) {
  const { data: blocks, isLoading, error } = useBlocks(paperId)

  const grouped = useMemo(() => {
    if (!blocks) return new Map<number, Block[]>()
    const m = new Map<number, Block[]>()
    for (const b of blocks) {
      const arr = m.get(b.page) ?? []
      arr.push(b)
      m.set(b.page, arr)
    }
    return m
  }, [blocks])

  if (isLoading) {
    return <div className="p-4 text-sm text-text-tertiary">Loading blocks…</div>
  }
  if (error) {
    return <div className="p-4 text-sm text-text-error">Failed to load blocks.</div>
  }
  if (!blocks || blocks.length === 0) {
    return (
      <div className="p-4 text-sm text-text-tertiary">
        No blocks yet. The paper may still be parsing, or parsing failed.
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="text-xs uppercase tracking-wider text-text-secondary mb-3">
        Blocks ({blocks.length})
      </div>
      {Array.from(grouped.entries())
        .sort(([a], [b]) => a - b)
        .map(([page, pageBlocks]) => (
          <div key={page} className="mb-4">
            <div
              className={`text-xs font-medium mb-1 px-1.5 py-0.5 rounded ${
                currentPage === page
                  ? "bg-surface-selected text-text-accent"
                  : "text-text-secondary"
              }`}
            >
              Page {page}
            </div>
            <div className="space-y-1">
              {pageBlocks.map((block) => (
                <BlockRow key={block.blockId} block={block} onSelect={onSelectBlock} />
              ))}
            </div>
          </div>
        ))}
    </div>
  )
}

function BlockRow({
  block,
  onSelect,
}: {
  block: Block
  onSelect?: (block: Block) => void
}) {
  const preview = useMemo(() => {
    const text = block.caption ?? block.text
    if (!text) return `[${block.type}]`
    return text.length > 80 ? text.slice(0, 80) + "…" : text
  }, [block])

  return (
    <button
      onClick={() => onSelect?.(block)}
      className="w-full text-left flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-surface-hover text-sm group"
    >
      <span className="text-text-tertiary text-xs mt-0.5 w-4 shrink-0">
        {TYPE_ICONS[block.type]}
      </span>
      <span
        className={
          block.type === "heading"
            ? "font-medium text-text-primary"
            : "text-text-secondary"
        }
      >
        {preview}
      </span>
    </button>
  )
}
```

### Update paper detail layout

`apps/web/src/routes/papers/$paperId.tsx`:

```typescript
import { useState, useCallback } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { ProtectedRoute } from "@/components/auth/ProtectedRoute"
import { AppShell } from "@/components/layout/AppShell"
import { usePaperWithPolling } from "@/api/hooks/papers"
import { PdfViewer } from "@/components/reader/PdfViewer"
import { BlocksPanel } from "@/components/reader/BlocksPanel"
import type { Block } from "@/api/hooks/blocks"

export const Route = createFileRoute("/papers/$paperId")({
  component: PaperDetail,
})

function PaperDetail() {
  const { paperId } = Route.useParams()
  const { data: paper, isLoading } = usePaperWithPolling(paperId)
  const [requestedPage, setRequestedPage] = useState<number | null>(null)
  const [currentPage, setCurrentPage] = useState(1)

  const handleSelectBlock = useCallback((block: Block) => {
    setRequestedPage(block.page)
  }, [])

  return (
    <ProtectedRoute>
      <AppShell>
        {isLoading ? (
          <div className="p-8 text-text-tertiary">Loading…</div>
        ) : !paper ? (
          <div className="p-8 text-text-tertiary">Not found.</div>
        ) : (
          <div className="h-full flex flex-col">
            <div className="px-6 py-3 border-b border-border-subtle flex items-center justify-between">
              <h1 className="font-serif text-lg text-text-primary truncate">
                {paper.title}
              </h1>
              <div className="text-xs text-text-secondary">
                Status: {paper.parseStatus}
              </div>
            </div>
            <div className="flex-1 min-h-0 grid grid-cols-[1fr_360px]">
              <div className="border-r border-border-subtle min-h-0">
                <PdfViewer
                  paperId={paperId}
                  requestedPage={requestedPage}
                  onPageChange={setCurrentPage}
                />
              </div>
              <div className="bg-bg-secondary min-h-0">
                <BlocksPanel
                  paperId={paperId}
                  onSelectBlock={handleSelectBlock}
                  currentPage={currentPage}
                />
              </div>
            </div>
          </div>
        )}
      </AppShell>
    </ProtectedRoute>
  )
}
```

Update `PdfViewer` to accept `requestedPage` and `onPageChange` props for two-way page sync.

### Tests

`apps/api/test/block-parser.test.ts`:
- Parse a fixture `content_list.json` with mixed types (text, heading, figure, table, equation)
- Verify block_ids are 8-char hex
- Verify same content produces same block_id (stability)
- Verify different content produces different block_ids
- Verify duplicate content produces unique IDs via suffix
- Verify pages are 1-indexed in output
- Test malformed input (empty array, missing fields) doesn't throw

`apps/api/test/blocks-api.test.ts`:
- Insert paper + blocks fixture
- GET /papers/:id/blocks returns ordered list
- ETag returns 304 on second request
- Cross-user 403
- Non-existent paper 404

`apps/web/test/components/BlocksPanel.test.tsx`:
- Renders blocks grouped by page
- Click block calls onSelect
- Empty state renders
- Loading state renders

---

## Do Not

- **Do not store the actual figure/table images yet.** Their bytes are in MinerU's zip; extracting them to MinIO is a separate task. v0.1 just records `imageObjectKey: null` and shows captions.
- **Do not implement bbox-based highlighting on the PDF.** v0.2 — needs careful PDF.js integration. Block panel just jumps to page for now.
- **Do not allow editing blocks via API.** Future PATCH endpoint for fixing OCR mistakes is in v0.2.
- **Do not search across blocks.** v0.2 (with tsvector full-text indexing).
- **Do not derive `headingLevel` from MinerU when it's missing.** Just `null`.
- **Do not sort blocks by anything but `block_index`.** That's the document order MinerU determined.
- **Do not parse the MinerU `layout.json` or `model.json`.** `content_list.json` is sufficient.
- **Do not implement block reordering.** Read-only.
- **Do not break stable block_ids when re-parsing.** Same content must hash to same ID.
- **Do not run block parsing in the API process** — only in the worker. The worker has the result zip; API doesn't.

---

## Decisions Recorded for This Task

- **8-char content hash** for block_id. SHA-256 prefix gives 2^32 namespace per paper — collision risk is negligible at paper scale (likely <500 blocks per paper).
- **De-dup by appending index suffix** when content collides. Loses stability for those exact blocks but maintains uniqueness; acceptable trade.
- **Pages are 1-indexed** in our schema. MinerU uses 0-indexed (`page_idx`). We translate at the boundary.
- **Block types collapsed to 8 categories**. MinerU may emit more granular types in future; we map to ours.
- **Type "other" as fallback**. Unknown MinerU types don't crash the parser — they're stored as "other" with text preserved.
- **bbox stored as `{x, y, w, h}` object**. If MinerU emits `[x1,y1,x2,y2]`, the parser converts. **Verify in TASK-010 report-back which form they use.**
- **Idempotent re-insert via DELETE + INSERT**. Simpler than UPSERT for bulk. v0.2 may switch to UPSERT to preserve any annotation foreign keys (TASK-013+).
- **ETag on /blocks endpoint** — blocks rarely change after parse; cache aggressively.

---

## Definition of Done — Quick Checklist

- [ ] Schema migrated
- [ ] Re-parse a paper → blocks appear in DB
- [ ] `GET /api/v1/papers/{id}/blocks` returns blocks
- [ ] BlocksPanel shows in paper detail page
- [ ] Click block → PDF jumps to page
- [ ] Current page in BlocksPanel highlights
- [ ] All tests pass
- [ ] Existing tests still pass
- [ ] STATUS.md updated, commit `[TASK-011] Block schema, API, and paper detail block panel`

---

## Report Back

After completing:
- **Confirm MinerU `content_list.json` actual shape** matches the assumptions in `block-parser.ts`. If not, fix and document.
- Real number of blocks for a 30-page paper (helps capacity planning)
- Performance: time from `blocks.json` in MinIO → blocks in Postgres for a long paper
- Suggest if block panel UX is confusing (e.g., should heading blocks be visually nested under their section?)
- **Sketch what the TASK-013 citation extension needs** — based on actual block IDs you see and how users might want to reference them