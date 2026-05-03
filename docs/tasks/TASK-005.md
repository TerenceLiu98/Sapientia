# TASK-005: Paper upload endpoint with MinIO + dedup

**Estimated effort**: 6-8 hours
**Depends on**: TASK-003, TASK-004
**Phase**: 1 — Reading Foundation

---

## Context

First real "vertical slice" — users upload PDFs, we store them in MinIO, dedup per ADR-005.

Not yet parsing (MinerU integration in TASK-009+); we're establishing the upload pipeline, MinIO storage, dedup logic, and metadata storage.

---

## Acceptance Criteria

1. New schemas: `papers` and `workspace_papers` (Drizzle).
2. Migration generated and committed.
3. `apps/api/src/services/paper.ts` exports:
   - `uploadPaper({ user, workspaceId, fileBytes, filename, db })` — stores to MinIO, dedups, links to workspace.
   - `userCanAccessPaper(user, paper, db)` — checks paper access via membership in any workspace it belongs to.
4. New endpoints:
   - `POST /api/v1/workspaces/{workspaceId}/papers` — multipart upload
   - `GET /api/v1/papers/{id}` — metadata
   - `GET /api/v1/papers/{id}/pdf-url` — returns presigned URL
   - `GET /api/v1/workspaces/{workspaceId}/papers` — list
5. Dedup: same `(ownerUserId, contentHash)` returns existing paper, links to new workspace if not already.
6. File size limit: 50 MB → 413.
7. Content-type check: only `application/pdf` → else 415.
8. PDF magic bytes check (must start with `%PDF-`) → else 400.
9. `parseStatus` initialized to `"pending"`.
10. Tests: upload success, dedup (same user same hash), different users same content (two records), 413/415/400 error paths, list endpoint, get metadata, get PDF URL, cross-user 403.

---

## Schema

### `packages/db/src/schema/papers.ts`

```typescript
import { pgTable, uuid, text, bigint, jsonb, timestamp, unique, index } from "drizzle-orm/pg-core"
import { user } from "./auth"
import { workspaces } from "./workspaces"
import { relations } from "drizzle-orm"

export const papers = pgTable(
  "papers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    contentHash: text("content_hash").notNull(),
    doi: text("doi"),
    arxivId: text("arxiv_id"),
    title: text("title").notNull(),
    authors: jsonb("authors").$type<string[]>(),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }).notNull(),
    pdfObjectKey: text("pdf_object_key").notNull(),
    blocksObjectKey: text("blocks_object_key"),
    parseStatus: text("parse_status", {
      enum: ["pending", "parsing", "done", "failed"],
    })
      .notNull()
      .default("pending"),
    parseError: text("parse_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    unique("papers_owner_content_hash_unq").on(table.ownerUserId, table.contentHash),
    index("idx_papers_owner_user_id").on(table.ownerUserId),
    index("idx_papers_content_hash").on(table.contentHash),
  ],
)

export const workspacePapers = pgTable(
  "workspace_papers",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    paperId: uuid("paper_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    grantedBy: text("granted_by")
      .notNull()
      .references(() => user.id),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    {
      pk: { name: "workspace_papers_pkey", columns: [table.workspaceId, table.paperId] },
    },
    index("idx_workspace_papers_workspace_id").on(table.workspaceId),
  ],
)

export const papersRelations = relations(papers, ({ one, many }) => ({
  owner: one(user, { fields: [papers.ownerUserId], references: [user.id] }),
  workspaceLinks: many(workspacePapers),
}))

export const workspacePapersRelations = relations(workspacePapers, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspacePapers.workspaceId],
    references: [workspaces.id],
  }),
  paper: one(papers, {
    fields: [workspacePapers.paperId],
    references: [papers.id],
  }),
}))

export type Paper = typeof papers.$inferSelect
export type NewPaper = typeof papers.$inferInsert
export type WorkspacePaper = typeof workspacePapers.$inferSelect
```

Update schema barrel: `packages/db/src/schema/index.ts` add `export * from "./papers"`.

Generate + commit migration.

---

## S3 client extensions

### `apps/api/src/services/s3-client.ts` (extend from TASK-002)

```typescript
import {
  S3Client,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { config } from "../config"

export const s3Client = new S3Client({
  endpoint: config.S3_ENDPOINT,
  region: config.S3_REGION,
  credentials: {
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: config.S3_FORCE_PATH_STYLE,
})

export async function checkS3Health(): Promise<boolean> {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }))
    return true
  } catch {
    return false
  }
}

export async function uploadPdfToS3(content: Uint8Array, key: string): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: key,
      Body: content,
      ContentType: "application/pdf",
    }),
  )
}

export async function generatePresignedGetUrl(
  key: string,
  ttlSeconds = 3600,
): Promise<string> {
  return await getSignedUrl(
    s3Client,
    new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }),
    { expiresIn: ttlSeconds },
  )
}
```

---

## Service

### `apps/api/src/services/paper.ts`

```typescript
import { eq, and } from "drizzle-orm"
import { createHash } from "node:crypto"
import { papers, workspacePapers, type Paper } from "@sapientia/db"
import type { Database } from "@sapientia/db"
import { uploadPdfToS3 } from "./s3-client"

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024

export class PaperTooLargeError extends Error {
  constructor() {
    super(`file exceeds ${MAX_FILE_SIZE_BYTES} bytes`)
  }
}

export class InvalidPaperContentError extends Error {
  constructor(reason: string) {
    super(`invalid PDF: ${reason}`)
  }
}

export async function uploadPaper(args: {
  userId: string
  workspaceId: string
  fileBytes: Uint8Array
  filename: string
  db: Database
}): Promise<Paper> {
  const { userId, workspaceId, fileBytes, filename, db } = args

  if (fileBytes.byteLength > MAX_FILE_SIZE_BYTES) {
    throw new PaperTooLargeError()
  }

  // Magic bytes check
  const header = new TextDecoder().decode(fileBytes.slice(0, 5))
  if (header !== "%PDF-") {
    throw new InvalidPaperContentError("file does not start with %PDF-")
  }

  const contentHash = createHash("sha256").update(fileBytes).digest("hex")

  // Dedup check
  const existing = await db
    .select()
    .from(papers)
    .where(
      and(
        eq(papers.ownerUserId, userId),
        eq(papers.contentHash, contentHash),
      ),
    )
    .limit(1)

  if (existing.length > 0 && !existing[0].deletedAt) {
    await linkPaperToWorkspace(existing[0].id, workspaceId, userId, db)
    return existing[0]
  }

  // Fresh upload
  const paperId = crypto.randomUUID()
  const pdfObjectKey = `papers/${userId}/${paperId}/source.pdf`

  await uploadPdfToS3(fileBytes, pdfObjectKey)

  const [paper] = await db
    .insert(papers)
    .values({
      id: paperId,
      ownerUserId: userId,
      contentHash,
      title: filename.replace(/\.pdf$/i, ""),
      fileSizeBytes: fileBytes.byteLength,
      pdfObjectKey,
      parseStatus: "pending",
    })
    .returning()

  await linkPaperToWorkspace(paper.id, workspaceId, userId, db)
  return paper
}

async function linkPaperToWorkspace(
  paperId: string,
  workspaceId: string,
  userId: string,
  db: Database,
): Promise<void> {
  // Idempotent: ON CONFLICT DO NOTHING
  await db
    .insert(workspacePapers)
    .values({ paperId, workspaceId, grantedBy: userId })
    .onConflictDoNothing()
}

export async function userCanAccessPaper(
  userId: string,
  paperId: string,
  db: Database,
): Promise<boolean> {
  // User can access a paper if they're a member of any workspace the paper belongs to
  // (Drizzle: write a join query against workspace_papers + memberships)
  // Implementation detail left to dev. Should be a single query, no N+1.
  // See repo for finished form.
  // ... write the actual query using inner joins
  return /* result */ false
}
```

> Note: `userCanAccessPaper` query is left as a small exercise. The pattern is `SELECT 1 FROM workspace_papers wp INNER JOIN memberships m ON m.workspace_id = wp.workspace_id WHERE wp.paper_id = ? AND m.user_id = ? LIMIT 1`. Drizzle equivalent uses `.innerJoin()`.

---

## Routes

### `apps/api/src/routes/papers.ts`

```typescript
import { Hono } from "hono"
import { eq, and, isNull, desc } from "drizzle-orm"
import { papers, workspacePapers, createDbClient } from "@sapientia/db"
import { config } from "../config"
import { requireAuth, type AuthContext } from "../middleware/auth"
import { requireMembership } from "../middleware/workspace"
import {
  uploadPaper,
  userCanAccessPaper,
  PaperTooLargeError,
  InvalidPaperContentError,
} from "../services/paper"
import { generatePresignedGetUrl } from "../services/s3-client"

const { db } = createDbClient(config.DATABASE_URL)

export const paperRoutes = new Hono<AuthContext>()

// Upload paper to a workspace
paperRoutes.post(
  "/workspaces/:workspaceId/papers",
  requireAuth,
  requireMembership("editor"),
  async (c) => {
    const workspaceId = c.req.param("workspaceId")
    const user = c.get("user")

    const formData = await c.req.formData()
    const file = formData.get("file")
    if (!(file instanceof File)) {
      return c.json({ error: "file field required" }, 400)
    }
    if (file.type !== "application/pdf") {
      return c.json({ error: "only application/pdf accepted" }, 415)
    }

    const fileBytes = new Uint8Array(await file.arrayBuffer())

    try {
      const paper = await uploadPaper({
        userId: user.id,
        workspaceId,
        fileBytes,
        filename: file.name || "untitled.pdf",
        db,
      })
      return c.json(paper, 200)
    } catch (err) {
      if (err instanceof PaperTooLargeError) {
        return c.json({ error: "file exceeds 50MB limit" }, 413)
      }
      if (err instanceof InvalidPaperContentError) {
        return c.json({ error: err.message }, 400)
      }
      throw err
    }
  },
)

// List papers in workspace
paperRoutes.get(
  "/workspaces/:workspaceId/papers",
  requireAuth,
  requireMembership("reader"),
  async (c) => {
    const workspaceId = c.req.param("workspaceId")

    const rows = await db
      .select(/* paper fields */)
      .from(papers)
      .innerJoin(workspacePapers, eq(workspacePapers.paperId, papers.id))
      .where(
        and(
          eq(workspacePapers.workspaceId, workspaceId),
          isNull(papers.deletedAt),
        ),
      )
      .orderBy(desc(papers.createdAt))

    return c.json(rows)
  },
)

// Get paper metadata
paperRoutes.get("/papers/:id", requireAuth, async (c) => {
  const id = c.req.param("id")
  const user = c.get("user")

  const [paper] = await db.select().from(papers).where(eq(papers.id, id)).limit(1)
  if (!paper || paper.deletedAt) {
    return c.json({ error: "not found" }, 404)
  }

  if (!(await userCanAccessPaper(user.id, paper.id, db))) {
    return c.json({ error: "forbidden" }, 403)
  }

  return c.json(paper)
})

// Get presigned PDF URL
paperRoutes.get("/papers/:id/pdf-url", requireAuth, async (c) => {
  const id = c.req.param("id")
  const user = c.get("user")

  const [paper] = await db.select().from(papers).where(eq(papers.id, id)).limit(1)
  if (!paper || paper.deletedAt) {
    return c.json({ error: "not found" }, 404)
  }

  if (!(await userCanAccessPaper(user.id, paper.id, db))) {
    return c.json({ error: "forbidden" }, 403)
  }

  const url = await generatePresignedGetUrl(paper.pdfObjectKey, 3600)
  return c.json({ url, expiresInSeconds: 3600 })
})
```

Wire up in `index.ts`:
```typescript
import { paperRoutes } from "./routes/papers"
app.route("/api/v1", paperRoutes)
```

---

## Tests

`apps/api/test/papers.test.ts`:

For tests, use a real MinIO testcontainer (we already have one in `health.test.ts`'s setup). Initialize the bucket on startup.

Tests to write:
1. Upload small valid PDF → 200, paper created, MinIO has file
2. Upload duplicate (same user) → returns same paper ID, only one MinIO object
3. Different users, same content → two papers, two MinIO objects (per ADR-005)
4. Upload >50MB → 413
5. Wrong content-type → 415
6. Invalid PDF magic bytes → 400
7. GET paper metadata → 200
8. GET pdf-url → 200, URL resolves to original content (download from URL, compare hash)
9. List papers ordered by createdAt desc
10. Cross-user access denied → 403

Use a tiny valid PDF for fixtures. Either commit a small PDF to `apps/api/test/fixtures/` or generate one programmatically (`%PDF-1.4\n...minimal valid structure`).

---

## Do Not

- **Do not call MinerU.** Future task. `parseStatus` stays "pending".
- **Do not extract PDF metadata** (title, authors, etc.) — comes from MinerU later.
- **Do not implement paper deletion API.** `deletedAt` exists but no DELETE endpoint yet.
- **Do not generate PDF thumbnails.** v0.2+.
- **Do not stream PDFs through our backend.** Presigned URL is faster and saves bandwidth.
- **Do not use the user's filename in `pdfObjectKey`.** Always `papers/{userId}/{paperId}/source.pdf` for predictability.
- **Do not let users upload to a workspace they're not editor in.** `requireMembership("editor")` enforces.
- **Do not cross-list papers across workspaces.** Always scope to a specific workspace.
- **Do not skip the magic bytes check.** Content-type can be spoofed.

---

## Decisions Recorded for This Task

- **SHA-256 of PDF bytes** as dedup key. Universal.
- **Magic bytes check before hashing** — fast rejection.
- **Presigned URLs for PDF delivery** — better performance, lower memory.
- **Per-user S3 path prefix** (`papers/{userId}/...`) — clean namespacing, easier lifecycle policies later.
- **`workspace_papers` association table** — supports v0.2 sharing model without v0.1 schema rewrite.

---

## Definition of Done — Quick Checklist

- [ ] Migration creates papers + workspace_papers tables
- [ ] S3 client supports upload + presigned GET
- [ ] Upload endpoint dedupes correctly per ADR-005
- [ ] Authorization enforced on all paper endpoints
- [ ] All tests pass with testcontainers (Postgres + MinIO)
- [ ] Manual test: upload 5MB ML paper locally, verify MinIO has file (`mc ls local/sapientia/papers/`)
- [ ] STATUS.md updated, commit `[TASK-005] Paper upload with MinIO storage and per-user dedup`

---

## Report Back

After completing:
- Confirm testcontainers MinIO setup is reliable (sometimes needs explicit health waits)
- Note actual upload time for a typical 5 MB PDF locally
- Suggest if `MAX_FILE_SIZE_BYTES` of 50 MB feels right (some thesis PDFs are larger)
- Flag any quirks of `@aws-sdk/client-s3` with MinIO (path-style addressing, signing version)