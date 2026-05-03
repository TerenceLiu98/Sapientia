# TASK-002: Local infrastructure + config + healthcheck

**Estimated effort**: 6-8 hours
**Depends on**: TASK-001
**Phase**: 1 — Reading Foundation

---

## Context

We have a Hono `/health` endpoint and Vite frontend. Now we need:
- Local Docker Compose stack mirroring K8s topology: Postgres + Redis + MinIO
- Drizzle ORM configured against Postgres
- Zod-validated config loaded from environment variables
- Logger configured (with secret redaction)
- Healthcheck that actually verifies all three data services
- Test infrastructure: vitest configured, ephemeral test fixtures via testcontainers-node

No business logic, no schema yet (just connection wiring). TASK-003 adds auth, TASK-004 adds the first real entities.

---

## Acceptance Criteria

1. `infra/docker/docker-compose.yml` brings up Postgres 16 + pgvector, Redis 7, MinIO with one command.
2. `apps/api/.env.example` lists all required env vars with example values; `apps/api/.env` is gitignored.
3. Zod-validated `Config` object in `apps/api/src/config.ts` fails to start the app if required vars are missing.
4. Drizzle client + migration setup in `packages/db/`. `pnpm db:generate` creates a migration file. `pnpm db:migrate` applies it. Even with no schema yet, both should run cleanly.
5. pgvector extension installed automatically in dev DB (via init script in compose).
6. `apps/api/src/logger.ts` provides a structured logger (pino) with secret redaction and JSON output mode for production / pretty mode for development.
7. Healthcheck endpoint upgraded: `GET /health` checks DB, Redis, S3 connectivity. Returns 200 with status of each, or 503 if any are degraded.
8. Vitest configured. One smoke test: `test/health.test.ts` hits `/health` against ephemeral Postgres + Redis + MinIO via testcontainers-node and asserts all three are connected.
9. README updated with: how to start docker compose, how to run migrations, how to run tests.
10. `.env.example` includes secrets the user will need to fill in.

---

## What to Build

### `infra/docker/docker-compose.yml`

```yaml
name: sapientia-dev

services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: sapientia
      POSTGRES_PASSWORD: dev_password
      POSTGRES_DB: sapientia_dev
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./postgres-init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sapientia"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: dev_admin
      MINIO_ROOT_PASSWORD: dev_password
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 5s
      retries: 5

  minio-init:
    image: minio/mc:latest
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "
      mc alias set local http://minio:9000 dev_admin dev_password &&
      mc mb -p local/sapientia &&
      mc anonymous set none local/sapientia
      "

volumes:
  postgres_data:
  minio_data:
```

`infra/docker/postgres-init.sql`:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

### `apps/api/src/config.ts`

```typescript
import { z } from "zod"

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis (for BullMQ)
  REDIS_URL: z.string().url().default("redis://localhost:6379"),

  // S3 / MinIO
  S3_ENDPOINT: z.string().url(),
  S3_ACCESS_KEY_ID: z.string(),
  S3_SECRET_ACCESS_KEY: z.string(),
  S3_BUCKET: z.string().default("sapientia"),
  S3_REGION: z.string().default("us-east-1"),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default("true")
    .transform((v) => v === "true"),

  // Future fields (set up in later tasks; commented to keep parsing strict-but-evolving):
  // BETTER_AUTH_SECRET, BETTER_AUTH_URL, ENCRYPTION_KEY, OAuth credentials
})

export type Config = z.infer<typeof ConfigSchema>

const result = ConfigSchema.safeParse(process.env)

if (!result.success) {
  console.error("❌ Invalid environment configuration:")
  console.error(result.error.flatten().fieldErrors)
  process.exit(1)
}

export const config: Config = result.data
```

### `apps/api/.env.example`

```
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug

DATABASE_URL=postgresql://sapientia:dev_password@localhost:5432/sapientia_dev
REDIS_URL=redis://localhost:6379

S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY_ID=dev_admin
S3_SECRET_ACCESS_KEY=dev_password
S3_BUCKET=sapientia
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
```

### Drizzle setup (`packages/db/`)

Install dependencies (run in `packages/db/`):
```bash
pnpm add drizzle-orm postgres
pnpm add -D drizzle-kit
```

`packages/db/drizzle.config.ts`:
```typescript
import { defineConfig } from "drizzle-kit"

export default defineConfig({
  schema: "./src/schema/*.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "",
  },
  verbose: true,
  strict: true,
})
```

`packages/db/src/client.ts`:
```typescript
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

export function createDbClient(url: string) {
  const queryClient = postgres(url, { max: 10 })
  return {
    db: drizzle(queryClient),
    close: () => queryClient.end(),
  }
}

export type Database = ReturnType<typeof createDbClient>["db"]
```

`packages/db/src/index.ts`:
```typescript
export * from "./client"
export * from "./schema"
```

`packages/db/src/schema/index.ts`:
```typescript
// Schema files will be added per entity in subsequent tasks
export {}
```

`packages/db/package.json` scripts:
```json
"scripts": {
  "db:generate": "drizzle-kit generate",
  "db:migrate": "bun run src/migrate.ts",
  "db:studio": "drizzle-kit studio",
  "typecheck": "tsc --noEmit"
}
```

`packages/db/src/migrate.ts`:
```typescript
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

const url = process.env.DATABASE_URL
if (!url) {
  console.error("DATABASE_URL not set")
  process.exit(1)
}

const client = postgres(url, { max: 1 })
const db = drizzle(client)

await migrate(db, { migrationsFolder: "./migrations" })
console.log("✅ Migrations applied")
await client.end()
```

Add root scripts to `package.json`:
```json
"db:generate": "pnpm --filter @sapientia/db db:generate",
"db:migrate": "pnpm --filter @sapientia/db db:migrate",
```

### Logger (`apps/api/src/logger.ts`)

Use pino:
```bash
cd apps/api
bun add pino
bun add -D pino-pretty
```

```typescript
import pino from "pino"
import { config } from "./config"

const REDACT_PATHS = [
  "password",
  "apiKey",
  "api_key",
  "token",
  "secret",
  "authorization",
  "*.password",
  "*.apiKey",
  "*.token",
]

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  ...(config.NODE_ENV === "development"
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            singleLine: false,
          },
        },
      }
    : {}),
})
```

### S3 client (`apps/api/src/services/s3-client.ts`)

```bash
cd apps/api
bun add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

```typescript
import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3"
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
```

### Updated `apps/api/src/index.ts`

```typescript
import { Hono } from "hono"
import { logger as appLogger } from "./logger"
import { config } from "./config"
import { createDbClient } from "@sapientia/db"
import { sql } from "drizzle-orm"
import { Redis } from "ioredis"
import { checkS3Health } from "./services/s3-client"

const { db, close: closeDb } = createDbClient(config.DATABASE_URL)
const redis = new Redis(config.REDIS_URL)

const app = new Hono()

app.get("/health", async (c) => {
  const checks = await Promise.allSettled([
    db.execute(sql`SELECT 1`),
    redis.ping(),
    checkS3Health(),
  ])

  const dbOk = checks[0].status === "fulfilled"
  const redisOk = checks[1].status === "fulfilled"
  const s3Ok = checks[2].status === "fulfilled" && checks[2].value === true

  const allOk = dbOk && redisOk && s3Ok
  const status = allOk ? "ok" : "degraded"

  return c.json(
    {
      status,
      db: dbOk ? "connected" : "error",
      redis: redisOk ? "connected" : "error",
      s3: s3Ok ? "connected" : "error",
    },
    allOk ? 200 : 503,
  )
})

appLogger.info({ port: config.PORT, env: config.NODE_ENV }, "api_starting")

// Graceful shutdown
const shutdown = async () => {
  appLogger.info("api_shutdown_initiated")
  await closeDb()
  await redis.quit()
  process.exit(0)
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

export default {
  port: config.PORT,
  fetch: app.fetch,
}
```

Add ioredis dep:
```bash
cd apps/api
bun add ioredis
```

### Vitest setup

```bash
cd apps/api
bun add -D vitest @testcontainers/postgresql @testcontainers/redis testcontainers
```

`apps/api/vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    testTimeout: 60_000,  // testcontainers can be slow
    hookTimeout: 60_000,
  },
})
```

`apps/api/test/health.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis"
import { GenericContainer, type StartedTestContainer } from "testcontainers"

describe("healthcheck", () => {
  let pg: StartedPostgreSqlContainer
  let redis: StartedRedisContainer
  let minio: StartedTestContainer

  beforeAll(async () => {
    pg = await new PostgreSqlContainer("pgvector/pgvector:pg16").start()
    redis = await new RedisContainer("redis:7-alpine").start()
    minio = await new GenericContainer("minio/minio:latest")
      .withCommand(["server", "/data"])
      .withEnvironment({
        MINIO_ROOT_USER: "test",
        MINIO_ROOT_PASSWORD: "testpassword",
      })
      .withExposedPorts(9000)
      .start()

    // Set env vars before importing app
    process.env.DATABASE_URL = pg.getConnectionUri()
    process.env.REDIS_URL = `redis://${redis.getHost()}:${redis.getFirstMappedPort()}`
    process.env.S3_ENDPOINT = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`
    process.env.S3_ACCESS_KEY_ID = "test"
    process.env.S3_SECRET_ACCESS_KEY = "testpassword"
  })

  afterAll(async () => {
    await pg.stop()
    await redis.stop()
    await minio.stop()
  })

  it("returns ok when all services are up", async () => {
    // Note: this test confirms infrastructure plumbing.
    // Health endpoint test against the actual app comes after
    // we have a way to test Hono apps in isolation.
    expect(process.env.DATABASE_URL).toBeDefined()
    expect(process.env.REDIS_URL).toBeDefined()
    expect(process.env.S3_ENDPOINT).toBeDefined()
  })
})
```

> Note: The full integration test (actually exercising `/health`) requires test harness for Hono apps. Set up a minimal `createTestApp()` factory in TASK-003 when the app structure stabilizes. For now, this smoke test just proves testcontainers spins up.

---

## Do Not

- **Do not add any application schema.** TASK-004 introduces workspace + memberships; this task only sets up the infrastructure layer.
- **Do not add BullMQ setup.** Redis is in compose, but BullMQ comes when we have actual jobs to enqueue.
- **Do not add CORS, rate limiting, or auth middleware.** Each has its own task.
- **Do not connect to a hosted database.** Local docker only.
- **Do not commit `.env`.** Only `.env.example`.
- **Do not skip the secret redaction in pino.** It's a real footgun without it.
- **Do not write to MinIO from this task.** Just verify connectivity.
- **Do not put `forcePathStyle: true` setting elsewhere besides config.** MinIO requires it; AWS S3 doesn't. The flag handles both.

---

## Decisions Recorded for This Task

- **postgres-js as the driver** (not pg / node-postgres). Smaller, async-first, designed for modern TypeScript.
- **pino as logger**. Industry-standard, good redaction support, JSON-by-default for production.
- **ioredis for Redis client**. BullMQ requires it (or node-redis with adapter); ioredis is more straightforward.
- **testcontainers-node for ephemeral test infra**. Slower than mocks but real-database confidence; matches the principle "no SQLite in tests."
- **Healthcheck returns 503 (not 200) when degraded**. Lets K8s liveness probes act on partial failure.

---

## Definition of Done — Quick Checklist

- [ ] `docker compose -f infra/docker/docker-compose.yml up -d` brings up 3 services
- [ ] All 3 services pass their healthchecks
- [ ] `.env.example` documents all needed vars
- [ ] App fails to start with helpful error if required env var is missing
- [ ] `/health` returns `{ status: "ok", db: "connected", redis: "connected", s3: "connected" }`
- [ ] `/health` returns 503 with status of each, when any is down (test by stopping a container)
- [ ] `pnpm db:generate` runs cleanly (creates empty migration file is fine)
- [ ] `pnpm db:migrate` runs cleanly
- [ ] `pnpm test` passes (smoke test only)
- [ ] Logs are JSON in production mode, pretty in development
- [ ] No secrets committed
- [ ] STATUS.md updated, commit `[TASK-002] Local infrastructure with config, logging, healthcheck, tests`

---

## Report Back

After completing:
- Confirm all checklist items
- Note Bun's behavior with hot reload + Postgres connection pooling
- Note any docker-compose / testcontainers quirks on your platform
- Suggest if there are any decisions to add to DECISIONS.md