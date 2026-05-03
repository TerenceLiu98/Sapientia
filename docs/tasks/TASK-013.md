# TASK-013: Note → block citation

**Estimated effort**: 8-10 hours
**Depends on**: TASK-012
**Phase**: 2 — Block-Level Foundation

---

## Context

This task closes the read-write loop. Users reading a paper can highlight a block, click "cite in note", and a reference is inserted into their active note. The reference is a stable `{paperId}#{blockId}` token that survives re-parsing (per TASK-011's content-hashed block IDs).

This is the technical heart of Sapientia's "block-level addressing" pillar (PRD §1). Once citations work, every wiki entity, every note paragraph, every agent output can ground itself in specific blocks.

The work spans three layers:
1. **BlockNote editor**: a custom inline node `BlockCitation` rendered as a chip with paper title + block preview on hover. Inserted via UI flow from PDF panel.
2. **Persistence**: when a note is saved, scan its JSON for citation nodes and write to a `note_block_refs` table for fast reverse lookup.
3. **Reverse lookup**: from a block, click "view notes citing this block" → list all notes referencing it.

---

## Acceptance Criteria

1. **`note_block_refs` schema**: (note_id, paper_id, block_id, citation_count). Composite PK. Bulk-rebuilt on every note save.
2. **Citation extractor** (`packages/shared/src/citations.ts`): walks BlockNote JSON, finds citation inline nodes, returns flat list of `{paperId, blockId}` with counts.
3. **Service**: `syncNoteBlockRefs(noteId, blocknoteJson, db)` — called inside `updateNote` and `createNote` services. Idempotent: deletes existing refs for the note, inserts new.
4. **BlockNote inline node `BlockCitation`** registered as a custom inline content type:
   - Schema: `{ type: 'blockCitation', props: { paperId: string, blockId: string, snapshot: string } }` — `snapshot` is the block text at citation time, used as fallback render text if the block was deleted.
   - Renderer: pill-shaped chip with the snapshot text, hover popup showing source paper title.
   - Markdown serialization: `[[{paperId}#{blockId}: snapshot text]]` — a custom syntax our parser will recognize.
5. **Insert flow**: in `BlocksPanel`, every block has a "cite" button. Clicking it calls a callback that inserts a citation at the current cursor position of the active note editor in the same paper-side view.
6. **Reverse lookup endpoint**: `GET /api/v1/papers/{id}/blocks/{blockId}/notes` returns notes that cite this block.
7. **UI for reverse lookup**: in `BlocksPanel`, hovering a block shows a small "(N notes)" badge if any notes cite it. Click navigates to a list/popover of those notes with deep-links to the citing position.
8. **Tests**: extractor handles nested content, idempotent sync, citation chip renders, markdown serialization round-trips, reverse query.

---

## What to Build

### Schema

`packages/db/src/schema/note-block-refs.ts`:

```typescript
import { pgTable, uuid, text, integer, timestamp, primaryKey, index } from "drizzle-orm/pg-core"
import { notes } from "./notes"
import { papers } from "./papers"
import { relations } from "drizzle-orm"

export const noteBlockRefs = pgTable(
  "note_block_refs",
  {
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    paperId: uuid("paper_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    blockId: text("block_id").notNull(),
    citationCount: integer("citation_count").notNull().default(1),
    firstCitedAt: timestamp("first_cited_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.noteId, table.paperId, table.blockId] }),
    index("idx_note_block_refs_block").on(table.paperId, table.blockId),
    index("idx_note_block_refs_note").on(table.noteId),
  ],
)

export const noteBlockRefsRelations = relations(noteBlockRefs, ({ one }) => ({
  note: one(notes, {
    fields: [noteBlockRefs.noteId],
    references: [notes.id],
  }),
  paper: one(papers, {
    fields: [noteBlockRefs.paperId],
    references: [papers.id],
  }),
}))

export type NoteBlockRef = typeof noteBlockRefs.$inferSelect
```

Add to schema barrel + generate migration.

### Citation extractor

`packages/shared/src/citations.ts`:

```typescript
export interface CitationRef {
  paperId: string
  blockId: string
  count: number
}

interface CitationNode {
  type: "blockCitation"
  props: { paperId: string; blockId: string; snapshot: string }
}

interface InlineNode {
  type: string
  text?: string
  content?: InlineNode[]
  props?: Record<string, unknown>
}

interface BlockNoteBlock {
  id?: string
  type: string
  content?: InlineNode[] | string
  children?: BlockNoteBlock[]
  props?: Record<string, unknown>
}

/**
 * Walk BlockNote document JSON, find all blockCitation inline nodes,
 * return aggregated counts per (paperId, blockId).
 */
export function extractCitations(doc: unknown): CitationRef[] {
  if (!Array.isArray(doc)) return []
  const counts = new Map<string, { paperId: string; blockId: string; count: number }>()

  function visitInline(node: InlineNode | unknown): void {
    if (typeof node !== "object" || node === null) return
    const n = node as InlineNode

    if (n.type === "blockCitation" && n.props) {
      const { paperId, blockId } = n.props as { paperId?: string; blockId?: string }
      if (paperId && blockId) {
        const key = `${paperId}#${blockId}`
        const existing = counts.get(key)
        if (existing) existing.count += 1
        else counts.set(key, { paperId, blockId, count: 1 })
      }
    }

    if (Array.isArray(n.content)) {
      for (const child of n.content) visitInline(child)
    }
  }

  function visitBlock(block: BlockNoteBlock): void {
    if (Array.isArray(block.content)) {
      for (const inline of block.content) visitInline(inline)
    }
    if (Array.isArray(block.children)) {
      for (const child of block.children) visitBlock(child)
    }
  }

  for (const block of doc as BlockNoteBlock[]) visitBlock(block)
  return Array.from(counts.values())
}

/** Format `{paperId}#{blockId}: snapshot` as the canonical text reference. */
export function formatCitationToken(args: {
  paperId: string
  blockId: string
  snapshot: string
}): string {
  const safeSnapshot = args.snapshot.replace(/\]\]/g, "] ]")  // escape close-bracket pair
  return `[[${args.paperId}#${args.blockId}: ${safeSnapshot}]]`
}
```

Add to `packages/shared/src/index.ts`.

### Sync service

In `apps/api/src/services/note.ts`, add:

```typescript
import { extractCitations } from "@sapientia/shared"
import { noteBlockRefs } from "@sapientia/db"

async function syncNoteBlockRefs(args: {
  noteId: string
  blocknoteJson: unknown
  db: Database
}): Promise<void> {
  const refs = extractCitations(args.blocknoteJson)

  // Idempotent: delete existing then insert
  await args.db.delete(noteBlockRefs).where(eq(noteBlockRefs.noteId, args.noteId))

  if (refs.length > 0) {
    await args.db.insert(noteBlockRefs).values(
      refs.map((r) => ({
        noteId: args.noteId,
        paperId: r.paperId,
        blockId: r.blockId,
        citationCount: r.count,
      })),
    )
  }
}
```

Call `syncNoteBlockRefs` at the end of `createNote` and inside `updateNote` whenever `blocknoteJson` is provided.

> **Important**: this is best-effort. If a citation references a paper the user doesn't own, or a block that doesn't exist anymore, the row still gets inserted (FKs allow it because the paper row still exists; orphan blockId is fine for the schema). The reverse query naturally returns empty for nonexistent blocks.

### Reverse lookup endpoint

`apps/api/src/routes/papers.ts` (extend):

```typescript
paperRoutes.get("/papers/:id/blocks/:blockId/notes", requireAuth, async (c) => {
  const paperId = c.req.param("id")
  const blockId = c.req.param("blockId")
  const user = c.get("user")

  if (!(await userCanAccessPaper(user.id, paperId, db))) {
    return c.json({ error: "forbidden" }, 403)
  }

  // Find notes citing this block, scoped to notes the user can access.
  // Implementation: join note_block_refs → notes → memberships → user
  // ... write the query
  const rows: Array<{
    noteId: string
    title: string
    workspaceId: string
    citationCount: number
    updatedAt: Date
  }> = await db
    .select(/* ... */)
    .from(noteBlockRefs)
    /* joins */
    .where(/* paper, block, accessible to user */)

  return c.json(rows)
})
```

Also add an endpoint to count citations per block (efficient for the badges):

```typescript
paperRoutes.get("/papers/:id/citation-counts", requireAuth, async (c) => {
  const paperId = c.req.param("id")
  const user = c.get("user")
  if (!(await userCanAccessPaper(user.id, paperId, db))) {
    return c.json({ error: "forbidden" }, 403)
  }

  // Aggregate sum(citation_count) grouped by block_id, scoped to user-accessible notes
  const rows = await db
    .select(/* blockId, total count */)
    .from(noteBlockRefs)
    /* joins to filter by user access */
    .where(eq(noteBlockRefs.paperId, paperId))
    .groupBy(noteBlockRefs.blockId)

  // Returns: [{ blockId: string, count: number }, ...]
  return c.json(rows)
})
```

### BlockNote custom inline node

BlockNote allows custom inline content via the schema API. Reference: https://www.blocknotejs.org/docs/custom-schemas/custom-inline-content (or current equivalent).

`apps/web/src/components/notes/citation-schema.ts`:

```typescript
import { defaultInlineContentSpecs, createInlineContentSpec } from "@blocknote/core"
import { Link } from "@tanstack/react-router"

export const blockCitationSpec = createInlineContentSpec(
  {
    type: "blockCitation",
    propSchema: {
      paperId: { default: "" },
      blockId: { default: "" },
      snapshot: { default: "" },
    },
    content: "none",
  },
  {
    render: (props) => {
      const { paperId, blockId, snapshot } = props.inlineContent.props
      return (
        <span
          contentEditable={false}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-md bg-accent-100 text-accent-700 text-sm cursor-pointer hover:bg-accent-200"
          title={`${paperId}#${blockId}`}
        >
          <span className="text-accent-500">¶</span>
          <span className="truncate max-w-[300px]">
            {snapshot || `${blockId.slice(0, 6)}…`}
          </span>
        </span>
      )
    },
  },
)

export const inlineContentSpecs = {
  ...defaultInlineContentSpecs,
  blockCitation: blockCitationSpec,
}
```

Use the schema in editor instantiation:

```typescript
// In NoteEditor.tsx
import { inlineContentSpecs } from "./citation-schema"
import { BlockNoteSchema } from "@blocknote/core"

const schema = BlockNoteSchema.create({ inlineContentSpecs })

const editor = useCreateBlockNote({ schema, initialContent })
```

### Insert citation from BlocksPanel

Update `BlocksPanel` to accept an `onCite` callback:

```typescript
interface Props {
  paperId: string
  onSelectBlock?: (block: Block) => void
  onCiteBlock?: (block: Block) => void
  currentPage?: number
  citationCounts?: Map<string, number>
}

// In BlockRow:
{onCiteBlock && (
  <button
    onClick={(e) => {
      e.stopPropagation()
      onCiteBlock(block)
    }}
    className="opacity-0 group-hover:opacity-100 ml-auto text-xs text-text-tertiary hover:text-text-accent"
  >
    cite
  </button>
)}

{citationCounts && citationCounts.get(block.blockId) ? (
  <span className="text-xs text-text-secondary">
    ({citationCounts.get(block.blockId)} note{citationCounts.get(block.blockId)! > 1 ? "s" : ""})
  </span>
) : null}
```

In the paper-side three-pane route, lift up the editor reference:

```typescript
import { useState } from "react"
import type { BlockNoteEditor } from "@blocknote/core"

function PaperSideNote() {
  const { paperId, noteId } = Route.useParams()
  const [editor, setEditor] = useState<BlockNoteEditor | null>(null)

  const handleCiteBlock = (block: Block) => {
    if (!editor) return
    editor.insertInlineContent([
      {
        type: "blockCitation",
        props: {
          paperId,
          blockId: block.blockId,
          snapshot: (block.text || block.caption || "").slice(0, 80),
        },
      },
      // Add a trailing space so the cursor lands after the chip naturally
      " ",
    ])
    editor.focus()
  }

  return (
    <ProtectedRoute>
      <AppShell>
        <div className="h-full grid grid-cols-[1fr_320px_480px]">
          <div className="border-r border-border-subtle">
            <PdfViewer paperId={paperId} />
          </div>
          <div className="border-r border-border-subtle bg-bg-secondary">
            <BlocksPanel
              paperId={paperId}
              onCiteBlock={handleCiteBlock}
              /* citationCounts={...} */
            />
          </div>
          <div>
            <NoteEditor noteId={noteId} onEditorReady={setEditor} />
          </div>
        </div>
      </AppShell>
    </ProtectedRoute>
  )
}
```

`NoteEditor` exposes the editor via `onEditorReady` prop:

```typescript
interface NoteEditorProps {
  noteId: string
  onEditorReady?: (editor: BlockNoteEditor) => void
}

// in component, after editor is created:
useEffect(() => {
  if (editor && onEditorReady) onEditorReady(editor)
}, [editor, onEditorReady])
```

### Citation count hook

`apps/web/src/api/hooks/citations.ts`:

```typescript
import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "../client"

export function usePaperCitationCounts(paperId: string) {
  return useQuery<Array<{ blockId: string; count: number }>>({
    queryKey: ["paper", paperId, "citation-counts"],
    queryFn: () => apiFetch(`/api/v1/papers/${paperId}/citation-counts`),
    staleTime: 60 * 1000,
  })
}

export function useNotesForBlock(paperId: string, blockId: string | null) {
  return useQuery({
    queryKey: ["block", paperId, blockId, "notes"],
    queryFn: () =>
      apiFetch<
        Array<{
          noteId: string
          title: string
          workspaceId: string
          citationCount: number
          updatedAt: string
        }>
      >(`/api/v1/papers/${paperId}/blocks/${blockId}/notes`),
    enabled: blockId != null,
  })
}
```

### Markdown serializer update

In `packages/shared/src/blocknote-to-md.ts`, extend `inlinesToMd` to handle citation nodes:

```typescript
import { formatCitationToken } from "./citations"

// inside inlinesToMd:
if (node.type === "blockCitation") {
  const props = (node as { props?: { paperId?: string; blockId?: string; snapshot?: string } }).props
  if (props?.paperId && props?.blockId) {
    return formatCitationToken({
      paperId: props.paperId,
      blockId: props.blockId,
      snapshot: props.snapshot ?? "",
    })
  }
  return ""
}
```

### Tests

`packages/shared/test/citations.test.ts`:
- `extractCitations` on doc with single citation → `[{paperId, blockId, count: 1}]`
- Same citation appearing twice → `count: 2`
- Two different citations → two entries
- Nested in list / heading → still found
- No citations → `[]`
- Malformed JSON → returns `[]` without throwing
- `formatCitationToken` round-trip with snapshot containing `]]` → escaped properly

`apps/api/test/note-block-refs.test.ts`:
- Create note with citation → row in note_block_refs
- Update note replacing citations → old refs deleted, new refs inserted
- Update note with same citations → no change in row count
- Delete note (soft) → cascade behavior verified
- Cite a non-existent blockId → row inserted (orphan-tolerant)

`apps/api/test/citation-routes.test.ts`:
- GET /papers/:id/blocks/:blockId/notes → returns user's notes citing it
- GET /papers/:id/citation-counts → aggregated counts
- Cross-user access denied
- Non-existent paper 404

`apps/web/test/components/citation.test.tsx`:
- BlocksPanel cite button calls onCiteBlock
- Citation chip renders with snapshot
- Citation chip with no snapshot falls back to block ID prefix

`apps/web/test/components/NoteEditor.cite.test.tsx`:
- onEditorReady fires once editor is ready
- editor.insertInlineContent inserts citation node correctly

---

## Do Not

- **Do not store citation `snapshot` in the database.** It's redundant with the block's text in the `blocks` table. Snapshot lives only in the BlockNote JSON for offline rendering when the block table isn't available.
- **Do not auto-update citations when blocks change.** v0.1: snapshot is taken at insert time and stays put. If the underlying block is re-parsed, the chip still shows the original snapshot. v0.2 may add a "block updated, refresh citation?" UI prompt.
- **Do not let users edit citation chip content** — props are read-only. Removing the chip is fine; editing the text inside is not.
- **Do not validate paperId/blockId on insert from frontend.** Frontend already has a real block selected. Validation is an over-defensive cost.
- **Do not add citation hyperlinks** that navigate within the editor on click. v0.2 may add "click chip → scroll PDF to block" but it's complex (need cross-pane communication).
- **Do not implement bi-directional drag** (drag block onto editor). v0.2.
- **Do not extract citations from markdown** when loading a note. Citations are only authoritative in BlockNote JSON. Markdown is for output, not input.
- **Do not store frequency stats** at the workspace level. v0.2.
- **Do not add a "citations panel"** to the note editor showing which blocks are cited. v0.2 may add a sidebar.
- **Do not break the v0.1 markdown export.** Export should produce `[[paperId#blockId: snapshot]]` so users can read it back into a system that understands the convention.
- **Do not run citation extraction in a worker.** It's fast enough to run inline on note save.

---

## Decisions Recorded for This Task

- **Citation as BlockNote inline content** (not a custom block type). Citations should flow with text — paragraph "see [chip] for the relevant equation" reads naturally. A block-level citation would force layout breaks.
- **`snapshot` stored in BlockNote JSON**, not in DB. Lets the editor render meaningfully even when offline or when block was deleted.
- **Reference table `note_block_refs` rebuilt on save**. Simpler than diff'ing. Re-saving a 50KB note rebuilds tens of refs — cheap.
- **Markdown serialization `[[paperId#blockId: snapshot]]`** — chosen because it's grep-able, readable, and survives any markdown processor that doesn't understand it (looks like a footnote-ish reference).
- **Reverse lookup is a separate endpoint, not embedded in `/blocks`** — keeps responses lean for the common "just show me blocks" case.
- **Citation counts cached at block level** via separate endpoint, hit only when BlocksPanel is visible. Avoids inflating /blocks payload.
- **Citation insertion via `editor.insertInlineContent`** — BlockNote's native API. Works at current cursor position naturally.

---

## Definition of Done — Quick Checklist

- [ ] note_block_refs table migrated
- [ ] Citation extractor handles all BlockNote nesting cases
- [ ] Saving a note with citations populates note_block_refs
- [ ] Updating a note re-syncs refs (idempotent)
- [ ] Citation chip renders in editor with snapshot text
- [ ] Click "cite" in BlocksPanel inserts citation at cursor
- [ ] Reverse lookup endpoint returns notes citing a block
- [ ] Citation count badge shows in BlocksPanel for blocks with refs
- [ ] Markdown export includes `[[paperId#blockId: snapshot]]` syntax
- [ ] All tests pass
- [ ] Existing tests still pass
- [ ] STATUS.md updated, commit `[TASK-013] Note-to-block citation system`

---

## Report Back

After completing:
- BlockNote API for custom inline content — any quirks or version-specific behavior
- How citation chip behaves with copy/paste, undo/redo, drag — these are common breakage points for custom nodes
- Performance: editing a note with 50+ citations — does insertInlineContent / save / extract / sync stay fast?
- Suggest: should the citation chip have a delete-with-cleanup action (e.g., right-click → "remove this citation"), or is the default backspace flow fine?
- **Sketch how TASK-014+ (wiki) should consume citations** — the wiki ingestion will read `note_block_refs` to build entity/concept pages from notes that reference common blocks. Note any data model gaps you noticed.