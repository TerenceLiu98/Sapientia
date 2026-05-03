# TASK-003: better-auth integration + protected route

**Estimated effort**: 8-10 hours
**Depends on**: TASK-002
**Phase**: 1 — Reading Foundation

---

## Context

better-auth runs in our Hono backend. It provides email/password + OAuth (Google + GitHub) and stores sessions server-side in Postgres. The frontend uses better-auth's React client which handles cookies automatically.

This task adds: better-auth setup, mounted routes, social provider config, a protected `/api/v1/me` endpoint, and tests covering auth flows.

---

## Acceptance Criteria

1. better-auth installed in `apps/api`. Configured with Drizzle adapter, email+password, Google OAuth, GitHub OAuth.
2. better-auth's required tables (`user`, `session`, `account`, `verification`) generated as Drizzle schema in `packages/db/src/schema/auth.ts`. Migration committed.
3. `apps/api/src/auth.ts` exports the configured `auth` instance.
4. better-auth handler mounted at `/api/auth/*` in Hono.
5. `requireAuth` middleware created. Routes that need authentication use it.
6. `GET /api/v1/me` returns the current user's data. Returns 401 if no session.
7. New env vars added to `.env.example` and Zod config:
   - `BETTER_AUTH_SECRET` (required, min 32 chars)
   - `BETTER_AUTH_URL` (required, base URL)
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (optional but if one is set, both required)
   - `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` (same conditional)
8. Tests cover: signup, signin, session retrieval, signout, protected route 401 without session, protected route 200 with session, OAuth provider configuration validation.
9. README documents how to set up Google + GitHub OAuth apps for local development.

---

## What to Build

### Install better-auth

```bash
cd apps/api
bun add better-auth
```

### Generate auth schema

better-auth provides a CLI to generate the schema. Run from `apps/api/`:

```bash
bunx @better-auth/cli generate \
  --config src/auth.ts \
  --output ../../packages/db/src/schema/auth.ts
```

Note: you might need to write `auth.ts` first (next step) before this works. The CLI reads the auth config to know what tables to generate.

The output should be Drizzle table definitions for: `user`, `session`, `account`, `verification`.

After generation, verify the schema looks reasonable, then add to schema barrel:

`packages/db/src/schema/index.ts`:
```typescript
export * from "./auth"
// Future entity exports go here
```

Generate and commit migration:
```bash
pnpm db:generate
# Review the generated SQL in packages/db/migrations/
pnpm db:migrate
```

### `apps/api/src/auth.ts`

```typescript
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { createDbClient } from "@sapientia/db"
import { config } from "./config"

const { db } = createDbClient(config.DATABASE_URL)

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  secret: config.BETTER_AUTH_SECRET,
  baseURL: config.BETTER_AUTH_URL,
  trustedOrigins: [config.BETTER_AUTH_URL],

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,  // v0.1; turn on in v0.2
  },

  socialProviders: {
    ...(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: config.GOOGLE_CLIENT_ID,
            clientSecret: config.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
    ...(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: config.GITHUB_CLIENT_ID,
            clientSecret: config.GITHUB_CLIENT_SECRET,
          },
        }
      : {}),
  },

  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,  // 5 min cache to reduce DB hits
    },
  },
})

export type Session = typeof auth.$Infer.Session.session
export type User = typeof auth.$Infer.Session.user
```

### Update config

`apps/api/src/config.ts` — add to ConfigSchema:

```typescript
BETTER_AUTH_SECRET: z.string().min(32),
BETTER_AUTH_URL: z.string().url(),

GOOGLE_CLIENT_ID: z.string().optional(),
GOOGLE_CLIENT_SECRET: z.string().optional(),
GITHUB_CLIENT_ID: z.string().optional(),
GITHUB_CLIENT_SECRET: z.string().optional(),
```

Add a refinement check (after the schema definition):

```typescript
.refine(
  (data) =>
    (!data.GOOGLE_CLIENT_ID && !data.GOOGLE_CLIENT_SECRET) ||
    (data.GOOGLE_CLIENT_ID && data.GOOGLE_CLIENT_SECRET),
  { message: "Both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together" },
)
.refine(
  (data) =>
    (!data.GITHUB_CLIENT_ID && !data.GITHUB_CLIENT_SECRET) ||
    (data.GITHUB_CLIENT_ID && data.GITHUB_CLIENT_SECRET),
  { message: "Both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set together" },
)
```

### Update `.env.example`

```
# Auth
BETTER_AUTH_SECRET=  # generate with: openssl rand -base64 32
BETTER_AUTH_URL=http://localhost:3000

# Optional OAuth (skip if not testing OAuth flows)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

### Mount auth routes in Hono

Update `apps/api/src/index.ts`:

```typescript
import { Hono } from "hono"
import { auth } from "./auth"
// ... existing imports

const app = new Hono()

// Mount better-auth handler at /api/auth/*
app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw))

// Healthcheck
app.get("/health", async (c) => {
  // ... existing
})

// API routes
import { meRoutes } from "./routes/me"
app.route("/api/v1", meRoutes)

// ... rest
```

### Auth middleware (`apps/api/src/middleware/auth.ts`)

```typescript
import { createMiddleware } from "hono/factory"
import { auth, type User, type Session } from "../auth"

export type AuthContext = {
  Variables: {
    user: User
    session: Session
  }
}

export const requireAuth = createMiddleware<AuthContext>(async (c, next) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  })

  if (!session) {
    return c.json({ error: "unauthorized" }, 401)
  }

  c.set("user", session.user)
  c.set("session", session.session)
  await next()
})
```

### `apps/api/src/routes/me.ts`

```typescript
import { Hono } from "hono"
import { requireAuth, type AuthContext } from "../middleware/auth"

export const meRoutes = new Hono<AuthContext>()

meRoutes.get("/me", requireAuth, (c) => {
  const user = c.get("user")
  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
  })
})
```

### Tests

`apps/api/test/auth.test.ts`:

This test exercises the actual auth flow against a real Postgres. Use a test harness that spins up Postgres + an in-process app.

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"

describe("better-auth integration", () => {
  let pg: StartedPostgreSqlContainer
  let baseUrl: string
  let server: ReturnType<typeof Bun.serve>

  beforeAll(async () => {
    pg = await new PostgreSqlContainer("pgvector/pgvector:pg16").start()
    process.env.DATABASE_URL = pg.getConnectionUri()
    process.env.BETTER_AUTH_SECRET = "test_secret_32_chars_minimum_aaaa"
    process.env.BETTER_AUTH_URL = "http://localhost:0"

    // Run migrations
    const { migrate } = await import("drizzle-orm/postgres-js/migrator")
    const { drizzle } = await import("drizzle-orm/postgres-js")
    const postgres = (await import("postgres")).default
    const client = postgres(pg.getConnectionUri(), { max: 1 })
    await migrate(drizzle(client), { migrationsFolder: "../../packages/db/migrations" })
    await client.end()

    // Start server (dynamic port)
    const { default: app } = await import("../src/index")
    server = Bun.serve({ ...app, port: 0 })
    baseUrl = `http://localhost:${server.port}`
  })

  afterAll(async () => {
    server.stop()
    await pg.stop()
  })

  it("rejects /api/v1/me without session", async () => {
    const res = await fetch(`${baseUrl}/api/v1/me`)
    expect(res.status).toBe(401)
  })

  it("signs up via email+password", async () => {
    const res = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "test@example.com",
        password: "test_password_123",
        name: "Test User",
      }),
    })
    expect(res.status).toBe(200)
  })

  it("signs in and accesses /me", async () => {
    // Sign up first
    await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "user2@example.com",
        password: "test_password_123",
        name: "User Two",
      }),
    })

    // Sign in (capture cookies)
    const signInRes = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "user2@example.com",
        password: "test_password_123",
      }),
    })
    expect(signInRes.status).toBe(200)
    const cookies = signInRes.headers.getSetCookie?.() || []
    expect(cookies.length).toBeGreaterThan(0)

    // Use cookies to call /me
    const meRes = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { cookie: cookies.join("; ") },
    })
    expect(meRes.status).toBe(200)
    const me = await meRes.json()
    expect(me.email).toBe("user2@example.com")
  })

  it("signs out and loses session", async () => {
    // Setup: sign up + sign in
    await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "user3@example.com",
        password: "test_password_123",
        name: "User Three",
      }),
    })
    const signInRes = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "user3@example.com",
        password: "test_password_123",
      }),
    })
    const cookies = signInRes.headers.getSetCookie?.() || []

    // Sign out
    const signOutRes = await fetch(`${baseUrl}/api/auth/sign-out`, {
      method: "POST",
      headers: { cookie: cookies.join("; ") },
    })
    expect(signOutRes.status).toBe(200)

    // /me with old cookies → 401 (session was invalidated)
    const meRes = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { cookie: cookies.join("; ") },
    })
    expect(meRes.status).toBe(401)
  })
})
```

### README addition

Add a section "Setting up OAuth for local development":

For Google:
1. Go to https://console.cloud.google.com/
2. Create a new project (or use existing)
3. Enable "Google+ API"
4. Create OAuth 2.0 credentials → Web application
5. Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
6. Copy Client ID + Secret to `.env`

For GitHub:
1. Go to https://github.com/settings/developers → New OAuth App
2. Authorization callback URL: `http://localhost:3000/api/auth/callback/github`
3. Copy Client ID + Secret to `.env`

OAuth is optional for v0.1 development. Email/password works without these set.

---

## Do Not

- **Do not implement signup/signin/password endpoints in our own code.** better-auth owns all auth logic. Our code only consumes sessions.
- **Do not store passwords or hashes anywhere yourself.** better-auth handles it (argon2 by default).
- **Do not call better-auth's admin or internal APIs.** Use the public API surface only.
- **Do not auto-create a personal workspace yet.** That's TASK-004's job.
- **Do not log session tokens or cookies.** Pino redaction should cover this; verify with a manual log inspection.
- **Do not enable email verification yet.** v0.2 turns it on once we have email sending set up.
- **Do not enable rate limiting yet.** Better-auth has a built-in rate limiter; defaults are fine for v0.1, no custom config needed.
- **Do not write CORS middleware in this task.** Per ADR-016, single-domain deployment doesn't need CORS in production. For local dev, Vite proxy handles it (set up in TASK-006).
- **Do not generate JWTs or implement statelessness.** better-auth uses server-side sessions in Postgres. This is intentional — needed for proper revocation, multi-device awareness, and audit.

---

## Decisions Recorded for This Task

- **Server-side sessions, cookie-based auth** — chosen by better-auth's design and reinforced by ADR-016 single-domain routing.
- **Email verification disabled in v0.1** — sending email requires SMTP/Resend setup, deferred.
- **OAuth providers conditional** — if env vars unset, those provider configs are simply omitted. Allows email-only deploys without errors.
- **Cookie cache enabled** (5min) — reduces DB query for every request to validate session. better-auth handles invalidation correctly.

---

## Definition of Done — Quick Checklist

- [ ] Auth schema generated and migrated
- [ ] `auth.ts` configured with email+password + optional OAuth
- [ ] better-auth handler mounted at `/api/auth/*`
- [ ] `requireAuth` middleware works
- [ ] `/api/v1/me` returns 401 / 200 correctly
- [ ] All 4 auth flow tests pass
- [ ] README has OAuth setup instructions
- [ ] Existing tests (TASK-002) still pass
- [ ] STATUS.md updated, commit `[TASK-003] better-auth integration with /me endpoint`

---

## Report Back

After completing:
- Confirm OAuth callback URLs work for both Google and GitHub (or note that you only tested email+password)
- Note better-auth version installed
- Suggest whether the auth schema generation was smooth or needed manual fixup
- Flag any quirks of better-auth + Drizzle adapter version compatibility