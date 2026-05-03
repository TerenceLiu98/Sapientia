# TASK-009: BullMQ worker process + first job (paper-parse-stub)

**Estimated effort**: 5-7 hours
**Depends on**: TASK-005
**Phase**: 2 — Block-Level Foundation

---

## Context

We have papers stored, but `parseStatus` never moves past `"pending"`. Before connecting to MinerU (TASK-010), we set up the BullMQ worker topology with a stub job that exercises the full state machine: `pending` → `parsing` → `done`.

Why a stub first: BullMQ + Redis + worker process + retry logic + error handling are themselves a lot of moving pieces. Validating that pipeline in isolation, before adding the external MinerU dependency, makes failure diagnosis much easier. When TASK-010 fails, we'll know it's MinerU-side; when this task fails, we'll know it's queue-side.

---

## Acceptance Criteria

1. `apps/api/src/worker.ts` is a separate Bun entry point. Run via `bun run worker:dev`. It connects to Redis, registers the `paper-parse` queue worker, and stays alive listening.
2. The API process (`src/index.ts`) **enqueues** jobs but **does not consume** them. Worker process consumes.
3. New job: `paper-parse` with payload `{ paperId, userId }`. Stub implementation: sleep 3s, then mark paper as `done`.
4. State machine in DB: when job starts, set `parseStatus = "parsing"`. When job completes, set `parseStatus = "done"`. On error, set `"failed"` with `parseError` populated.
5. After paper upload (TASK-005), API enqueues a `paper-parse` job. New papers go through `pending → parsing → done` automatically.
6. New API endpoint: `GET /api/v1/health/queue` returns BullMQ queue stats (waiting / active / completed / failed counts) for diagnostics.
7. Worker handles a "test job" type for healthcheck verification.
8. `docker-compose.yml` adds a `worker` service definition (commented out by default since dev typically runs worker on host via `bun run worker:dev` with `--hot` reload). The compose service is a documented option for "background worker should run while I work on frontend."
9. Tests cover: enqueue creates job, worker picks up job, status transitions, error path sets `failed`, retry behavior on transient error.
10. STATUS.md updated.

---

## What to Build

### Install dependencies

```bash
cd apps/api
bun add bullmq
```

> BullMQ pulls in `ioredis` which we already have from TASK-002.

### Queue + worker organization

`apps/api/src/queues/`:
- `connection.ts` — shared Redis connection used by Queue + Worker
- `paper-parse.ts` — queue + job type definition + enqueue helper

`apps/api/src/workers/`:
- `paper-parse.worker.ts` — handler implementation

`apps/api/src/worker.ts` — entry point that registers all workers.

### `apps/api/src/queues/connection.ts`

```typescript
import { Redis } from "ioredis"
import { config } from "../config"

// BullMQ requires maxRetriesPerRequest: null on the connection
// (otherwise blocking commands fail).
export const queueConnection = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
})
```

### `apps/api/src/queues/paper-parse.ts`

```typescript
import { Queue } from "bullmq"
import { queueConnection } from "./connection"

export const PAPER_PARSE_QUEUE = "paper-parse"

export interface PaperParseJobData {
  paperId: string
  userId: string
}

export interface PaperParseJobResult {
  paperId: string
  blocksObjectKey: string | null  // null in stub; populated in TASK-010
  parsedAt: string
}

export const paperParseQueue = new Queue<PaperParseJobData, PaperParseJobResult>(
  PAPER_PARSE_QUEUE,
  {
    connection: queueConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  },
)

export async function enqueuePaperParse(data: PaperParseJobData) {
  return paperParseQueue.add(`parse-${data.paperId}`, data, {
    jobId: `paper-parse:${data.paperId}`,  // idempotency: same paper won't enqueue twice if pending
  })
}
```

The `jobId` enforcement is crucial: if a paper upload retry happens before the previous job picks up, BullMQ deduplicates. Already-completed jobs with the same id will be discarded automatically per BullMQ semantics.

### `apps/api/src/workers/paper-parse.worker.ts`

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

const { db } = createDbClient(config.DATABASE_URL)

async function processPaperParse(
  job: Job<PaperParseJobData, PaperParseJobResult>,
): Promise<PaperParseJobResult> {
  const { paperId } = job.data
  const log = logger.child({ jobId: job.id, paperId })

  log.info("paper_parse_job_started")

  // Mark as parsing
  await db
    .update(papers)
    .set({ parseStatus: "parsing", parseError: null, updatedAt: new Date() })
    .where(eq(papers.id, paperId))

  // STUB: pretend to parse
  await new Promise((resolve) => setTimeout(resolve, 3000))

  // STUB: in TASK-010 this will actually call MinerU.
  // For now, no blocks are produced, blocks_object_key stays null.

  await db
    .update(papers)
    .set({
      parseStatus: "done",
      blocksObjectKey: null,  // TASK-010 will populate
      parseError: null,
      updatedAt: new Date(),
    })
    .where(eq(papers.id, paperId))

  log.info("paper_parse_job_completed")

  return {
    paperId,
    blocksObjectKey: null,
    parsedAt: new Date().toISOString(),
  }
}

export function createPaperParseWorker() {
  const worker = new Worker<PaperParseJobData, PaperParseJobResult>(
    PAPER_PARSE_QUEUE,
    processPaperParse,
    {
      connection: queueConnection,
      concurrency: 4,  // 4 papers in parallel
    },
  )

  worker.on("failed", async (job, err) => {
    if (!job) return
    const log = logger.child({ jobId: job.id, paperId: job.data.paperId })
    log.error({ err, attempts: job.attemptsMade }, "paper_parse_job_failed")

    // Only mark DB as "failed" after all retries exhausted
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await db
        .update(papers)
        .set({
          parseStatus: "failed",
          parseError: err.message.slice(0, 500),
          updatedAt: new Date(),
        })
        .where(eq(papers.id, job.data.paperId))
    } else {
      // Reset to "pending" so user UI doesn't say "parsing" forever between retries
      await db
        .update(papers)
        .set({ parseStatus: "pending", updatedAt: new Date() })
        .where(eq(papers.id, job.data.paperId))
    }
  })

  worker.on("error", (err) => {
    logger.error({ err }, "paper_parse_worker_error")
  })

  return worker
}
```

### `apps/api/src/worker.ts` — separate entry point

```typescript
import { logger } from "./logger"
import { config } from "./config"
import { createPaperParseWorker } from "./workers/paper-parse.worker"

logger.info({ env: config.NODE_ENV }, "worker_starting")

const paperParseWorker = createPaperParseWorker()

const shutdown = async (signal: string) => {
  logger.info({ signal }, "worker_shutdown_initiated")
  await paperParseWorker.close()
  process.exit(0)
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))

logger.info("worker_ready")
```

Add to `apps/api/package.json` scripts:
```json
"worker:dev": "bun --hot src/worker.ts",
"worker:start": "bun src/worker.ts"
```

Add to root `package.json`:
```json
"worker:dev": "pnpm --filter @sapientia/api worker:dev"
```

### Wire up enqueue in paper upload (TASK-005 update)

`apps/api/src/services/paper.ts` — add to the end of `uploadPaper` after the paper row is created (only on fresh uploads, not dedup hits):

```typescript
import { enqueuePaperParse } from "../queues/paper-parse"

// ... at the end of uploadPaper, after fresh insert (not dedup case):
await enqueuePaperParse({ paperId: paper.id, userId })
```

For dedup case: don't enqueue. The original paper either is already done or has a job in flight.

### Healthcheck endpoint

`apps/api/src/routes/health.ts`:

```typescript
import { Hono } from "hono"
import { paperParseQueue } from "../queues/paper-parse"
import { Queue } from "bullmq"
import { queueConnection } from "../queues/connection"

export const healthRoutes = new Hono()

healthRoutes.get("/health/queue", async (c) => {
  const stats = await paperParseQueue.getJobCounts(
    "waiting",
    "active",
    "completed",
    "failed",
    "delayed",
  )
  return c.json({
    queue: "paper-parse",
    counts: stats,
  })
})

// Smoke test endpoint for queue: enqueue a tiny "ping" job, wait for it, return
healthRoutes.get("/health/queue-roundtrip", async (c) => {
  const testQueue = new Queue("healthcheck", { connection: queueConnection })
  const testQueueName = "healthcheck"

  // Worker for this queue is set up in worker.ts (see below).
  const job = await testQueue.add("ping", { timestamp: Date.now() }, {
    removeOnComplete: true,
    removeOnFail: true,
  })

  try {
    const result = await job.waitUntilFinished(
      { /* QueueEvents instance */ } as never,  // Dev convenience; production should use proper QueueEvents
      5000,
    )
    return c.json({ status: "ok", result })
  } catch (err) {
    return c.json({ status: "error", message: (err as Error).message }, 503)
  }
})
```

> Note: `waitUntilFinished` requires a `QueueEvents` instance. For production correctness, instantiate it once at module level. The example above is sketched — full implementation in TASK-009 should set up `QueueEvents` properly.

Add to `index.ts`:
```typescript
import { healthRoutes } from "./routes/health"
app.route("/api/v1", healthRoutes)
```

### Healthcheck worker

In `worker.ts`, also start a tiny worker for the `healthcheck` queue:

```typescript
import { Worker } from "bullmq"

new Worker(
  "healthcheck",
  async (job) => ({ pong: true, receivedAt: Date.now(), originalAt: job.data.timestamp }),
  { connection: queueConnection, concurrency: 1 },
)
```

### Docker Compose worker service (optional)

`infra/docker/docker-compose.yml` — add a commented `worker` service:

```yaml
# Optional: run worker in docker.
# Default dev workflow: run worker on host via `pnpm worker:dev`.
# Uncomment if you want worker to run alongside infra.
#
# worker:
#   build:
#     context: ../..
#     dockerfile: apps/api/Dockerfile
#   command: bun src/worker.ts
#   environment:
#     - DATABASE_URL=postgresql://sapientia:dev_password@postgres:5432/sapientia_dev
#     - REDIS_URL=redis://redis:6379
#     - S3_ENDPOINT=http://minio:9000
#     - S3_ACCESS_KEY_ID=dev_admin
#     - S3_SECRET_ACCESS_KEY=dev_password
#     - S3_BUCKET=sapientia
#   depends_on:
#     postgres:
#       condition: service_healthy
#     redis:
#       condition: service_healthy
#     minio:
#       condition: service_healthy
```

This is documented as optional because `bun --hot` on host gives faster iteration than rebuilding a Docker image.

### Frontend: poll parseStatus until done

`apps/web/src/api/hooks/papers.ts` — add polling variant:

```typescript
export function usePaperWithPolling(paperId: string) {
  return useQuery<Paper>({
    queryKey: ["paper", paperId],
    queryFn: () => apiFetch(`/api/v1/papers/${paperId}`),
    refetchInterval: (query) => {
      const status = query.state.data?.parseStatus
      return status === "pending" || status === "parsing" ? 2000 : false
    },
  })
}
```

Then `LibraryView` and `PaperDetail` switch to `usePaperWithPolling` for active rows.

> **Refinement**: polling is wasteful at scale. v0.2 should switch to SSE (Hono has built-in SSE) or websockets. v0.1 polling at 2s intervals on visible rows only is fine.

### Tests

`apps/api/test/queue.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Queue, Worker } from "bullmq"
import { Redis } from "ioredis"
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis"

describe("BullMQ worker integration", () => {
  let redis: StartedRedisContainer
  let connection: Redis

  beforeAll(async () => {
    redis = await new RedisContainer("redis:7-alpine").start()
    connection = new Redis(
      `redis://${redis.getHost()}:${redis.getFirstMappedPort()}`,
      { maxRetriesPerRequest: null },
    )
  })

  afterAll(async () => {
    await connection.quit()
    await redis.stop()
  })

  it("enqueue and consume job", async () => {
    const queue = new Queue("test", { connection })
    const seen: number[] = []

    const worker = new Worker(
      "test",
      async (job) => {
        seen.push(job.data.value)
        return { processed: true }
      },
      { connection, concurrency: 1 },
    )

    await queue.add("inc", { value: 1 })
    await queue.add("inc", { value: 2 })

    // Wait for both
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(seen).toEqual([1, 2])

    await worker.close()
    await queue.close()
  })

  // Test the actual paper-parse stub flow:
  // - Insert a paper row with parseStatus=pending
  // - Enqueue paper-parse job
  // - Run worker, wait for completion
  // - Assert parseStatus=done in DB
  it("paper-parse stub: pending → parsing → done", async () => {
    // ... setup Postgres testcontainer + migrations
    // ... setup paper row
    // ... call enqueuePaperParse + start createPaperParseWorker
    // ... poll DB until parseStatus=done or timeout
    // ... assert
  })

  it("retries on error and marks failed after exhausting attempts", async () => {
    // ... mock processor that always throws
    // ... enqueue job with attempts: 2
    // ... wait until job.attemptsMade === 2
    // ... assert paper.parseStatus === "failed" with parseError set
  })

  it("transient error: status resets to pending between retries", async () => {
    // ... processor throws once then succeeds
    // ... after first failure, status is "pending" (not "failed")
    // ... after retry succeeds, status is "done"
  })
})
```

---

## Do Not

- **Do not consume jobs in the API process.** API enqueues only. Worker is a separate process. This separation is what enables independent scaling later.
- **Do not start the worker automatically when the API starts.** They are different commands, different processes, different lifecycles.
- **Do not call MinerU.** TASK-010. The stub job sleeps then succeeds.
- **Do not add new failure states.** `pending`, `parsing`, `done`, `failed` are the only values. Don't add `"queued"` or `"retrying"`.
- **Do not skip the `jobId` deduplication.** Re-uploads or re-tries must not create duplicate jobs for the same paper.
- **Do not write to MinIO yet.** TASK-010 produces blocks JSON.
- **Do not add a "manual retry" endpoint.** Failed jobs stay failed for v0.1; user can re-upload.
- **Do not poll the queue for completion in the API process.** API enqueues and returns. Frontend polls `GET /papers/{id}` for the status.
- **Do not let `parseStatus` get stuck in `"parsing"`** if the worker dies mid-job. The retry logic will reset it; verify in tests.
- **Do not log job payloads at info level.** They contain user IDs and paper IDs which are PII-adjacent. Use debug level or scrub before logging.

---

## Decisions Recorded for This Task

- **Separate worker process** vs. running worker in same process as API — separation is the standard production pattern, makes operational debugging easier, and enables independent scaling. Adopting it from day 1 means we never have to refactor.
- **Concurrency 4** — picked arbitrarily; tunable later. With MinerU latency dominating (TASK-010), 4 concurrent papers exercises the queue without overwhelming local Redis.
- **3 retries with exponential backoff** — covers transient network blips. v0.2 may differentiate between "transient" (network) and "permanent" (bad PDF) errors and retry only the former.
- **`removeOnComplete` after 24h** — keeps Redis lean while preserving short-term debugging history. v0.1 doesn't need long completion history.
- **Healthcheck queue uses a separate queue name** (`"healthcheck"`) so it doesn't pollute paper-parse stats.

---

## Definition of Done — Quick Checklist

- [ ] `bun run worker:dev` starts and stays alive
- [ ] Uploading a paper enqueues a job (verify via `GET /api/v1/health/queue`)
- [ ] Worker picks up job within 1s
- [ ] Paper row goes `pending` → `parsing` → `done` automatically (~3s total)
- [ ] Frontend library list updates status badge (refresh or polling)
- [ ] Job error path: simulate by adding throw in stub → paper ends up `failed` with error message
- [ ] Job retry: simulate transient throw → succeeds on retry → paper ends up `done`
- [ ] `GET /api/v1/health/queue` returns counts
- [ ] All tests pass
- [ ] Existing tests still pass
- [ ] STATUS.md updated, commit `[TASK-009] BullMQ worker process with paper-parse stub job`

---

## Report Back

After completing:
- Confirm worker stays alive across `bun --hot` reloads (or note if `--hot` is incompatible with BullMQ — workaround: drop `--hot` for worker dev)
- Report timing: enqueue → consumed by worker (should be <100ms locally)
- Note any quirks of BullMQ + Bun (BullMQ is Node-tested; Bun should work but flag if you hit issues)
- Suggest whether v0.2 should move to SSE for status updates (vs current 2s polling)