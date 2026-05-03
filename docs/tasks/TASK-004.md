# TASK-004: Workspace + memberships data model + first migrations

**Estimated effort**: 4-6 hours
**Depends on**: TASK-002, TASK-003
**Phase**: 1 — Reading Foundation

---

## Context

ADR-010 commits us to the workspace abstraction from day 1. v0.1 only uses personal workspaces (one member, role=owner), but the schema and API patterns must support the v0.2 shared-workspace future.

This task creates:
- `workspaces` table (Drizzle schema)
- `memberships` table
- Auto-creation of a personal workspace when a new user signs up (using better-auth's `databaseHooks`)
- A `GET /api/v1/workspaces` endpoint listing user's workspaces
- A permission helper for membership-based access checks

After this, future resources (papers, notes, wikis) can be scoped to workspaces.

---

## Acceptance Criteria

1. New Drizzle schemas: `workspaces` and `memberships` in `packages/db/src/schema/`.
2. Migration generated and applied via Drizzle Kit. Migration is committed.
3. `apps/api/src/services/workspace.ts` exports:
   - `ensurePersonalWorkspace(userId, db)`: creates a personal workspace for a user if not yet existing, returns it. Idempotent.
   - `listWorkspacesForUser(userId, db)`: returns workspaces + role tuples.
4. better-auth `databaseHooks.user.create.after` calls `ensurePersonalWorkspace` so every new user immediately has a workspace.
5. `GET /api/v1/workspaces` returns user's workspaces with their role.
6. `apps/api/src/middleware/workspace.ts` provides `requireMembership(workspaceId, minRole)` middleware that errors with 403 if user is not a member or role is below threshold.
7. Tests cover: new user gets personal workspace, signing up twice doesn't create duplicate, list endpoint returns correct data with roles, permission middleware accepts owner, rejects non-member, enforces minRole.

---

## Schema

### `packages/db/src/schema/workspaces.ts`

```typescript
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core"
import { user } from "./auth"
import { relations } from "drizzle-orm"

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: text("type", { enum: ["personal", "shared"] }).notNull(),
  ownerUserId: text("owner_user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  memberships: many(memberships),
}))

export const memberships = pgTable(
  "memberships",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "editor", "reader"] }).notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    {
      pk: { name: "memberships_pkey", columns: [table.workspaceId, table.userId] },
    },
  ],
)

export const membershipsRelations = relations(memberships, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [memberships.workspaceId],
    references: [workspaces.id],
  }),
  user: one(user, {
    fields: [memberships.userId],
    references: [user.id],
  }),
}))

export type Workspace = typeof workspaces.$inferSelect
export type NewWorkspace = typeof workspaces.$inferInsert
export type Membership = typeof memberships.$inferSelect
export type Role = "owner" | "editor" | "reader"
```

> Note: `user.id` is `text` because better-auth uses text/string IDs by default. Verify this in the generated auth schema; if better-auth uses uuid, change accordingly.

Update `packages/db/src/schema/index.ts`:
```typescript
export * from "./auth"
export * from "./workspaces"
```

Generate + commit migration:
```bash
pnpm db:generate
# Review generated SQL — should create both tables with correct constraints
pnpm db:migrate
```

---

## Service layer

### `apps/api/src/services/workspace.ts`

```typescript
import { eq, and } from "drizzle-orm"
import type { Database } from "@sapientia/db"
import { workspaces, memberships, type Workspace, type Role } from "@sapientia/db"

export async function ensurePersonalWorkspace(
  userId: string,
  db: Database,
): Promise<Workspace> {
  // Look for existing personal workspace
  const existing = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.ownerUserId, userId), eq(workspaces.type, "personal")))
    .limit(1)

  if (existing.length > 0) return existing[0]

  // Create
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: "My Research",
      type: "personal",
      ownerUserId: userId,
    })
    .returning()

  await db.insert(memberships).values({
    workspaceId: workspace.id,
    userId,
    role: "owner",
  })

  return workspace
}

export async function listWorkspacesForUser(
  userId: string,
  db: Database,
): Promise<Array<{ workspace: Workspace; role: Role }>> {
  const rows = await db
    .select({
      workspace: workspaces,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, userId))
    .orderBy(workspaces.createdAt)

  return rows.map((r) => ({ workspace: r.workspace, role: r.role as Role }))
}
```

---

## Auto-create personal workspace on signup

Update `apps/api/src/auth.ts` to use better-auth's `databaseHooks`:

```typescript
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { createDbClient } from "@sapientia/db"
import { config } from "./config"
import { ensurePersonalWorkspace } from "./services/workspace"
import { logger } from "./logger"

const { db } = createDbClient(config.DATABASE_URL)

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  secret: config.BETTER_AUTH_SECRET,
  baseURL: config.BETTER_AUTH_URL,
  trustedOrigins: [config.BETTER_AUTH_URL],

  emailAndPassword: { enabled: true, requireEmailVerification: false },
  socialProviders: { /* ...as before... */ },

  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          try {
            await ensurePersonalWorkspace(user.id, db)
            logger.info({ userId: user.id }, "personal_workspace_created")
          } catch (err) {
            logger.error({ userId: user.id, err }, "personal_workspace_creation_failed")
            // Don't throw — better-auth already created the user.
            // We'll lazily create on first /workspaces request as fallback.
          }
        },
      },
    },
  },

  session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
})

export type Session = typeof auth.$Infer.Session.session
export type User = typeof auth.$Infer.Session.user
```

---

## Permission middleware

### `apps/api/src/middleware/workspace.ts`

```typescript
import { createMiddleware } from "hono/factory"
import { eq, and } from "drizzle-orm"
import { createDbClient, memberships } from "@sapientia/db"
import { config } from "../config"
import type { AuthContext } from "./auth"
import type { Role } from "@sapientia/db"

const ROLE_RANK: Record<Role, number> = { reader: 1, editor: 2, owner: 3 }

const { db } = createDbClient(config.DATABASE_URL)

export type WorkspaceContext = AuthContext & {
  Variables: AuthContext["Variables"] & {
    membershipRole: Role
  }
}

export function requireMembership(minRole: Role = "reader") {
  return createMiddleware<WorkspaceContext>(async (c, next) => {
    const workspaceId = c.req.param("workspaceId") ?? c.req.param("wid")
    if (!workspaceId) {
      return c.json({ error: "workspaceId param required" }, 400)
    }

    const user = c.get("user")
    const result = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, user.id)))
      .limit(1)

    if (result.length === 0) {
      return c.json({ error: "not a member of this workspace" }, 403)
    }

    const membership = result[0]
    const role = membership.role as Role

    if (ROLE_RANK[role] < ROLE_RANK[minRole]) {
      return c.json(
        { error: `insufficient role: need ${minRole}, have ${role}` },
        403,
      )
    }

    c.set("membershipRole", role)
    await next()
  })
}
```

---

## Routes

### `apps/api/src/routes/workspaces.ts`

```typescript
import { Hono } from "hono"
import { requireAuth, type AuthContext } from "../middleware/auth"
import { listWorkspacesForUser } from "../services/workspace"
import { createDbClient } from "@sapientia/db"
import { config } from "../config"

const { db } = createDbClient(config.DATABASE_URL)

export const workspaceRoutes = new Hono<AuthContext>()

workspaceRoutes.get("/workspaces", requireAuth, async (c) => {
  const user = c.get("user")
  const items = await listWorkspacesForUser(user.id, db)
  return c.json(
    items.map(({ workspace, role }) => ({
      id: workspace.id,
      name: workspace.name,
      type: workspace.type,
      role,
      createdAt: workspace.createdAt,
    })),
  )
})
```

Wire up in `index.ts`:
```typescript
import { workspaceRoutes } from "./routes/workspaces"
app.route("/api/v1", workspaceRoutes)
```

---

## Tests

`apps/api/test/workspaces.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest"
// ... setup similar to auth.test.ts

describe("workspaces", () => {
  // ... beforeAll: spin up Postgres, run migrations, start server

  it("new user automatically gets personal workspace", async () => {
    // Sign up
    await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "newuser@example.com",
        password: "test_password_123",
        name: "New User",
      }),
    })

    // Sign in to get cookies
    const signInRes = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "newuser@example.com", password: "test_password_123" }),
    })
    const cookies = signInRes.headers.getSetCookie?.() || []

    // List workspaces
    const wsRes = await fetch(`${baseUrl}/api/v1/workspaces`, {
      headers: { cookie: cookies.join("; ") },
    })
    expect(wsRes.status).toBe(200)
    const list = await wsRes.json()
    expect(list).toHaveLength(1)
    expect(list[0].type).toBe("personal")
    expect(list[0].role).toBe("owner")
    expect(list[0].name).toBe("My Research")
  })

  // Add tests for:
  // - Idempotent personal workspace creation
  // - List endpoint returns role
  // - requireMembership middleware (test by hitting a route that uses it; you can add a temporary test route)
  // - Cross-user access denied
  // - minRole enforcement
})
```

---

## Do Not

- **Do not add a workspace creation endpoint** (`POST /workspaces`). v0.1 personal workspaces are auto-created. v0.2 adds shared workspace creation.
- **Do not implement invitations or member management.** v0.2.
- **Do not add FK from workspaces to papers/notes yet.** Each entity has its own task.
- **Do not allow workspace deletion via API.** v0.1 has no flow.
- **Do not embed workspace ID in users table.** Always go through memberships.
- **Do not allow more than one personal workspace per user.** `ensurePersonalWorkspace` checks.
- **Do not name personal workspace using user's email.** "My Research" is the default.
- **Do not skip the lazy-create fallback.** If `databaseHooks.user.create.after` fails for any reason, the user shouldn't be locked out — make sure `listWorkspacesForUser` triggers `ensurePersonalWorkspace` if the user has zero workspaces. This is defensive but cheap.

Update `listWorkspacesForUser` to include the fallback:

```typescript
export async function listWorkspacesForUser(userId: string, db: Database) {
  const rows = await db.select(/*...*/).from(/*...*/)/* ... */

  if (rows.length === 0) {
    // Fallback: ensure personal workspace exists
    await ensurePersonalWorkspace(userId, db)
    return listWorkspacesForUser(userId, db)  // recursion is bounded — second call will return at least 1
  }

  return rows.map(/*...*/)
}
```

---

## Decisions Recorded for This Task

- **Default personal workspace name**: `"My Research"`. Renaming will be supported in a future task.
- **Role rank** is hardcoded as a TS object, not a DB enum. Simple, fast, easy to extend.
- **Permission check is per-route middleware**, not global. This makes auditing easier — each protected route declares its required role explicitly.
- **`databaseHooks` for personal workspace creation**, with **lazy fallback** in `listWorkspacesForUser`. Hook is the happy path; fallback covers race conditions or hook failures.

---

## Definition of Done — Quick Checklist

- [ ] Migration creates both tables with correct constraints (CHECK on type/role, FKs, composite PK)
- [ ] Drizzle schema files compile (`pnpm typecheck` passes)
- [ ] `ensurePersonalWorkspace` is idempotent
- [ ] New users automatically get a personal workspace via better-auth hook
- [ ] `GET /api/v1/workspaces` returns the list with roles
- [ ] `requireMembership` correctly enforces membership and minRole
- [ ] All workspace tests pass
- [ ] Existing tests (TASK-002, TASK-003) still pass
- [ ] STATUS.md updated, commit `[TASK-004] Workspace + memberships data model with auto-personal workspace`

---

## Report Back

After completing:
- Confirm whether better-auth's `databaseHooks` API is stable in your version
- Whether the generated migration matches expectations (no schema drift)
- Cascade behavior verified (delete user → delete workspace → delete membership)
- Suggest patterns to extract into a shared utility if any duplication appeared