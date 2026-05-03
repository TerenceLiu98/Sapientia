# TASK-010: MinerU API client + paper-parse job (real implementation)

**Estimated effort**: 8-10 hours
**Depends on**: TASK-009
**Phase**: 2 — Block-Level Foundation

---

## Context

The worker pipeline is wired up (TASK-009 stub). Now we replace the stub with the real MinerU integration. This includes:

1. A `user_credentials` table that stores encrypted MinerU + LLM API tokens per user.
2. Envelope encryption helpers using `ENCRYPTION_KEY` (master key) → AES-GCM data keys.
3. A typed MinerU HTTP client.
4. The real `paper-parse` job: download PDF from MinIO → call MinerU `/api/v4/extract/task` → poll status → download result zip → extract `blocks.json` → upload to MinIO → update `papers.blocksObjectKey` and `parseStatus`.
5. Settings page on the frontend so users can input their MinerU + LLM API keys.

We keep the standard MinerU API endpoint (per ADR-003), not the lightweight one — token-authenticated, supports VLM, 200MB / 200 page limits, fits academic papers.

---

## Acceptance Criteria

1. **`user_credentials` schema** with encrypted columns for MinerU token + LLM API key.
2. **Encryption helpers** (`apps/api/src/services/crypto.ts`) using AES-256-GCM envelope encryption. `ENCRYPTION_KEY` env var (32-byte base64) is the master key. Each ciphertext stores: nonce + encrypted-data-key + encrypted-payload.
3. **MinerU client** (`apps/api/src/services/mineru-client.ts`) with typed methods:
   - `submitParseTask({ token, pdfUrl, modelVersion?, ... })` → returns task_id
   - `getTaskStatus({ token, taskId })` → returns state + (when done) `full_zip_url`
4. **Paper-parse job** (replacing TASK-009 stub):
   - Load paper row, get `pdfObjectKey`
   - Generate a presigned **GET** URL for MinerU to fetch (MinerU ingests by URL, not multipart upload to standard endpoint)
   - Load user's MinerU token from `user_credentials` (decrypted)
   - Submit parse task → poll until done (with timeout + sane interval)
   - Download result zip from `full_zip_url`
   - Extract the `*_content_list.json` (per MinerU output spec, this is the structured block list we need)
   - Upload to MinIO at `papers/{userId}/{paperId}/blocks.json`
   - Update paper row: `parseStatus="done"`, `blocksObjectKey=...`, populate title/authors if MinerU exposes them
5. **Settings endpoints**:
   - `GET /api/v1/me/credentials/status` → `{ hasMineruToken: bool, hasLlmKey: bool }`
   - `PATCH /api/v1/me/credentials` → accepts `{ mineruToken?, llmProvider?, llmApiKey? }`, encrypts and stores
6. **Frontend Settings page** at `/settings`:
   - Form with fields: MinerU API token, LLM provider (dropdown), LLM API key
   - Save button → PATCH endpoint
   - Status indicator: "MinerU: configured ✓ / not configured"
7. **Friendly error in upload flow**: if user uploads a paper but has no MinerU token configured, the job fails fast with `parseError = "MinerU API token not configured. See Settings."` and frontend surfaces this.
8. **Frontend polling continues to work** (TASK-009 already set up).
9. **Tests**: encryption round-trip, decrypt with wrong master key fails, MinerU client with mocked HTTP, end-to-end job test against MinerU mock server.

---

## What to Build

### Schema

`packages/db/src/schema/credentials.ts`:

```typescript
import { pgTable, text, timestamp, customType } from "drizzle-orm/pg-core"
import { user } from "./auth"

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea"
  },
})

export const userCredentials = pgTable("user_credentials", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),

  // MinerU API token (encrypted)
  mineruTokenCiphertext: bytea("mineru_token_ciphertext"),

  // LLM provider + API key (encrypted)
  llmProvider: text("llm_provider", { enum: ["anthropic", "openai"] }),
  llmApiKeyCiphertext: bytea("llm_api_key_ciphertext"),

  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export type UserCredentials = typeof userCredentials.$inferSelect
```

Add to schema barrel and generate migration.

### Encryption helpers

Add `ENCRYPTION_KEY` to config:

```typescript
// apps/api/src/config.ts
ENCRYPTION_KEY: z.string().refine(
  (v) => Buffer.from(v, "base64").length === 32,
  "ENCRYPTION_KEY must be 32 bytes encoded as base64 (use: openssl rand -base64 32)",
),
```

`apps/api/src/services/crypto.ts`:

```typescript
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto"
import { config } from "../config"

const ALG = "aes-256-gcm"
const NONCE_LEN = 12  // GCM standard
const TAG_LEN = 16
const DATA_KEY_LEN = 32

const masterKey = Buffer.from(config.ENCRYPTION_KEY, "base64")

/**
 * Envelope encryption:
 *   plaintext → encrypt with random data_key (DEK)
 *   DEK → encrypt with master_key (KEK)
 *   ciphertext = [version | dek_nonce | dek_tag | encrypted_dek
 *                 | data_nonce | data_tag | encrypted_data]
 *
 * Why envelope encryption (vs encrypting directly with master key):
 *   - Compromise of one ciphertext exposes only its DEK, not the master key
 *   - Future master key rotation: re-encrypt only DEKs, not actual data
 *   - Different DEKs per record means cryptanalysis on bulk data is harder
 */

const VERSION_BYTE = 0x01

export function encrypt(plaintext: string): Buffer {
  const dek = randomBytes(DATA_KEY_LEN)

  // Encrypt DEK with master key
  const dekNonce = randomBytes(NONCE_LEN)
  const dekCipher = createCipheriv(ALG, masterKey, dekNonce)
  const encryptedDek = Buffer.concat([dekCipher.update(dek), dekCipher.final()])
  const dekTag = dekCipher.getAuthTag()

  // Encrypt data with DEK
  const dataNonce = randomBytes(NONCE_LEN)
  const dataCipher = createCipheriv(ALG, dek, dataNonce)
  const encryptedData = Buffer.concat([
    dataCipher.update(plaintext, "utf8"),
    dataCipher.final(),
  ])
  const dataTag = dataCipher.getAuthTag()

  return Buffer.concat([
    Buffer.from([VERSION_BYTE]),
    dekNonce,
    dekTag,
    encryptedDek,
    dataNonce,
    dataTag,
    encryptedData,
  ])
}

export function decrypt(ciphertext: Buffer): string {
  let offset = 0
  const version = ciphertext[offset]
  offset += 1
  if (version !== VERSION_BYTE) {
    throw new Error(`unknown ciphertext version: ${version}`)
  }

  const dekNonce = ciphertext.subarray(offset, offset + NONCE_LEN)
  offset += NONCE_LEN
  const dekTag = ciphertext.subarray(offset, offset + TAG_LEN)
  offset += TAG_LEN
  const encryptedDek = ciphertext.subarray(offset, offset + DATA_KEY_LEN)
  offset += DATA_KEY_LEN

  const dataNonce = ciphertext.subarray(offset, offset + NONCE_LEN)
  offset += NONCE_LEN
  const dataTag = ciphertext.subarray(offset, offset + TAG_LEN)
  offset += TAG_LEN
  const encryptedData = ciphertext.subarray(offset)

  // Decrypt DEK
  const dekDecipher = createDecipheriv(ALG, masterKey, dekNonce)
  dekDecipher.setAuthTag(dekTag)
  const dek = Buffer.concat([
    dekDecipher.update(encryptedDek),
    dekDecipher.final(),
  ])

  // Decrypt data
  const dataDecipher = createDecipheriv(ALG, dek, dataNonce)
  dataDecipher.setAuthTag(dataTag)
  const plaintext = Buffer.concat([
    dataDecipher.update(encryptedData),
    dataDecipher.final(),
  ])
  return plaintext.toString("utf8")
}

/** Hash a credential value for safe logging (NOT for storage). */
export function fingerprint(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex").slice(0, 8)
}
```

> **Important**: this is real cryptography. The reviewer (you, future you, or a security-aware contributor) should compare against [Node crypto docs](https://nodejs.org/api/crypto.html). The version byte allows future migration if we ever switch algorithms.

### Credentials service

`apps/api/src/services/credentials.ts`:

```typescript
import { eq } from "drizzle-orm"
import { userCredentials, createDbClient } from "@sapientia/db"
import { config } from "../config"
import { encrypt, decrypt } from "./crypto"
import { logger } from "../logger"

const { db } = createDbClient(config.DATABASE_URL)

export interface CredentialsStatus {
  hasMineruToken: boolean
  hasLlmKey: boolean
  llmProvider: "anthropic" | "openai" | null
}

export async function getCredentialsStatus(userId: string): Promise<CredentialsStatus> {
  const [row] = await db
    .select()
    .from(userCredentials)
    .where(eq(userCredentials.userId, userId))
    .limit(1)

  if (!row) {
    return { hasMineruToken: false, hasLlmKey: false, llmProvider: null }
  }

  return {
    hasMineruToken: row.mineruTokenCiphertext != null,
    hasLlmKey: row.llmApiKeyCiphertext != null,
    llmProvider: row.llmProvider,
  }
}

export async function getMineruToken(userId: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(userCredentials)
    .where(eq(userCredentials.userId, userId))
    .limit(1)

  if (!row?.mineruTokenCiphertext) return null
  return decrypt(row.mineruTokenCiphertext)
}

export async function getLlmCredential(
  userId: string,
): Promise<{ provider: "anthropic" | "openai"; apiKey: string } | null> {
  const [row] = await db
    .select()
    .from(userCredentials)
    .where(eq(userCredentials.userId, userId))
    .limit(1)

  if (!row?.llmApiKeyCiphertext || !row.llmProvider) return null
  return { provider: row.llmProvider, apiKey: decrypt(row.llmApiKeyCiphertext) }
}

export async function updateCredentials(
  userId: string,
  updates: {
    mineruToken?: string | null
    llmProvider?: "anthropic" | "openai" | null
    llmApiKey?: string | null
  },
) {
  const dbValues: Partial<typeof userCredentials.$inferInsert> = {
    userId,
    updatedAt: new Date(),
  }

  if (updates.mineruToken !== undefined) {
    dbValues.mineruTokenCiphertext = updates.mineruToken
      ? encrypt(updates.mineruToken)
      : null
  }
  if (updates.llmProvider !== undefined) {
    dbValues.llmProvider = updates.llmProvider
  }
  if (updates.llmApiKey !== undefined) {
    dbValues.llmApiKeyCiphertext = updates.llmApiKey
      ? encrypt(updates.llmApiKey)
      : null
  }

  await db
    .insert(userCredentials)
    .values(dbValues as typeof userCredentials.$inferInsert)
    .onConflictDoUpdate({
      target: userCredentials.userId,
      set: dbValues,
    })

  logger.info({ userId, updated: Object.keys(updates) }, "credentials_updated")
}
```

### MinerU client

`apps/api/src/services/mineru-client.ts`:

```typescript
import { z } from "zod"
import { logger } from "../logger"

const MINERU_BASE_URL = "https://mineru.net"

const SubmitTaskResponseSchema = z.object({
  code: z.number(),
  data: z.object({
    task_id: z.string(),
  }).optional(),
  msg: z.string(),
  trace_id: z.string().optional(),
})

const TaskStatusResponseSchema = z.object({
  code: z.number(),
  data: z.object({
    task_id: z.string(),
    state: z.enum(["pending", "running", "done", "failed", "converting"]),
    full_zip_url: z.string().optional(),
    err_msg: z.string().optional(),
    extract_progress: z
      .object({
        extracted_pages: z.number().optional(),
        total_pages: z.number().optional(),
        start_time: z.string().optional(),
      })
      .optional(),
  }),
  msg: z.string(),
})

export type MineruTaskState = "pending" | "running" | "done" | "failed" | "converting"

export interface MineruTaskStatus {
  taskId: string
  state: MineruTaskState
  zipUrl?: string
  errorMessage?: string
  extractedPages?: number
  totalPages?: number
}

export class MineruApiError extends Error {
  constructor(
    public code: number,
    public msg: string,
  ) {
    super(`MinerU API error ${code}: ${msg}`)
  }
}

export async function submitParseTask(args: {
  token: string
  pdfUrl: string
  modelVersion?: "pipeline" | "vlm" | "MinerU-HTML"
  isOcr?: boolean
  enableFormula?: boolean
  enableTable?: boolean
  language?: string
  dataId?: string
}): Promise<string> {
  const {
    token,
    pdfUrl,
    modelVersion = "vlm",
    isOcr = false,
    enableFormula = true,
    enableTable = true,
    language = "ch",
    dataId,
  } = args

  const res = await fetch(`${MINERU_BASE_URL}/api/v4/extract/task`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      url: pdfUrl,
      model_version: modelVersion,
      is_ocr: isOcr,
      enable_formula: enableFormula,
      enable_table: enableTable,
      language,
      ...(dataId ? { data_id: dataId } : {}),
    }),
  })

  if (!res.ok) {
    throw new MineruApiError(res.status, `HTTP ${res.status} ${res.statusText}`)
  }

  const json = await res.json()
  const parsed = SubmitTaskResponseSchema.parse(json)
  if (parsed.code !== 0 || !parsed.data?.task_id) {
    throw new MineruApiError(parsed.code, parsed.msg)
  }
  return parsed.data.task_id
}

export async function getTaskStatus(args: {
  token: string
  taskId: string
}): Promise<MineruTaskStatus> {
  const { token, taskId } = args

  const res = await fetch(`${MINERU_BASE_URL}/api/v4/extract/task/${taskId}`, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  })

  if (!res.ok) {
    throw new MineruApiError(res.status, `HTTP ${res.status} ${res.statusText}`)
  }

  const json = await res.json()
  const parsed = TaskStatusResponseSchema.parse(json)
  if (parsed.code !== 0) {
    throw new MineruApiError(parsed.code, parsed.msg)
  }

  const data = parsed.data
  return {
    taskId: data.task_id,
    state: data.state,
    zipUrl: data.full_zip_url,
    errorMessage: data.err_msg,
    extractedPages: data.extract_progress?.extracted_pages,
    totalPages: data.extract_progress?.total_pages,
  }
}

/** Poll until terminal state, with max wait time. */
export async function waitForCompletion(args: {
  token: string
  taskId: string
  intervalMs?: number
  timeoutMs?: number
}): Promise<MineruTaskStatus> {
  const { token, taskId, intervalMs = 5000, timeoutMs = 10 * 60 * 1000 } = args
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const status = await getTaskStatus({ token, taskId })
    logger.debug({ taskId, state: status.state, progress: status.extractedPages }, "mineru_poll")

    if (status.state === "done") return status
    if (status.state === "failed") return status

    await new Promise((r) => setTimeout(r, intervalMs))
  }

  throw new Error(`MinerU task ${taskId} did not complete within ${timeoutMs}ms`)
}
```

### Real paper-parse worker

Replace the stub in `apps/api/src/workers/paper-parse.worker.ts`:

```typescript
import { Worker, type Job } from "bullmq"
import { eq } from "drizzle-orm"
import { papers, createDbClient } from "@sapientia/db"
import { config } from "../config"
import { logger } from "../logger"
import { queueConnection } from "../queues/connection"
import {
  PAPER_PARSE_QUEUE,
  type PaperParseJobData,
  type PaperParseJobResult,
} from "../queues/paper-parse"
import { getMineruToken } from "../services/credentials"
import { submitParseTask, waitForCompletion } from "../services/mineru-client"
import { generatePresignedGetUrl, s3Client } from "../services/s3-client"
import { PutObjectCommand } from "@aws-sdk/client-s3"

const { db } = createDbClient(config.DATABASE_URL)

class MissingCredentialError extends Error {
  constructor() {
    super("MinerU API token not configured. See Settings.")
  }
}

async function processPaperParse(
  job: Job<PaperParseJobData, PaperParseJobResult>,
): Promise<PaperParseJobResult> {
  const { paperId, userId } = job.data
  const log = logger.child({ jobId: job.id, paperId })

  log.info("paper_parse_job_started")

  const token = await getMineruToken(userId)
  if (!token) {
    throw new MissingCredentialError()
  }

  // Mark as parsing
  const [paper] = await db.select().from(papers).where(eq(papers.id, paperId)).limit(1)
  if (!paper) throw new Error(`paper ${paperId} not found`)

  await db
    .update(papers)
    .set({ parseStatus: "parsing", parseError: null, updatedAt: new Date() })
    .where(eq(papers.id, paperId))

  // Generate a presigned URL MinerU can fetch from
  // 30 min should be more than enough for MinerU to ingest.
  const pdfUrl = await generatePresignedGetUrl(paper.pdfObjectKey, 30 * 60)

  // Submit
  const taskId = await submitParseTask({
    token,
    pdfUrl,
    modelVersion: "vlm",
    dataId: paperId,
  })
  log.info({ mineruTaskId: taskId }, "mineru_task_submitted")

  // Poll until done
  const result = await waitForCompletion({ token, taskId })

  if (result.state === "failed") {
    throw new Error(`MinerU parse failed: ${result.errorMessage ?? "unknown error"}`)
  }
  if (!result.zipUrl) {
    throw new Error("MinerU returned 'done' state without a zip URL")
  }

  // Download the zip
  const zipRes = await fetch(result.zipUrl)
  if (!zipRes.ok) {
    throw new Error(`failed to download MinerU result zip: HTTP ${zipRes.status}`)
  }
  const zipBuffer = Buffer.from(await zipRes.arrayBuffer())

  // Extract `*_content_list.json` from the zip
  // The zip from MinerU contains: full.md, layout.json, *_content_list.json, *_model.json, assets/
  // We want content_list.json — it's the structured block list per ADR-003.
  const blocksJson = await extractContentList(zipBuffer)

  // Upload blocks.json to MinIO
  const blocksKey = `papers/${userId}/${paperId}/blocks.json`
  await s3Client.send(
    new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: blocksKey,
      Body: blocksJson,
      ContentType: "application/json",
    }),
  )

  // Also upload the raw zip for future reprocessing flexibility
  const zipKey = `papers/${userId}/${paperId}/mineru-result.zip`
  await s3Client.send(
    new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: zipKey,
      Body: zipBuffer,
      ContentType: "application/zip",
    }),
  )

  // Mark done
  await db
    .update(papers)
    .set({
      parseStatus: "done",
      blocksObjectKey: blocksKey,
      parseError: null,
      updatedAt: new Date(),
    })
    .where(eq(papers.id, paperId))

  log.info({ blocksKey }, "paper_parse_job_completed")

  return {
    paperId,
    blocksObjectKey: blocksKey,
    parsedAt: new Date().toISOString(),
  }
}

async function extractContentList(zipBuffer: Buffer): Promise<Buffer> {
  // Use a tiny zip library. yauzl works well in Bun/Node.
  // Add `bun add yauzl @types/yauzl` to apps/api.
  const yauzl = await import("yauzl")

  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(zipBuffer, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err)
      if (!zipfile) return reject(new Error("zip file is empty"))

      zipfile.readEntry()
      zipfile.on("entry", (entry) => {
        if (entry.fileName.endsWith("_content_list.json")) {
          zipfile.openReadStream(entry, (err, stream) => {
            if (err) return reject(err)
            if (!stream) return reject(new Error("read stream is null"))
            const chunks: Buffer[] = []
            stream.on("data", (c) => chunks.push(c))
            stream.on("end", () => resolve(Buffer.concat(chunks)))
            stream.on("error", reject)
          })
        } else {
          zipfile.readEntry()
        }
      })
      zipfile.on("end", () => reject(new Error("content_list.json not found in MinerU zip")))
      zipfile.on("error", reject)
    })
  })
}

export function createPaperParseWorker() {
  const worker = new Worker<PaperParseJobData, PaperParseJobResult>(
    PAPER_PARSE_QUEUE,
    processPaperParse,
    { connection: queueConnection, concurrency: 2 },  // Lower than stub: external API rate limits
  )

  worker.on("failed", async (job, err) => {
    if (!job) return
    const log = logger.child({ jobId: job.id, paperId: job.data.paperId })
    log.error({ err: err.message, attempts: job.attemptsMade }, "paper_parse_job_failed")

    // Don't retry permanent errors (missing credentials, bad PDF format from MinerU)
    const isPermanent =
      err instanceof MissingCredentialError ||
      err.message.includes("file format") ||
      err.message.includes("page count")  // matches MinerU error messages

    const finalAttempt = isPermanent || job.attemptsMade >= (job.opts.attempts ?? 1)

    if (finalAttempt) {
      await db
        .update(papers)
        .set({
          parseStatus: "failed",
          parseError: err.message.slice(0, 500),
          updatedAt: new Date(),
        })
        .where(eq(papers.id, job.data.paperId))
    } else {
      await db
        .update(papers)
        .set({ parseStatus: "pending", updatedAt: new Date() })
        .where(eq(papers.id, job.data.paperId))
    }
  })

  return worker
}
```

### Settings endpoints

`apps/api/src/routes/me.ts` (extend existing):

```typescript
import { z } from "zod"
import { getCredentialsStatus, updateCredentials } from "../services/credentials"

const UpdateCredentialsSchema = z.object({
  mineruToken: z.string().nullable().optional(),
  llmProvider: z.enum(["anthropic", "openai"]).nullable().optional(),
  llmApiKey: z.string().nullable().optional(),
})

meRoutes.get("/me/credentials/status", requireAuth, async (c) => {
  const user = c.get("user")
  return c.json(await getCredentialsStatus(user.id))
})

meRoutes.patch("/me/credentials", requireAuth, async (c) => {
  const user = c.get("user")
  const body = UpdateCredentialsSchema.parse(await c.req.json())
  await updateCredentials(user.id, body)
  return c.json({ ok: true })
})
```

### Frontend Settings page

`apps/web/src/routes/settings.tsx`:

A simple form:
- Email (readonly, from session)
- MinerU API Token (password input + "show" toggle + status: configured/not)
- LLM Provider (select: Anthropic / OpenAI)
- LLM API Key (password input + status)
- Save button

Three corresponding TanStack Query mutations:
- `useUpdateCredentials()` calling `PATCH /me/credentials`
- `useCredentialsStatus()` calling `GET /me/credentials/status`

`useCurrentWorkspace` already exists for the user data.

Add a link to Settings in the user dropdown menu (TopBar).

If `parseStatus === "failed"` and the error message contains "MinerU API token", surface a CTA: "Configure MinerU →" linking to /settings.

### Dockerfile for the API/worker

Now that worker is real, create `apps/api/Dockerfile`:

```dockerfile
FROM oven/bun:1.2-alpine

WORKDIR /app

# Copy workspace + lockfile
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/

# Use pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/db packages/db
COPY packages/shared packages/shared
COPY apps/api apps/api

# Default to API; override CMD for worker
CMD ["bun", "apps/api/src/index.ts"]
```

The same image is used for both API and worker — `kubectl run` overrides the command.

### Tests

`apps/api/test/crypto.test.ts`:
- Round-trip: encrypt then decrypt returns original
- Different ciphertexts for same plaintext (nonces are random)
- Decrypt with wrong master key throws (use a different key for decrypt)
- Tampered ciphertext throws (flip a byte)

`apps/api/test/mineru-client.test.ts`:
- Mock `fetch` (use `vi.fn()` or msw if you want to add it)
- `submitParseTask` returns task_id on success
- `submitParseTask` throws `MineruApiError` on `code !== 0`
- `getTaskStatus` parses `done` state correctly
- `waitForCompletion` polls until done
- `waitForCompletion` throws on timeout

`apps/api/test/paper-parse-worker.test.ts`:
- Set up testcontainers Postgres + Redis + MinIO
- Mock MinerU at HTTP level (use a small `Bun.serve` mock that responds to /api/v4/extract/task and /api/v4/extract/task/:id)
- Insert paper with parseStatus=pending
- Insert user_credentials with encrypted MinerU token
- Run worker, wait for completion
- Assert: parseStatus=done, blocksObjectKey populated, MinIO object exists

---

## Do Not

- **Do not store plaintext credentials anywhere** — not in env, not in DB, not in logs.
- **Do not log the credentials** even at debug level. Use `fingerprint()` if you need a stable identifier.
- **Do not skip GCM auth tag verification.** Decryption must throw on tampered ciphertext. The `setAuthTag` + `final()` flow does this — don't catch and silence those errors.
- **Do not commit ENCRYPTION_KEY** to env.example with a real value. Leave it empty with a comment to generate.
- **Do not use the same DEK across records.** Each `encrypt()` call generates a fresh DEK.
- **Do not call MinerU's `/api/v1/agent/parse/url`** lightweight endpoint. Per ADR-003 we use the standard `/api/v4/extract/task`. The lightweight one has 10MB / 20 page limits and is for "AI agent" workflows, not user-uploaded papers.
- **Do not multipart-upload to the standard MinerU endpoint.** The standard endpoint takes a URL. We give it a presigned MinIO URL. The lightweight endpoint has separate signed-upload flow we don't use.
- **Do not download the MinIO object for MinerU**. Just generate a presigned URL pointing to MinIO. **Important caveat**: MinerU's servers must be able to reach your MinIO. If MinIO is internal-only K8s, this won't work — MinerU calls timeout. **Note for self-hosting**: in production, you may need to expose MinIO behind a public ingress (with appropriate ACLs) or fall back to the lightweight endpoint or download-and-resubmit. **For TASK-010, document this as a known limitation; v0.2 figures out the right approach.**
- **Do not poll MinerU faster than 3-5 seconds.** Their docs don't specify a rate limit but academic decency.
- **Do not automatically retry permanent errors.** Bad PDF format, missing token, page count exceeded — let them fail fast and surface to the user.
- **Do not skip the version byte** in ciphertext. Future-proofs the format.
- **Do not store the MinerU result zip in Postgres.** MinIO. Postgres holds metadata only.
- **Do not parse the MinerU `content_list.json` schema yet.** TASK-011 introduces the `blocks` table and content_list parsing. This task only gets the JSON into MinIO.

---

## Decisions Recorded for This Task

- **Envelope encryption** (DEK + KEK) over direct master-key encryption. Industry standard for credential storage.
- **AES-256-GCM** specifically. Authenticated encryption — both confidentiality and integrity.
- **Version byte** in ciphertext format. Allows algorithm migration later without breaking decryption.
- **MinerU model: `vlm`** (per their docs, recommended for academic content with figures/tables). `pipeline` is the default but VLM gives better results for the hard cases.
- **MinerU polling at 5 seconds**. Below this is rude, above this slows feedback for short papers.
- **10-minute MinerU timeout**. Long papers take ~5 min, this gives buffer. Failed at 10 min becomes paper.parseError.
- **MinerU public exposure of MinIO is a known limitation**. v0.1 dev works because everything's local. Production K8s needs to figure this out — note it.
- **Permanent error detection by error message string match** is a hack. v0.2 should map MinerU error codes properly.

---

## Definition of Done — Quick Checklist

- [ ] `user_credentials` table migrated
- [ ] Encryption round-trips correctly (test passes)
- [ ] Settings page allows entering MinerU token
- [ ] Token saved → `GET /me/credentials/status` returns `hasMineruToken: true`
- [ ] Upload a real ML paper → after MinerU returns, paper transitions to `done` with `blocksObjectKey` populated
- [ ] MinIO has both `blocks.json` and `mineru-result.zip` for the paper
- [ ] Upload without configured token → status `failed` with friendly error message
- [ ] All new tests pass
- [ ] Existing tests still pass
- [ ] STATUS.md updated, commit `[TASK-010] MinerU integration with encrypted credentials`

---

## Report Back

After completing:
- **MinerU public-URL issue**: confirm whether your dev setup needs MinIO exposed publicly, or if MinerU can reach localhost via tunnel
- Real timing on a 30-page paper (submit → done)
- Whether the VLM model output `content_list.json` matches your expectations of "block list"
- Any MinerU error codes you encountered that the worker doesn't handle gracefully
- Sketch what TASK-011's `blocks` table should hold based on actual `content_list.json` shape