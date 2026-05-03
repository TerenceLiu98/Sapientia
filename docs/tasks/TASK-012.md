# TASK-012: BlockNote editor + notes data model

**Estimated effort**: 8-10 hours
**Depends on**: TASK-011
**Phase**: 2 — Block-Level Foundation

---

## Context

Users can read PDFs and see blocks. Now they need to write — that's notes. Per CLAUDE.md #12, BlockNote JSON is canonical (in MinIO), markdown cache is in Postgres for searchability and quick LLM context.

This task creates the notes data flow end-to-end:
- Schema, services, CRUD API
- BlockNote editor mounted in two places: standalone (`/notes`) and paper-side (`/papers/{id}/notes/{noteId}`)
- Auto-save with debounce
- Both BlockNote JSON (lossless, MinIO) and markdown (lossy, Postgres) on every save

Citations to blocks come in TASK-013 — this task is plain notes.

---

## Acceptance Criteria

1. **`notes` schema** with: id, workspace_id, owner_user_id, paper_id (nullable, for paper-side notes), title, current_version, json_object_key, md_object_key, agent_markdown_cache (truncated, in Postgres for fast agent context), search_text (tsvector), createdAt, updatedAt.
2. **MinIO layout per PRD §6**: `workspaces/{wid}/notes/{noteId}/v{n}.json` and `v{n}.md`. Versions immutable; current_version on the row points to the latest.
3. **Service layer** (`apps/api/src/services/note.ts`):
   - `createNote({ workspaceId, ownerUserId, paperId?, title, blocknoteJson })` → uploads v1 to MinIO, derives markdown, inserts row
   - `updateNote({ noteId, blocknoteJson })` → uploads v(N+1), updates row
   - `getNote(noteId)` → row + signed URL for current JSON
   - `listNotes({ workspaceId, paperId? })`
   - `deleteNote(noteId)` → soft delete (set deletedAt)
4. **BlockNote → markdown serializer** at `packages/shared/src/blocknote-to-md.ts`. Lossy (drops semantic colors, custom blocks). Used for `md_object_key` and `agent_markdown_cache`.
5. **API endpoints**:
   - `GET /api/v1/workspaces/{wid}/notes` (list, optional `?paperId=` filter)
   - `POST /api/v1/workspaces/{wid}/notes`
   - `GET /api/v1/notes/{id}` (returns metadata + presigned JSON URL)
   - `PUT /api/v1/notes/{id}` (replace JSON, creates new version)
   - `DELETE /api/v1/notes/{id}`
6. **Frontend BlockNote integration** (`apps/web/src/components/notes/NoteEditor.tsx`):
   - Mounts BlockNote with token-styled theme (matches DESIGN_TOKENS.md)
   - Loads JSON from presigned URL (separate fetch, not through API JSON body)
   - Auto-saves on edit, debounced (1.5s)
   - Save status indicator: "Saved" / "Saving…" / "Failed"
7. **Two routes**:
   - `/notes` (standalone): list of all notes in current workspace, click → editor
   - `/papers/{id}/notes/{noteId}`: editor in paper context (left: PDF viewer + blocks panel, right: this note)
8. **Three-pane layout for paper-side notes**: 1fr PDF / 360px blocks / 480px note editor. Adjustable later, hardcoded for v0.1.
9. **Tests**: note CRUD, version increment, markdown derivation correctness, soft delete.

---

## What to Build

### Schema

`packages/db/src/schema/notes.ts`:

```typescript
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  customType,
} from "drizzle-orm/pg-core"
import { user } from "./auth"
import { workspaces } from "./workspaces"
import { papers } from "./papers"
import { sql } from "drizzle-orm"
import { relations } from "drizzle-orm"

const tsvector = customType<{ data: string; default: false }>({
  dataType() {
    return "tsvector"
  },
})

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    paperId: uuid("paper_id").references(() => papers.id, { onDelete: "set null" }),

    title: text("title").notNull().default("Untitled"),
    currentVersion: integer("current_version").notNull().default(1),

    jsonObjectKey: text("json_object_key").notNull(),
    mdObjectKey: text("md_object_key").notNull(),
    agentMarkdownCache: text("agent_markdown_cache").notNull().default(""),
    searchText: tsvector("search_text"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_notes_workspace").on(table.workspaceId),
    index("idx_notes_paper").on(table.paperId),
    index("idx_notes_owner").on(table.ownerUserId),
  ],
)

export const notesRelations = relations(notes, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [notes.workspaceId],
    references: [workspaces.id],
  }),
  owner: one(user, {
    fields: [notes.ownerUserId],
    references: [user.id],
  }),
  paper: one(papers, {
    fields: [notes.paperId],
    references: [papers.id],
  }),
}))

export type Note = typeof notes.$inferSelect
export type NewNote = typeof notes.$inferInsert
```

### tsvector index migration

After Drizzle generates the migration, add a manual SQL section to create the GIN index on `search_text`:

```sql
-- in the generated migration file, append:
CREATE INDEX idx_notes_search ON notes USING GIN (search_text);
```

The `searchText` column will be populated by triggers — but for v0.1, simplest is to update it in application code on each save. (Triggers add migration complexity; we can switch later if it's a hot spot.)

### Markdown serializer

`packages/shared/src/blocknote-to-md.ts`:

BlockNote provides a built-in markdown serializer via `editor.blocksToMarkdownLossy(blocks)`. We use that as our base, but call it on JSON shape rather than instantiating an editor.

```typescript
import type { Block } from "@blocknote/core"

/**
 * Convert BlockNote document JSON to markdown.
 * Lossy: drops colors, custom block types collapse to text.
 *
 * Used for:
 *  - md_object_key in MinIO (alongside JSON, lossless+lossy pair)
 *  - agent_markdown_cache in Postgres (truncated, fast LLM context)
 *  - search_text generation (basic full-text searchability)
 *
 * NOT used for export — that uses a richer pipeline (v0.2).
 */
export function blocknoteJsonToMarkdown(blocks: Block[]): string {
  // Recursive walker, simplified.
  const lines: string[] = []
  for (const block of blocks) {
    lines.push(blockToMd(block, 0))
  }
  return lines.filter(Boolean).join("\n\n")
}

function blockToMd(block: Block, indent: number): string {
  const prefix = "  ".repeat(indent)
  const text = inlinesToMd(block.content)

  switch (block.type) {
    case "paragraph":
      return prefix + text
    case "heading": {
      const level = (block.props as { level?: number })?.level ?? 1
      return "#".repeat(level) + " " + text
    }
    case "bulletListItem":
      return prefix + "- " + text + childrenMd(block, indent + 1)
    case "numberedListItem":
      return prefix + "1. " + text + childrenMd(block, indent + 1)
    case "checkListItem": {
      const checked = (block.props as { checked?: boolean })?.checked
      return prefix + `- [${checked ? "x" : " "}] ` + text
    }
    case "codeBlock":
      return "```\n" + (text || "") + "\n```"
    default:
      return prefix + text
  }
}

function inlinesToMd(content: unknown): string {
  if (!Array.isArray(content)) return ""
  return content
    .map((item) => {
      if (typeof item !== "object" || item === null) return ""
      const node = item as { type: string; text?: string; styles?: Record<string, unknown> }
      if (node.type === "text") return node.text ?? ""
      if (node.type === "link") {
        const inner = inlinesToMd((node as { content?: unknown }).content ?? [])
        const href = (node as { href?: string }).href ?? ""
        return `[${inner}](${href})`
      }
      // Custom inline nodes (block citations, etc.) handled in TASK-013
      return node.text ?? ""
    })
    .join("")
}

function childrenMd(block: Block, indent: number): string {
  const children = (block as { children?: Block[] }).children
  if (!children || children.length === 0) return ""
  return "\n" + children.map((c) => blockToMd(c, indent)).join("\n")
}
```

> **Note**: this is a starter. BlockNote's actual `Block` type is more elaborate (custom blocks, props variations). Refine when you find issues. Don't aim for perfection — this serializer's job is "good enough for LLM context and search," not "round-trip lossless."

Add to `packages/shared/src/index.ts` exports.

### Note service

`apps/api/src/services/note.ts`:

```typescript
import { eq, and, desc, isNull, sql } from "drizzle-orm"
import { notes, type Note, type NewNote } from "@sapientia/db"
import type { Database } from "@sapientia/db"
import { config } from "../config"
import { blocknoteJsonToMarkdown } from "@sapientia/shared"
import { s3Client } from "./s3-client"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { generatePresignedGetUrl } from "./s3-client"

const AGENT_MD_MAX_LEN = 4000  // truncated cache for fast agent context

function buildJsonKey(workspaceId: string, noteId: string, version: number): string {
  return `workspaces/${workspaceId}/notes/${noteId}/v${version}.json`
}

function buildMdKey(workspaceId: string, noteId: string, version: number): string {
  return `workspaces/${workspaceId}/notes/${noteId}/v${version}.md`
}

async function uploadVersion(args: {
  workspaceId: string
  noteId: string
  version: number
  blocknoteJson: unknown
}): Promise<{ jsonKey: string; mdKey: string; markdown: string }> {
  const { workspaceId, noteId, version, blocknoteJson } = args
  const jsonKey = buildJsonKey(workspaceId, noteId, version)
  const mdKey = buildMdKey(workspaceId, noteId, version)

  const jsonString = JSON.stringify(blocknoteJson)
  const blocksArray = Array.isArray(blocknoteJson) ? blocknoteJson : []
  const markdown = blocknoteJsonToMarkdown(blocksArray as never)

  await Promise.all([
    s3Client.send(
      new PutObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: jsonKey,
        Body: jsonString,
        ContentType: "application/json",
      }),
    ),
    s3Client.send(
      new PutObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: mdKey,
        Body: markdown,
        ContentType: "text/markdown",
      }),
    ),
  ])

  return { jsonKey, mdKey, markdown }
}

export async function createNote(args: {
  workspaceId: string
  ownerUserId: string
  paperId?: string | null
  title?: string
  blocknoteJson: unknown
  db: Database
}): Promise<Note> {
  const noteId = crypto.randomUUID()
  const { jsonKey, mdKey, markdown } = await uploadVersion({
    workspaceId: args.workspaceId,
    noteId,
    version: 1,
    blocknoteJson: args.blocknoteJson,
  })

  const [note] = await args.db
    .insert(notes)
    .values({
      id: noteId,
      workspaceId: args.workspaceId,
      ownerUserId: args.ownerUserId,
      paperId: args.paperId ?? null,
      title: args.title ?? "Untitled",
      currentVersion: 1,
      jsonObjectKey: jsonKey,
      mdObjectKey: mdKey,
      agentMarkdownCache: markdown.slice(0, AGENT_MD_MAX_LEN),
      searchText: sql`to_tsvector('english', ${markdown})`,
    })
    .returning()
  return note
}

export async function updateNote(args: {
  noteId: string
  title?: string
  blocknoteJson?: unknown
  db: Database
}): Promise<Note> {
  const [existing] = await args.db
    .select()
    .from(notes)
    .where(and(eq(notes.id, args.noteId), isNull(notes.deletedAt)))
    .limit(1)
  if (!existing) throw new Error(`note ${args.noteId} not found`)

  const updates: Partial<NewNote> = { updatedAt: new Date() }
  if (args.title !== undefined) updates.title = args.title

  if (args.blocknoteJson !== undefined) {
    const newVersion = existing.currentVersion + 1
    const { jsonKey, mdKey, markdown } = await uploadVersion({
      workspaceId: existing.workspaceId,
      noteId: existing.id,
      version: newVersion,
      blocknoteJson: args.blocknoteJson,
    })
    updates.currentVersion = newVersion
    updates.jsonObjectKey = jsonKey
    updates.mdObjectKey = mdKey
    updates.agentMarkdownCache = markdown.slice(0, AGENT_MD_MAX_LEN)
    updates.searchText = sql`to_tsvector('english', ${markdown})` as never
  }

  const [updated] = await args.db
    .update(notes)
    .set(updates)
    .where(eq(notes.id, args.noteId))
    .returning()
  return updated
}

export async function getNote(args: {
  noteId: string
  db: Database
}): Promise<{ note: Note; jsonUrl: string }> {
  const [note] = await args.db
    .select()
    .from(notes)
    .where(and(eq(notes.id, args.noteId), isNull(notes.deletedAt)))
    .limit(1)
  if (!note) throw new Error(`note ${args.noteId} not found`)

  const jsonUrl = await generatePresignedGetUrl(note.jsonObjectKey, 30 * 60)
  return { note, jsonUrl }
}

export async function listNotes(args: {
  workspaceId: string
  paperId?: string | null
  db: Database
}): Promise<Note[]> {
  const conditions = [eq(notes.workspaceId, args.workspaceId), isNull(notes.deletedAt)]
  if (args.paperId !== undefined) {
    conditions.push(args.paperId === null ? isNull(notes.paperId) : eq(notes.paperId, args.paperId))
  }
  return args.db
    .select()
    .from(notes)
    .where(and(...conditions))
    .orderBy(desc(notes.updatedAt))
}

export async function softDeleteNote(noteId: string, db: Database): Promise<void> {
  await db.update(notes).set({ deletedAt: new Date() }).where(eq(notes.id, noteId))
}

export async function userCanAccessNote(
  userId: string,
  noteId: string,
  db: Database,
): Promise<boolean> {
  // User can access a note if they're a member of its workspace.
  // Implementation: join notes → memberships, return true if any row.
  // ... write the actual query
  return /* bool */ false
}
```

### Routes

`apps/api/src/routes/notes.ts`:

```typescript
import { Hono } from "hono"
import { z } from "zod"
import { requireAuth, type AuthContext } from "../middleware/auth"
import { requireMembership } from "../middleware/workspace"
import {
  createNote,
  updateNote,
  getNote,
  listNotes,
  softDeleteNote,
  userCanAccessNote,
} from "../services/note"
import { createDbClient } from "@sapientia/db"
import { config } from "../config"

const { db } = createDbClient(config.DATABASE_URL)

export const noteRoutes = new Hono<AuthContext>()

const CreateNoteBodySchema = z.object({
  paperId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(200).optional(),
  blocknoteJson: z.unknown(),
})

const UpdateNoteBodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  blocknoteJson: z.unknown().optional(),
})

noteRoutes.get(
  "/workspaces/:workspaceId/notes",
  requireAuth,
  requireMembership("reader"),
  async (c) => {
    const workspaceId = c.req.param("workspaceId")
    const paperId = c.req.query("paperId")
    const list = await listNotes({
      workspaceId,
      paperId: paperId ?? undefined,
      db,
    })
    return c.json(list.map(stripInternalFields))
  },
)

noteRoutes.post(
  "/workspaces/:workspaceId/notes",
  requireAuth,
  requireMembership("editor"),
  async (c) => {
    const workspaceId = c.req.param("workspaceId")
    const user = c.get("user")
    const body = CreateNoteBodySchema.parse(await c.req.json())

    const note = await createNote({
      workspaceId,
      ownerUserId: user.id,
      paperId: body.paperId ?? null,
      title: body.title,
      blocknoteJson: body.blocknoteJson,
      db,
    })
    return c.json(stripInternalFields(note), 201)
  },
)

noteRoutes.get("/notes/:id", requireAuth, async (c) => {
  const id = c.req.param("id")
  const user = c.get("user")
  if (!(await userCanAccessNote(user.id, id, db))) {
    return c.json({ error: "forbidden" }, 403)
  }
  const { note, jsonUrl } = await getNote({ noteId: id, db })
  return c.json({
    ...stripInternalFields(note),
    jsonUrl,
    expiresInSeconds: 30 * 60,
  })
})

noteRoutes.put("/notes/:id", requireAuth, async (c) => {
  const id = c.req.param("id")
  const user = c.get("user")
  if (!(await userCanAccessNote(user.id, id, db))) {
    return c.json({ error: "forbidden" }, 403)
  }
  const body = UpdateNoteBodySchema.parse(await c.req.json())
  const updated = await updateNote({
    noteId: id,
    title: body.title,
    blocknoteJson: body.blocknoteJson,
    db,
  })
  return c.json(stripInternalFields(updated))
})

noteRoutes.delete("/notes/:id", requireAuth, async (c) => {
  const id = c.req.param("id")
  const user = c.get("user")
  if (!(await userCanAccessNote(user.id, id, db))) {
    return c.json({ error: "forbidden" }, 403)
  }
  await softDeleteNote(id, db)
  return c.body(null, 204)
})

function stripInternalFields(note: {
  id: string
  workspaceId: string
  ownerUserId: string
  paperId: string | null
  title: string
  currentVersion: number
  createdAt: Date
  updatedAt: Date
}) {
  // Don't expose object keys, agent cache, or search vectors to client
  const { id, workspaceId, ownerUserId, paperId, title, currentVersion, createdAt, updatedAt } =
    note
  return { id, workspaceId, ownerUserId, paperId, title, currentVersion, createdAt, updatedAt }
}
```

Wire in `index.ts`.

### Frontend BlockNote integration

```bash
cd apps/web
pnpm add @blocknote/core @blocknote/react @blocknote/mantine
```

`apps/web/src/components/notes/NoteEditor.tsx`:

```typescript
import { useEffect, useRef, useState } from "react"
import { useCreateBlockNote } from "@blocknote/react"
import { BlockNoteView } from "@blocknote/mantine"
import "@blocknote/mantine/style.css"
import { useNote, useUpdateNote } from "@/api/hooks/notes"
import type { Block } from "@blocknote/core"

interface Props {
  noteId: string
}

export function NoteEditor({ noteId }: Props) {
  const { data: note, isLoading } = useNote(noteId)
  const updateNote = useUpdateNote()
  const [initialContent, setInitialContent] = useState<Block[] | undefined>(undefined)
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load initial content from presigned URL
  useEffect(() => {
    if (!note?.jsonUrl) return
    fetch(note.jsonUrl)
      .then((r) => r.json())
      .then((data) => setInitialContent(data as Block[]))
      .catch(() => setInitialContent([]))
  }, [note?.jsonUrl])

  const editor = useCreateBlockNote({
    initialContent,
  })

  useEffect(() => {
    if (!editor || !note) return
    const handler = () => {
      const blocks = editor.document
      setSaveStatus("saving")
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(async () => {
        try {
          await updateNote.mutateAsync({
            noteId: note.id,
            blocknoteJson: blocks,
          })
          setSaveStatus("saved")
        } catch {
          setSaveStatus("failed")
        }
      }, 1500)
    }
    editor.onChange(handler)
    return () => {
      // BlockNote's onChange returns void; if there's an unsubscribe, use it.
    }
  }, [editor, note, updateNote])

  if (isLoading || !note || initialContent === undefined) {
    return <div className="p-6 text-text-tertiary text-sm">Loading note…</div>
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2 border-b border-border-subtle flex items-center justify-between text-sm">
        <input
          type="text"
          defaultValue={note.title}
          onBlur={(e) => {
            if (e.target.value !== note.title) {
              updateNote.mutate({ noteId: note.id, title: e.target.value })
            }
          }}
          className="font-serif text-lg bg-transparent outline-none text-text-primary flex-1 mr-2"
        />
        <div className="text-xs text-text-tertiary">
          {saveStatus === "saving" && "Saving…"}
          {saveStatus === "saved" && "Saved"}
          {saveStatus === "failed" && (
            <span className="text-text-error">Save failed</span>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <BlockNoteView editor={editor} />
      </div>
    </div>
  )
}
```

### Note hooks

`apps/web/src/api/hooks/notes.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "../client"

export interface Note {
  id: string
  workspaceId: string
  ownerUserId: string
  paperId: string | null
  title: string
  currentVersion: number
  createdAt: string
  updatedAt: string
}

export interface NoteWithUrl extends Note {
  jsonUrl: string
  expiresInSeconds: number
}

export function useNotes(workspaceId: string, paperId?: string) {
  return useQuery<Note[]>({
    queryKey: ["notes", workspaceId, paperId ?? null],
    queryFn: () =>
      apiFetch(
        `/api/v1/workspaces/${workspaceId}/notes${paperId ? `?paperId=${paperId}` : ""}`,
      ),
  })
}

export function useNote(noteId: string) {
  return useQuery<NoteWithUrl>({
    queryKey: ["note", noteId],
    queryFn: () => apiFetch(`/api/v1/notes/${noteId}`),
    staleTime: 25 * 60 * 1000,  // refresh before signed URL expires
  })
}

export function useCreateNote(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { paperId?: string; title?: string; blocknoteJson: unknown }) =>
      apiFetch<Note>(`/api/v1/workspaces/${workspaceId}/notes`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes", workspaceId] }),
  })
}

export function useUpdateNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { noteId: string; title?: string; blocknoteJson?: unknown }) =>
      apiFetch<Note>(`/api/v1/notes/${input.noteId}`, {
        method: "PUT",
        body: JSON.stringify({
          title: input.title,
          blocknoteJson: input.blocknoteJson,
        }),
      }),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ["note", variables.noteId] })
      // Also invalidate the list (title changes)
      qc.invalidateQueries({ queryKey: ["notes"] })
    },
  })
}
```

### Routes

`apps/web/src/routes/notes/index.tsx`: list page (similar shape to library).

`apps/web/src/routes/notes/$noteId.tsx`: standalone editor with `<AppShell>` wrapper.

`apps/web/src/routes/papers/$paperId/notes/$noteId.tsx`: paper-side three-pane.

```typescript
// Three-pane paper-side note editor
function PaperSideNote() {
  const { paperId, noteId } = Route.useParams()
  // ... usePaper, useBlocks, etc.

  return (
    <ProtectedRoute>
      <AppShell>
        <div className="h-full grid grid-cols-[1fr_320px_480px]">
          <div className="border-r border-border-subtle"><PdfViewer paperId={paperId} /></div>
          <div className="border-r border-border-subtle bg-bg-secondary"><BlocksPanel paperId={paperId} /></div>
          <div><NoteEditor noteId={noteId} /></div>
        </div>
      </AppShell>
    </ProtectedRoute>
  )
}
```

### "New note" buttons

- In paper detail page: a "New note for this paper" button → `POST /workspaces/{wid}/notes` with `paperId` set, then navigate to `/papers/{paperId}/notes/{newId}`.
- In `/notes` list page: a "New note" button → standalone note (no paperId), then navigate to `/notes/{newId}`.

Both initialize with empty BlockNote document (`[]`).

### Tests

`apps/api/test/note-service.test.ts`:
- Create note → MinIO has v1.json + v1.md, DB has row with currentVersion=1
- Update note → v2.json + v2.md created, currentVersion=2
- v1 still in MinIO (immutable history)
- agentMarkdownCache truncated at 4000 chars
- searchText populated (query a note via tsvector to confirm)
- softDelete → row.deletedAt set, listNotes excludes
- listNotes filters by paperId

`apps/api/test/note-routes.test.ts`:
- POST creates note
- GET returns presigned URL that resolves to JSON
- PUT increments version
- DELETE soft deletes
- Cross-user 403 on all of the above

`apps/web/test/components/NoteEditor.test.tsx`:
- Renders loading state while jsonUrl pending
- Renders editor once content loaded
- onChange triggers debounced save
- Title edit triggers save
- Save status reflects mutation state

`packages/shared/test/blocknote-to-md.test.ts`:
- Paragraph → plain text
- Heading levels → `#`/`##`/`###`
- Lists nested correctly
- Code block fenced
- Empty document → empty string
- Custom inline (TASK-013 will add citation tests here)

---

## Do Not

- **Do not store BlockNote JSON in Postgres.** It goes to MinIO. Postgres has metadata + truncated markdown.
- **Do not delete old versions from MinIO.** History is preserved (cheap; same-key with version suffix). v0.2 may add a TTL.
- **Do not sync via WebSockets/SSE yet.** v0.1 uses simple PUT-on-debounce. Multi-tab editing is "last write wins" — v0.2 may add CRDT.
- **Do not expose object keys to the frontend.** Always presigned URLs.
- **Do not implement BlockNote's collaboration (`@blocknote/core/collaboration`)** — that requires a Y.js sync server. v0.2.
- **Do not customize BlockNote's theme yet** to match all DESIGN_TOKENS. The mantine default is acceptable for v0.1; theming is a separate cleanup task.
- **Do not implement note-to-note links.** v0.2.
- **Do not add note "tags" or categories.** v0.2.
- **Do not auto-create a "scratch" note on workspace creation.** Empty list is the empty state.
- **Do not save on every keystroke without debounce.** 1.5s debounce is the floor.
- **Do not block UI on save.** Optimistic save status, never freeze the editor.
- **Do not let users save zero-block documents** without confirming — actually, allow it; empty notes are fine.
- **Do not add @-mentions or block citations yet.** TASK-013.
- **Do not style citation @-mentions in the editor.** TASK-013.
- **Do not implement export to markdown via this lossy serializer.** Export is a separate task with a richer pipeline.

---

## Decisions Recorded for This Task

- **JSON in MinIO, markdown alongside** — both at the same path with different extensions. Markdown is auto-derived; never edited by humans directly.
- **Versioning by appending v{N} to MinIO key** — immutable history, simple to retrieve. `currentVersion` on row tracks the live one.
- **agent_markdown_cache truncated at 4000 chars** — bounded Postgres size; LLM context for notes pulls from this. Long notes are truncated for agent purposes (acceptable).
- **searchText updated synchronously in app code, not via DB trigger** — simpler; if it becomes a hot spot, switch to trigger.
- **Auto-save debounce 1.5s** — balances "feels live" with "don't hammer the API."
- **`paper_id` is nullable + has `ON DELETE SET NULL`** — deleting a paper doesn't delete its notes; they become orphan/standalone.
- **Note title editable inline** in the editor header. Defaults to "Untitled". v0.2 may add auto-title-from-content.
- **`@blocknote/mantine`** as the renderer — BlockNote's recommended default. Looks decent enough for v0.1; deeper theming is later.

---

## Definition of Done — Quick Checklist

- [ ] Schema migrated, GIN index on search_text exists
- [ ] Create note via API → MinIO has v1.json + v1.md, row in DB
- [ ] Update note via API → version increments, new keys exist, old key still readable
- [ ] BlockNote editor mounts and renders saved content
- [ ] Edit triggers debounced save with status indicator
- [ ] Title editable in header
- [ ] /notes list page works
- [ ] /papers/{id}/notes/{noteId} three-pane works
- [ ] "New note" buttons work in both contexts
- [ ] Soft delete works
- [ ] Cross-user access denied
- [ ] All tests pass
- [ ] Existing tests still pass
- [ ] STATUS.md updated, commit `[TASK-012] BlockNote editor with notes data model`

---

## Report Back

After completing:
- BlockNote version installed; note any breaking-change quirks
- Whether the markdown serializer captures most cases or has obvious gaps
- Performance: time from edit → save complete
- Suggest if the three-pane layout feels cramped at typical laptop widths (1440px wide)
- **Sketch the citation extension API for TASK-013** — what does the Tiptap node look like, how do we serialize to markdown, how do we extract for `note_block_refs`