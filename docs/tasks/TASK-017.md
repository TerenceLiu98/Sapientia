# TASK-017: PDF highlights — character-level UI, block-level agent context

**Estimated effort**: 2.5-3 working days
**Depends on**: TASK-011 (blocks data + BlocksPanel), TASK-008 (PDF viewer with text layer)
**Phase**: 2 — Block-Level Foundation

---

## Context

Users reading PDFs need to mark passages with semantic intent — *"this is questionable"*, *"this is important"*, *"this is original to me"*, etc. The five colors come from PRD §"颜色作为一等公民": **questioning / important / original / pending / background**.

This task is **the most direct embodiment of Sapientia's philosophy** — see [PHILOSOPHY.md](../PHILOSOPHY.md). The product thesis is "humans do marginalia, AI does Zettelkasten." Highlights are pure marginalia in the user's experience (precise, position-bound, written reflexively while reading) and pure Zettelkasten signal in the AI's experience (block-level semantic markers fed to the agent and to wiki ingestion). The mixed-granularity model below is how a single act of highlighting serves both ends simultaneously.

The right design has **two layers operating at different granularities**:

| Layer | Granularity | Purpose |
|---|---|---|
| **UI / storage** | character-level (within a block) | User precision: select exactly the words you mean |
| **Agent context** | block-level (containing block + highlights) | Agent gets full surrounding context plus the precise focus |

Why split: pure character-level loses agent context (a 3-word selection has no meaning to an LLM). Pure block-level loses user precision (highlighting a whole paragraph when you only meant one term is heavy and noisy). The hybrid keeps both — the user sees their exact selection highlighted; the agent sees the full block annotated with what the user emphasized.

This split is a Sapientia-specific design choice that comes from us having block-level addressing + LLM-aware features. Traditional PDF readers (Acrobat, Apple Books) do character-level only because they have no agent layer to feed.

There's also a separate path for non-text blocks (figures, tables, equations) — clicking the block as a whole, since text selection doesn't apply.

This task does NOT yet implement the agent. The schema and context-building helpers are designed for the future agent task; this task ships the UI + storage and a `formatBlocksForAgent()` helper that the agent task will consume.

---

## Acceptance Criteria

1. **`block_highlights` schema** with character-level offsets stored per highlight (`charStart`, `charEnd`, `selectedText`) and `blockId` for agent retrieval.
2. **PDF text selection** is enabled and works smoothly — users can drag to select text, copy, etc.
3. **Floating selection toolbar** appears above the selection with: 5 color buttons + Cite + Ask agent + Copy.
4. **Click action on color** persists a highlight (or batch of highlights for cross-block selection) and renders the character range in the selected color.
5. **Keyboard shortcuts** while a selection is active: `1`-`5` apply colors, `0`/`Esc` dismiss the toolbar.
6. **Click on non-text block** (figure / table / equation) opens a small popover with the same 5 colors — whole-block highlight (charStart/charEnd null, selectedText is the caption).
7. **BlocksPanel shows highlight indicators** — each block card has a left-side color band showing the dominant color of its highlights (or multiple stripes if multiple colors).
8. **Hover over an existing highlight** shows a small `✕` to remove it.
9. **API**: 5 endpoints — list, create batch, update, delete (single + by selection range).
10. **Agent context helper** (`formatBlocksForAgent()`) — pure function in `packages/shared`, returns the block-level format with highlight annotations. Tested but not consumed yet.
11. **Tests**: schema, character-range computation from DOM Selection, batch upsert, color override semantics, BlocksPanel color band rendering, agent context formatter.

---

## Part 1: Schema

### `packages/db/src/schema/block-highlights.ts`

```typescript
import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core"
import { user } from "./auth"
import { workspaces } from "./workspaces"
import { papers } from "./papers"
import { relations } from "drizzle-orm"

export const blockHighlights = pgTable(
  "block_highlights",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    paperId: uuid("paper_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    blockId: text("block_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),

    // Character-level precision within the block.
    // null/null means "whole block highlighted" (used for figure/table/equation blocks).
    charStart: integer("char_start"),
    charEnd: integer("char_end"),

    // Stored explicitly for stability across re-parses.
    // If MinerU reprocesses the paper and block.text changes slightly,
    // we still know what the user originally selected.
    selectedText: text("selected_text").notNull(),

    color: text("color", {
      enum: ["questioning", "important", "original", "pending", "background"],
    }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Lookup all highlights on a paper for the current user
    index("idx_highlights_paper_user").on(table.paperId, table.userId),
    // Lookup highlights on a specific block (for agent context construction)
    index("idx_highlights_block").on(table.paperId, table.blockId),
    // Cross-workspace queries by color (e.g., "all my questioning highlights")
    index("idx_highlights_workspace_color").on(table.workspaceId, table.color),
  ],
)

export const blockHighlightsRelations = relations(blockHighlights, ({ one }) => ({
  paper: one(papers, {
    fields: [blockHighlights.paperId],
    references: [papers.id],
  }),
  user: one(user, {
    fields: [blockHighlights.userId],
    references: [user.id],
  }),
  workspace: one(workspaces, {
    fields: [blockHighlights.workspaceId],
    references: [workspaces.id],
  }),
}))

export type BlockHighlight = typeof blockHighlights.$inferSelect
export type NewBlockHighlight = typeof blockHighlights.$inferInsert
export type HighlightColor =
  | "questioning"
  | "important"
  | "original"
  | "pending"
  | "background"
```

Add to schema barrel + generate migration.

### Schema notes

- **No composite primary key**. Multiple highlights per `(paper, block, user, workspace)` are allowed (different ranges, different colors).
- **`(charStart, charEnd)` both null** = whole-block highlight (for non-text blocks).
- **`selectedText` is redundant** but valuable — protects against MinerU re-parse drift. Keep it always populated.
- **No "comment" or "note" field** — text annotations are the notes feature (TASK-012/013), not part of highlights. Highlights are pure semantic markers.

---

## Part 2: Selection → block + character ranges

### Block DOM markup

In `apps/web/src/components/reader/PdfViewer.tsx` (or its block-rendering helper), every block element in the DOM has:

```html
<div data-block-id="a3b2c4d5" data-block-type="text" class="pdf-block">
  <span data-block-text>Block content text here…</span>
</div>
```

The inner `<span data-block-text>` wraps the rendered text in a single span (instead of PDF.js's default many-spans-per-line). Reasons:
- Character offsets stay simple — counting characters within one span is trivial
- Highlight DOM mutation is straightforward (split the span around the range)
- Visual rendering is identical to multi-span (CSS handles wrapping)

Implementation note: PDF.js by default renders text in many `<span>` elements per line. We need to either (a) merge them into a single span per block, or (b) write character-offset logic that walks across spans. **Approach (a) is simpler** — implement a `mergeBlockTextSpans(blockEl)` post-processing step that runs after PDF.js renders each page.

### Selection-to-blocks computation

`apps/web/src/components/reader/highlight-utils.ts`:

```typescript
import type { Block } from "@/api/hooks/blocks"

export interface BlockRangeHit {
  blockId: string
  charStart: number  // start offset within the block's text
  charEnd: number    // exclusive
  selectedText: string
}

/**
 * Given a browser DOM Selection, compute which blocks were hit
 * and the character ranges within each block.
 */
export function computeBlockRanges(selection: Selection): BlockRangeHit[] {
  if (selection.rangeCount === 0 || selection.isCollapsed) return []

  const range = selection.getRangeAt(0)
  const hits: BlockRangeHit[] = []

  // Find all block elements that intersect the selection.
  // We use a tree walker constrained to the document root.
  const root = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? (range.commonAncestorContainer as Element)
    : range.commonAncestorContainer.parentElement
  if (!root) return []

  // If the common ancestor is a single block, easy case.
  // If it's higher, we walk all blocks within it that intersect the range.
  const blockEls = Array.from(
    root.querySelectorAll<HTMLElement>("[data-block-id]"),
  )

  // Add the root itself if it has data-block-id
  if (root instanceof HTMLElement && root.dataset.blockId) {
    blockEls.unshift(root)
  }

  for (const blockEl of blockEls) {
    if (!range.intersectsNode(blockEl)) continue
    const hit = computeRangeWithinBlock(blockEl, range)
    if (hit) hits.push(hit)
  }

  return hits
}

function computeRangeWithinBlock(
  blockEl: HTMLElement,
  range: Range,
): BlockRangeHit | null {
  const blockId = blockEl.dataset.blockId
  if (!blockId) return null

  const textSpan = blockEl.querySelector<HTMLElement>("[data-block-text]")
  if (!textSpan) return null

  const blockText = textSpan.textContent ?? ""
  const blockStart = nodeOffsetIntoBlock(textSpan, blockEl)

  // Use the range to find the start and end positions within the block's text.
  // We compute offsets via two pre-cloned ranges.
  const beforeRange = document.createRange()
  beforeRange.setStart(blockEl, 0)
  beforeRange.setEnd(
    Math.max(range.startContainer === blockEl ? range.startContainer : range.startContainer, blockEl) as never,
    0,
  )

  // Simpler approach: use Range.toString() truncation.
  let charStart: number
  let charEnd: number
  try {
    const startRange = document.createRange()
    startRange.selectNodeContents(textSpan)
    startRange.setEnd(range.startContainer, range.startOffset)
    charStart = clamp(startRange.toString().length, 0, blockText.length)

    const endRange = document.createRange()
    endRange.selectNodeContents(textSpan)
    endRange.setEnd(range.endContainer, range.endOffset)
    charEnd = clamp(endRange.toString().length, 0, blockText.length)
  } catch {
    // Selection didn't intersect this block's text span properly
    return null
  }

  // If the original range starts before this block, snap to 0.
  // If it ends after this block, snap to blockText.length.
  const blockRange = document.createRange()
  blockRange.selectNode(blockEl)
  if (range.compareBoundaryPoints(Range.START_TO_START, blockRange) < 0) {
    charStart = 0
  }
  if (range.compareBoundaryPoints(Range.END_TO_END, blockRange) > 0) {
    charEnd = blockText.length
  }

  if (charEnd <= charStart) return null

  return {
    blockId,
    charStart,
    charEnd,
    selectedText: blockText.slice(charStart, charEnd),
  }
}

function nodeOffsetIntoBlock(textNode: Node, blockEl: HTMLElement): number {
  // Stub: only useful if multi-span text. With single span, offset within block is offset within span.
  return 0
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}
```

> Implementation note: this is the trickiest part of the task. The DOM Range API has well-known footguns. The implementer should write **unit tests** for `computeBlockRanges()` against real DOM fixtures. Use `jsdom` in vitest. Pay particular attention to:
> - Selection that starts mid-block, ends in another block
> - Selection across whitespace / line breaks
> - Selection in single-character increments
> - Empty / collapsed selections
> - Reverse direction selections (right-to-left dragging)

If implementation gets bogged down, fall back to a simpler approach: **only support same-block selections in v0.1, multi-block requires N separate selections**. Document the limitation if so.

---

## Part 3: Selection toolbar

### Toolbar component

`apps/web/src/components/reader/SelectionToolbar.tsx`:

```typescript
import { useEffect, useState, useRef } from "react"

interface Props {
  onColor: (color: HighlightColor) => void
  onCite: () => void
  onAsk: () => void
  onCopy: () => void
  onDismiss: () => void
}

const COLORS: Array<{ key: HighlightColor; label: string; shortcut: string }> = [
  { key: "questioning", label: "Questioning", shortcut: "1" },
  { key: "important", label: "Important", shortcut: "2" },
  { key: "original", label: "Original", shortcut: "3" },
  { key: "pending", label: "Pending", shortcut: "4" },
  { key: "background", label: "Background", shortcut: "5" },
]

export function SelectionToolbar({
  onColor,
  onCite,
  onAsk,
  onCopy,
  onDismiss,
  position,
}: Props & { position: { top: number; left: number } }) {
  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      switch (e.key) {
        case "1": onColor("questioning"); e.preventDefault(); break
        case "2": onColor("important"); e.preventDefault(); break
        case "3": onColor("original"); e.preventDefault(); break
        case "4": onColor("pending"); e.preventDefault(); break
        case "5": onColor("background"); e.preventDefault(); break
        case "Escape":
        case "0": onDismiss(); e.preventDefault(); break
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onColor, onDismiss])

  return (
    <div
      className="fixed bg-bg-primary border border-border-default rounded-md shadow-md flex items-center gap-1 px-2 py-1.5 z-popover"
      style={{ top: position.top, left: position.left }}
      onMouseDown={(e) => e.preventDefault()}  // prevent losing the selection on click
    >
      {COLORS.map((c) => (
        <button
          key={c.key}
          onClick={() => onColor(c.key)}
          className="w-6 h-6 rounded-md border border-border-subtle hover:scale-110 transition-transform"
          style={{ backgroundColor: `var(--note-${c.key}-bg)` }}
          title={`${c.label} (${c.shortcut})`}
        />
      ))}
      <div className="w-px h-5 bg-border-subtle mx-1" />
      <button
        onClick={onCite}
        className="px-2 py-1 text-sm hover:bg-surface-hover rounded text-text-secondary"
        title="Cite into current note"
      >
        Cite
      </button>
      <button
        onClick={onAsk}
        className="px-2 py-1 text-sm hover:bg-surface-hover rounded text-text-secondary"
        title="Ask the agent about this"
      >
        Ask
      </button>
      <button
        onClick={onCopy}
        className="px-2 py-1 text-sm hover:bg-surface-hover rounded text-text-secondary"
        title="Copy selected text"
      >
        Copy
      </button>
    </div>
  )
}
```

### Toolbar lifecycle in PdfViewer

```typescript
// Inside PdfViewer
const [toolbarState, setToolbarState] = useState<{
  hits: BlockRangeHit[]
  position: { top: number; left: number }
} | null>(null)

useEffect(() => {
  const handler = () => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.toString().trim().length < 3) {
      setToolbarState(null)
      return
    }

    const hits = computeBlockRanges(sel)
    if (hits.length === 0) {
      setToolbarState(null)
      return
    }

    // Position toolbar above the selection's bounding rect
    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    setToolbarState({
      hits,
      position: { top: rect.top - 44, left: rect.left + rect.width / 2 - 100 },
    })
  }

  document.addEventListener("selectionchange", handler)
  return () => document.removeEventListener("selectionchange", handler)
}, [])

const createBatch = useCreateHighlightBatch(paperId)

const handleColor = useCallback(
  async (color: HighlightColor) => {
    if (!toolbarState) return
    await createBatch.mutateAsync({
      workspaceId: currentWorkspaceId,
      color,
      highlights: toolbarState.hits,
    })
    window.getSelection()?.removeAllRanges()
    setToolbarState(null)
  },
  [toolbarState, createBatch, currentWorkspaceId],
)
```

> **Important UX consideration**: `selectionchange` fires very often. Debounce to ~150ms — show the toolbar after the user stops dragging, not while dragging.

---

## Part 4: Whole-block click for non-text blocks

For figure / table / equation blocks (no selectable text), enable click-to-highlight:

```typescript
// In block rendering:
const isNonText = block.type === "figure" || block.type === "table" || block.type === "equation"

<div
  data-block-id={block.blockId}
  data-block-type={block.type}
  className={isNonText ? "pdf-block cursor-pointer" : "pdf-block"}
  onClick={isNonText ? (e) => openWholeBlockPopover(block, e) : undefined}
>
  ...
</div>
```

The `WholeBlockPopover` is similar to `SelectionToolbar` but simpler — only the 5 color buttons. No Cite/Ask/Copy. On color click, sends a single highlight with `charStart=null, charEnd=null, selectedText=block.caption ?? "(figure)"`.

---

## Part 5: Rendering existing highlights

After fetching highlights for the current paper, apply them to the rendered DOM.

### `apps/web/src/components/reader/highlight-rendering.ts`

```typescript
import type { BlockHighlight } from "@/api/hooks/highlights"

/**
 * Apply highlights to the PDF DOM.
 * Called after page render and whenever highlights change.
 */
export function applyHighlightsToPdf(
  pageEl: HTMLElement,
  highlights: BlockHighlight[],
): void {
  // Group highlights by blockId for efficient iteration
  const byBlock = new Map<string, BlockHighlight[]>()
  for (const h of highlights) {
    const arr = byBlock.get(h.blockId) ?? []
    arr.push(h)
    byBlock.set(h.blockId, arr)
  }

  for (const [blockId, blockHighlights] of byBlock) {
    const blockEl = pageEl.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`)
    if (!blockEl) continue
    applyHighlightsToBlock(blockEl, blockHighlights)
  }
}

function applyHighlightsToBlock(
  blockEl: HTMLElement,
  highlights: BlockHighlight[],
): void {
  // Clean any prior highlight wrappers (idempotent re-application)
  blockEl.querySelectorAll(".sapientia-highlight").forEach((el) => {
    const parent = el.parentNode
    if (!parent) return
    while (el.firstChild) parent.insertBefore(el.firstChild, el)
    parent.removeChild(el)
  })
  // Normalize the text node tree so adjacent text nodes merge
  blockEl.normalize()

  const textSpan = blockEl.querySelector<HTMLElement>("[data-block-text]")

  // Whole-block highlights (charStart/charEnd null)
  const wholeBlock = highlights.filter((h) => h.charStart == null)
  if (wholeBlock.length > 0) {
    // Apply background color to the entire block
    blockEl.style.backgroundColor = `var(--note-${wholeBlock[0].color}-bg)`
    // If multiple, layer is "first wins" in v0.1
    return
  }

  // Character-range highlights — only on text blocks
  if (!textSpan) return

  // Sort by start position; apply non-overlapping ranges only.
  // For overlaps, last-write-wins handled at insert time, but we defend here.
  const ranges = highlights
    .filter((h) => h.charStart != null && h.charEnd != null)
    .sort((a, b) => (a.charStart ?? 0) - (b.charStart ?? 0))

  // Apply ranges in reverse order so DOM mutation doesn't invalidate offsets
  for (const h of ranges.reverse()) {
    wrapTextRange(textSpan, h.charStart!, h.charEnd!, h.color, h.id)
  }
}

function wrapTextRange(
  span: HTMLElement,
  start: number,
  end: number,
  color: string,
  highlightId: string,
): void {
  const text = span.textContent ?? ""
  if (start >= text.length || end > text.length || start >= end) return

  // Re-create the span's content as: [pre][highlight][post]
  const pre = text.slice(0, start)
  const middle = text.slice(start, end)
  const post = text.slice(end)

  span.textContent = ""
  if (pre) span.appendChild(document.createTextNode(pre))

  const wrapper = document.createElement("span")
  wrapper.className = "sapientia-highlight"
  wrapper.dataset.highlightId = highlightId
  wrapper.dataset.color = color
  wrapper.style.backgroundColor = `var(--note-${color}-bg)`
  wrapper.style.color = `var(--note-${color}-text)`
  wrapper.style.borderRadius = "2px"
  wrapper.style.padding = "0 1px"
  wrapper.appendChild(document.createTextNode(middle))
  span.appendChild(wrapper)

  if (post) span.appendChild(document.createTextNode(post))
}
```

> **Why reverse order**: DOM mutations to earlier ranges shift the offsets of later ranges. Applying right-to-left avoids the issue.
>
> **Why simple approach over a fancier algorithm**: with v0.1 expected scale (tens of highlights per paper), a clean re-wrap on every change is fast. Premature optimization not worth it.

### Hover-to-remove

Add to `applyHighlightsToBlock` — every wrapper gets a `mouseenter` listener that shows a small ✕ button next to it. Click ✕ → DELETE the highlight via API. React-side: this should hook into the same TanStack Query mutation so the UI updates immediately.

A simpler v0.1 approach: don't add inline ✕. Instead, **clicking on an existing highlight wrapper opens a small contextual menu** with "Change color" + "Remove". This is a single popover, less DOM clutter than per-highlight ✕.

---

## Part 6: API

### Service

`apps/api/src/services/highlight.ts`:

```typescript
import { eq, and, inArray } from "drizzle-orm"
import { blockHighlights, type BlockHighlight, type HighlightColor } from "@sapientia/db"
import type { Database } from "@sapientia/db"

interface HighlightInput {
  blockId: string
  charStart: number | null
  charEnd: number | null
  selectedText: string
}

export async function listHighlightsForPaper(args: {
  paperId: string
  userId: string
  workspaceId: string
  db: Database
}): Promise<BlockHighlight[]> {
  return args.db
    .select()
    .from(blockHighlights)
    .where(
      and(
        eq(blockHighlights.paperId, args.paperId),
        eq(blockHighlights.userId, args.userId),
        eq(blockHighlights.workspaceId, args.workspaceId),
      ),
    )
}

export async function createHighlightBatch(args: {
  paperId: string
  userId: string
  workspaceId: string
  color: HighlightColor
  highlights: HighlightInput[]
  db: Database
}): Promise<BlockHighlight[]> {
  if (args.highlights.length === 0) return []

  // For now, no automatic overlap resolution. Each (blockId, charStart, charEnd)
  // gets a fresh row. Same range with new color requires explicit DELETE + INSERT.
  const inserted = await args.db
    .insert(blockHighlights)
    .values(
      args.highlights.map((h) => ({
        paperId: args.paperId,
        userId: args.userId,
        workspaceId: args.workspaceId,
        blockId: h.blockId,
        charStart: h.charStart,
        charEnd: h.charEnd,
        selectedText: h.selectedText,
        color: args.color,
      })),
    )
    .returning()

  return inserted
}

export async function updateHighlightColor(args: {
  highlightId: string
  userId: string
  color: HighlightColor
  db: Database
}): Promise<BlockHighlight | null> {
  const [updated] = await args.db
    .update(blockHighlights)
    .set({ color: args.color, updatedAt: new Date() })
    .where(
      and(
        eq(blockHighlights.id, args.highlightId),
        eq(blockHighlights.userId, args.userId),
      ),
    )
    .returning()
  return updated ?? null
}

export async function deleteHighlight(args: {
  highlightId: string
  userId: string
  db: Database
}): Promise<boolean> {
  const result = await args.db
    .delete(blockHighlights)
    .where(
      and(
        eq(blockHighlights.id, args.highlightId),
        eq(blockHighlights.userId, args.userId),
      ),
    )
    .returning({ id: blockHighlights.id })
  return result.length > 0
}

/** Bulk-delete highlights overlapping with given ranges. Used for "clear" action on a selection. */
export async function deleteHighlightsInRanges(args: {
  paperId: string
  userId: string
  workspaceId: string
  ranges: Array<{ blockId: string; charStart: number | null; charEnd: number | null }>
  db: Database
}): Promise<number> {
  // Implementation: fetch all highlights for these blocks, filter ones overlapping in-app, delete by IDs.
  // Acceptable for v0.1 scale.
  const blockIds = [...new Set(args.ranges.map((r) => r.blockId))]
  if (blockIds.length === 0) return 0

  const candidates = await args.db
    .select()
    .from(blockHighlights)
    .where(
      and(
        eq(blockHighlights.paperId, args.paperId),
        eq(blockHighlights.userId, args.userId),
        eq(blockHighlights.workspaceId, args.workspaceId),
        inArray(blockHighlights.blockId, blockIds),
      ),
    )

  const toDelete: string[] = []
  for (const c of candidates) {
    for (const r of args.ranges) {
      if (r.blockId !== c.blockId) continue
      if (rangesOverlap(c.charStart, c.charEnd, r.charStart, r.charEnd)) {
        toDelete.push(c.id)
        break
      }
    }
  }

  if (toDelete.length === 0) return 0

  await args.db.delete(blockHighlights).where(inArray(blockHighlights.id, toDelete))
  return toDelete.length
}

function rangesOverlap(
  aStart: number | null,
  aEnd: number | null,
  bStart: number | null,
  bEnd: number | null,
): boolean {
  // null-null = whole block; treat as covering everything
  if (aStart == null || aEnd == null) return true
  if (bStart == null || bEnd == null) return true
  return aStart < bEnd && bStart < aEnd
}
```

### Routes

`apps/api/src/routes/highlights.ts`:

```typescript
import { Hono } from "hono"
import { z } from "zod"
import { eq, and } from "drizzle-orm"
import { papers, createDbClient } from "@sapientia/db"
import { config } from "../config"
import { requireAuth, type AuthContext } from "../middleware/auth"
import { userCanAccessPaper } from "../services/paper"
import {
  listHighlightsForPaper,
  createHighlightBatch,
  updateHighlightColor,
  deleteHighlight,
  deleteHighlightsInRanges,
} from "../services/highlight"

const { db } = createDbClient(config.DATABASE_URL)

export const highlightRoutes = new Hono<AuthContext>()

const ColorSchema = z.enum([
  "questioning", "important", "original", "pending", "background",
])

const HighlightInputSchema = z.object({
  blockId: z.string(),
  charStart: z.number().int().nonnegative().nullable(),
  charEnd: z.number().int().nonnegative().nullable(),
  selectedText: z.string(),
})

const CreateBatchSchema = z.object({
  workspaceId: z.string().uuid(),
  color: ColorSchema,
  highlights: z.array(HighlightInputSchema).min(1).max(50),
})

highlightRoutes.get("/papers/:paperId/highlights", requireAuth, async (c) => {
  const paperId = c.req.param("paperId")
  const workspaceId = c.req.query("workspaceId")
  if (!workspaceId) return c.json({ error: "workspaceId required" }, 400)

  const user = c.get("user")
  if (!(await userCanAccessPaper(user.id, paperId, db))) {
    return c.json({ error: "forbidden" }, 403)
  }

  const list = await listHighlightsForPaper({
    paperId,
    userId: user.id,
    workspaceId,
    db,
  })
  return c.json(list)
})

highlightRoutes.post("/papers/:paperId/highlights/batch", requireAuth, async (c) => {
  const paperId = c.req.param("paperId")
  const user = c.get("user")
  if (!(await userCanAccessPaper(user.id, paperId, db))) {
    return c.json({ error: "forbidden" }, 403)
  }

  const body = CreateBatchSchema.parse(await c.req.json())
  const inserted = await createHighlightBatch({
    paperId,
    userId: user.id,
    workspaceId: body.workspaceId,
    color: body.color,
    highlights: body.highlights,
    db,
  })
  return c.json(inserted, 201)
})

highlightRoutes.patch("/highlights/:id", requireAuth, async (c) => {
  const id = c.req.param("id")
  const user = c.get("user")
  const body = z.object({ color: ColorSchema }).parse(await c.req.json())

  const updated = await updateHighlightColor({
    highlightId: id,
    userId: user.id,
    color: body.color,
    db,
  })
  if (!updated) return c.json({ error: "not found" }, 404)
  return c.json(updated)
})

highlightRoutes.delete("/highlights/:id", requireAuth, async (c) => {
  const id = c.req.param("id")
  const user = c.get("user")
  const ok = await deleteHighlight({ highlightId: id, userId: user.id, db })
  if (!ok) return c.json({ error: "not found" }, 404)
  return c.body(null, 204)
})

const DeleteByRangeSchema = z.object({
  workspaceId: z.string().uuid(),
  ranges: z.array(
    z.object({
      blockId: z.string(),
      charStart: z.number().int().nullable(),
      charEnd: z.number().int().nullable(),
    }),
  ).min(1),
})

highlightRoutes.delete("/papers/:paperId/highlights/by-range", requireAuth, async (c) => {
  const paperId = c.req.param("paperId")
  const user = c.get("user")
  if (!(await userCanAccessPaper(user.id, paperId, db))) {
    return c.json({ error: "forbidden" }, 403)
  }

  const body = DeleteByRangeSchema.parse(await c.req.json())
  const count = await deleteHighlightsInRanges({
    paperId,
    userId: user.id,
    workspaceId: body.workspaceId,
    ranges: body.ranges,
    db,
  })
  return c.json({ deleted: count })
})
```

Wire in `index.ts`:

```typescript
import { highlightRoutes } from "./routes/highlights"
app.route("/api/v1", highlightRoutes)
```

---

## Part 7: Frontend hooks

`apps/web/src/api/hooks/highlights.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "../client"

export type HighlightColor =
  | "questioning" | "important" | "original" | "pending" | "background"

export interface BlockHighlight {
  id: string
  paperId: string
  blockId: string
  userId: string
  workspaceId: string
  charStart: number | null
  charEnd: number | null
  selectedText: string
  color: HighlightColor
  createdAt: string
  updatedAt: string
}

export function useHighlights(paperId: string, workspaceId: string) {
  return useQuery<BlockHighlight[]>({
    queryKey: ["highlights", paperId, workspaceId],
    queryFn: () =>
      apiFetch(`/api/v1/papers/${paperId}/highlights?workspaceId=${workspaceId}`),
    enabled: !!paperId && !!workspaceId,
  })
}

interface BatchInput {
  workspaceId: string
  color: HighlightColor
  highlights: Array<{
    blockId: string
    charStart: number | null
    charEnd: number | null
    selectedText: string
  }>
}

export function useCreateHighlightBatch(paperId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: BatchInput) =>
      apiFetch<BlockHighlight[]>(`/api/v1/papers/${paperId}/highlights/batch`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ["highlights", paperId, variables.workspaceId] })
    },
  })
}

export function useUpdateHighlightColor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; color: HighlightColor }) =>
      apiFetch<BlockHighlight>(`/api/v1/highlights/${input.id}`, {
        method: "PATCH",
        body: JSON.stringify({ color: input.color }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["highlights"] }),
  })
}

export function useDeleteHighlight() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/v1/highlights/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["highlights"] }),
  })
}
```

---

## Part 8: BlocksPanel color band

Update `BlocksPanel` to show highlight color indicators:

```typescript
// Inside BlocksPanel, fetch highlights:
const { data: highlights = [] } = useHighlights(paperId, workspaceId)

// Build a map blockId → set of colors for fast lookup
const colorsByBlock = useMemo(() => {
  const m = new Map<string, Set<HighlightColor>>()
  for (const h of highlights) {
    const set = m.get(h.blockId) ?? new Set()
    set.add(h.color)
    m.set(h.blockId, set)
  }
  return m
}, [highlights])

// In BlockRow:
function BlockRow({ block, ... }) {
  const colors = colorsByBlock.get(block.blockId)
  return (
    <button className="...flex items-stretch...">
      {/* Color band on the left */}
      {colors && colors.size > 0 && (
        <div className="w-1 flex flex-col">
          {Array.from(colors).map((color) => (
            <div
              key={color}
              className="flex-1 first:rounded-tl last:rounded-bl"
              style={{ backgroundColor: `var(--note-${color}-bg)` }}
            />
          ))}
        </div>
      )}
      {/* existing block content */}
      ...
    </button>
  )
}
```

A block with three colors highlighted in different ranges shows as a 3-segment vertical color band. This gives the BlocksPanel a "heatmap of attention" for the paper at a glance.

---

## Part 9: Agent context formatter (for future agent task)

This is a **pure function in `packages/shared`** that future agent code will consume. We write + test it now so the schema design is validated.

`packages/shared/src/agent-context.ts`:

```typescript
import type { Block } from "./types"

export interface HighlightForContext {
  blockId: string
  color: "questioning" | "important" | "original" | "pending" | "background"
  selectedText: string
  charStart: number | null
  charEnd: number | null
}

interface BlockForContext {
  blockId: string
  type: string
  text: string
  page?: number
  headingLevel?: number | null
}

/**
 * Format a paper's blocks into LLM-friendly text, with highlights as
 * inline annotations preserving the user's semantic markers.
 *
 * The agent receives:
 *   - Full block content (context)
 *   - Marker labels with the user's exact selected phrases (focus)
 *   - Optional <focus> wrapping for the agent's primary block of interest
 *
 * This is the canonical Layer 2 format per PRD §"Agent Layer 2".
 */
export function formatBlocksForAgent(args: {
  blocks: BlockForContext[]
  highlights: HighlightForContext[]
  focusBlockId?: string | null
}): string {
  // Group highlights by blockId
  const byBlock = new Map<string, HighlightForContext[]>()
  for (const h of args.highlights) {
    const arr = byBlock.get(h.blockId) ?? []
    arr.push(h)
    byBlock.set(h.blockId, arr)
  }

  return args.blocks.map((block) => formatOne(block, byBlock.get(block.blockId) ?? [], args.focusBlockId === block.blockId)).join("\n\n")
}

function formatOne(
  block: BlockForContext,
  highlights: HighlightForContext[],
  isFocus: boolean,
): string {
  const lines: string[] = []
  const typeLabel = block.headingLevel ? `H${block.headingLevel} heading` : block.type
  lines.push(`[Block #${block.blockId}: ${typeLabel}]`)

  if (highlights.length > 0) {
    // Group highlights by color
    const byColor = new Map<string, HighlightForContext[]>()
    for (const h of highlights) {
      const arr = byColor.get(h.color) ?? []
      arr.push(h)
      byColor.set(h.color, arr)
    }
    for (const [color, items] of byColor) {
      const phrases = items
        .map((h) => `"${h.selectedText.trim()}"`)
        .filter((s, i, arr) => arr.indexOf(s) === i)  // dedupe identical text
        .join(", ")
      lines.push(`USER MARKED AS ${color.toUpperCase()}: ${phrases}`)
    }
  }

  lines.push(block.text)

  const body = lines.join("\n")
  return isFocus ? `<focus>\n${body}\n</focus>` : body
}
```

Add to `packages/shared/src/index.ts` exports.

This isn't called by anything yet. It's tested unit-level and waits for the agent task to consume it.

---

## Tests

`apps/web/test/components/highlight-utils.test.ts`:
- Selection within single block returns 1 hit with correct char range
- Selection across two blocks returns 2 hits with proper start/end offsets per block
- Selection collapses to nothing returns []
- Selection with mid-word boundaries
- Reverse-direction selection (right-to-left drag)
- Use jsdom fixtures with controlled DOM trees

`apps/api/test/highlight-service.test.ts`:
- Create batch inserts N rows
- Update color changes the row
- Delete removes
- Delete-by-range removes overlapping
- Cross-user isolation: user A can't update user B's highlight

`apps/api/test/highlight-routes.test.ts`:
- Auth required
- Cross-paper access denied (paper doesn't belong to user's workspace)
- Batch input validation
- Range delete with empty ranges array → 400

`packages/shared/test/agent-context.test.ts`:
- Format block with no highlights → bare block
- Format block with single highlight → annotation line
- Multiple colors → multiple annotation lines (one per color, grouped)
- Same text highlighted twice → deduped
- Focus block wrapped in `<focus>`
- Heading blocks labeled with H1/H2/...
- Output format is stable (snapshot test)

`apps/web/test/components/SelectionToolbar.test.tsx`:
- Renders 5 color buttons
- Click color calls onColor callback
- Keyboard `1` triggers color 1
- Escape dismisses

`apps/web/test/components/BlocksPanel.test.tsx`:
- Color band shows for blocks with highlights
- Multiple colors → multiple band segments

---

## Do Not

- **Do not implement multi-color overlap merging logic.** v0.1: a block can have multiple highlights with overlapping ranges and different colors. They visually layer (last-rendered on top). v0.2 may add merge/conflict UI.
- **Do not implement rich annotation comments.** Highlights are pure semantic markers. Comments live in notes (TASK-012).
- **Do not run highlight rendering on the worker / server.** It's a client-side DOM operation only.
- **Do not store highlight color choices per workspace.** v0.1 uses fixed 5-color palette. Per-workspace theming is v0.2+.
- **Do not allow highlight on blocks without a `data-block-id`.** Selections that don't intersect any block are dropped silently.
- **Do not break the existing PDF text selection (copy/paste).** Selection-toolbar must coexist with native browser selection — Copy in toolbar uses `document.execCommand("copy")` or Clipboard API, not selection mutation.
- **Do not use `mousedown` to dismiss the toolbar.** Use `mousedown` outside the toolbar. The toolbar's own mousedown shouldn't lose the selection (`onMouseDown={(e) => e.preventDefault()}`).
- **Do not call the agent on Ask click yet.** TASK-017 doesn't include the agent. Leave `onAsk` as a stub or `console.log`. Wire it in the agent task.
- **Do not call Cite on selection.** Wait for actual cite implementation in TASK-013 if not yet done. If TASK-013 is done, hook this up — but don't expand TASK-017 scope to fix TASK-013 issues.
- **Do not optimize the highlight DOM mutations.** v0.1 re-applies all highlights to a block on any change. Premature optimization not worth it at v0.1 scale.
- **Do not render highlights using PDF.js's annotation layer.** That's for PDF-native annotations (links, form fields). Our highlights live in the text layer.
- **Do not allow highlight on text inside `<focus>` boundaries** (when present in the PDF for whatever reason). Selection should respect block boundaries, not synthetic markers.
- **Do not make selection toolbar appear on triple-click (whole-paragraph selection)**. v0.1: triple-click works as native paragraph selection but doesn't auto-trigger the toolbar — user must release and the selectionchange handler fires. This is fine.
- **Do not add per-user "primary color" preferences.** No "default to questioning when I press H".
- **Do not show the toolbar for selections shorter than 3 characters.** Filters out accidental clicks.

---

## Decisions Recorded for This Task

- **Character-level UI, block-level agent context** — the core design choice. Storage carries character offsets; the agent context formatter aggregates to block + annotations.
- **`selectedText` redundantly stored** — protects against MinerU re-parse drift. Always populate, never derive on-read.
- **Multiple highlights per `(paper, block, user)`** — supports a block having multiple ranges with potentially different colors.
- **Whole-block highlight = `(charStart, charEnd) = (null, null)`** — for figure / table / equation. Caption stored as `selectedText`.
- **Last-write-wins on color changes** — explicit DELETE + INSERT for same range. v0.1 doesn't merge.
- **Single `<span data-block-text>` wrapping** — implies a post-PDF.js render step that merges PDF.js's many spans into one. Necessary for character offset stability.
- **Highlights re-applied to DOM on any change** — simpler than incremental DOM mutation, fast enough at v0.1 scale.
- **No backend-side highlight rendering or storage of rendered HTML** — pure client-side rendering from raw `(blockId, charStart, charEnd)`.
- **5-color palette is fixed in v0.1** — see DESIGN_TOKENS.md `--note-*` tokens. Customization is a v0.2 feature.
- **Agent context formatter shipped now, used later** — gives us a stable schema commitment. The function lives in `packages/shared` so both backend (when agent task consumes) and any future tooling can use it.

---

## Definition of Done — Quick Checklist

- [ ] Schema migrated, indexes created
- [ ] `data-block-id` and single-span text wrapping in PDF DOM
- [ ] Selection on text triggers floating toolbar (with debounce)
- [ ] 5 color buttons + Cite/Ask/Copy in toolbar
- [ ] Keyboard 1-5 maps to colors
- [ ] Click → API → highlight rendered, persists across reload
- [ ] Cross-block selection creates one highlight per block
- [ ] Click on figure / table / equation → whole-block popover
- [ ] BlocksPanel shows color band for highlighted blocks
- [ ] Hover/click existing highlight → change color or remove
- [ ] `formatBlocksForAgent()` exported from `@sapientia/shared` with snapshot tests
- [ ] All tests pass
- [ ] Existing tests still pass
- [ ] STATUS.md updated, commit `[TASK-017] Selection-based block-level highlights with semantic colors`

---

## Report Back

After completing:
- **DOM Range API quirks encountered** — selectionchange firing patterns, cross-browser (test in Chrome and Safari especially), the multi-span vs single-span tradeoff in practice
- **Real selection accuracy** — try selecting at line breaks, hyphenated words, equations. Note what fails
- **Performance with many highlights** — render a fixture paper with 50+ highlights and confirm there's no visible lag on page navigation
- **Agent context output** for a real paper with 5+ highlights — copy-paste the output to verify it would actually be useful for an LLM
- **Suggest additions for the agent task**: should we expose abstract / authors / paper title at the top of the agent context, or keep it just blocks? (likely yes — helps agent ground its response)
- **Suggest UX adjustments**: was the 5-color palette too many? Did keyboard 1-5 feel right? Did users find the toolbar position annoying?
- **Edge case decisions made during implementation** — any of the four "edge cases" in the parent discussion that needed product decisions