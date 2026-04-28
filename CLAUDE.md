# CLAUDE.md — Sapientia Project Operations Manual

This file is automatically read by Claude Code at the start of every session. It's the primary onboarding doc for AI agents working on Sapientia. Keep it tight, accurate, updated.

---

## What is Sapientia

Sapientia is a web app that lets researchers read papers deeply while AI assists with restraint. Three core ideas:

1. **Human-centric reading**: humans read; AI helps only when summoned (v0.1) or when learned to be helpful (v0.2+).
2. **Block-level addressing**: PDFs are parsed into blocks via MinerU; users cite blocks in notes; wikis cross-reference blocks.
3. **Accumulating knowledge**: notes grow into auto-built wiki pages and a knowledge graph (LLM Wiki paradigm, web-native rebuild).

For full product context: `docs/PRD_v0.1.md`. For active phase + tasks: `docs/STATUS.md`.

---

## Tech Stack — Locked

These choices are final for v0.1. **Do not propose alternatives unless explicitly asked.** If something seems suboptimal, write it in `docs/NOTES.md` and continue.

### Frontend
- React 19 + TypeScript (strict mode)
- Vite (build tool, no SSR)
- Tailwind CSS v4 (CSS-first config, `@theme` directive)
- shadcn/ui for primitives
- Zustand (client state) + TanStack Query (server state)
- Tiptap (editor, with `novel` for the slash/bubble menu UI) + PDF.js via react-pdf
- sigma.js + graphology (knowledge graph)
- TanStack Table v8

### Backend
- TypeScript (strict mode)
- Hono web framework
- Bun runtime (1.2+)
- Drizzle ORM + Drizzle Kit migrations
- Zod validation (shared with frontend via `packages/shared`)
- BullMQ for task queue (Redis-backed)
- better-auth for authentication
- AWS SDK v3 for S3-compatible object storage (`@aws-sdk/client-s3`)

### Data layer (self-hosted in user's K8s)
- PostgreSQL 16 + pgvector extension
- Redis 7 (BullMQ backend)
- MinIO (S3-compatible object storage)

### External services (user-provided keys)
- MinerU API (PDF parsing) — token from mineru.net
- Anthropic API or OpenAI API (LLM) — user's own key

### Tooling
- pnpm workspaces (monorepo)
- biome (lint + format, replaces eslint+prettier for both frontend and backend)
- vitest (unit + integration tests, frontend and backend)
- Playwright (E2E, frontend critical flows only)
- testcontainers-node (Postgres + Redis + MinIO ephemeral instances for backend tests)
- Docker + Docker Compose (local dev infrastructure)
- Kustomize (K8s manifests, no Helm)

---

## Repository Layout

```
sapientia/
├── apps/
│   ├── web/                    # React frontend (Vite)
│   └── api/                    # Hono backend (Bun)
├── packages/
│   ├── shared/                 # Shared TypeScript types, Zod schemas, utilities
│   └── db/                     # Drizzle schema + migration files (shared between api and worker)
├── infra/
│   ├── docker/
│   │   └── docker-compose.yml  # Local dev: postgres + redis + minio
│   ├── k8s/                    # Kustomize manifests
│   │   ├── base/               # Base resources
│   │   └── overlays/
│   │       ├── dev/
│   │       └── prod/
│   └── scripts/
│       ├── seed-minio.sh
│       └── pg-backup.sh
├── docs/
│   ├── PRD.md
│   ├── DECISIONS.md
│   ├── DESIGN_TOKENS.md
│   ├── DEPLOYMENT.md           # K8s deployment runbook
│   ├── STATUS.md               # Current phase + active tasks
│   ├── NOTES.md                # Deferred improvements / ideas
│   └── tasks/                  # Task cards (TASK-NUM.md)
├── CLAUDE.md                   # This file
├── README.md
├── biome.json                  # Shared linting config
├── package.json                # Root, workspace scripts
└── pnpm-workspace.yaml
```

### Where files belong

**Backend** (`apps/api/src/`):
- Hono route handlers: `routes/{resource}.ts`
- Service layer (business logic): `services/{domain}.ts`
- Worker tasks (BullMQ): `tasks/{task-name}.ts`
- DB access helpers: `db/{queries-by-domain}.ts` (raw Drizzle queries grouped by entity)
- Auth setup: `auth.ts` (single file exporting the `auth` instance)
- Config: `config.ts` (Zod-validated env)
- Logger: `logger.ts`
- Entry point: `index.ts` (HTTP server)
- Worker entry: `worker.ts` (BullMQ worker process)

**Schemas** (`packages/db/src/`):
- `schema/{entity}.ts` — Drizzle table definitions, one entity per file
- `schema/index.ts` — Re-exports all
- `migrations/` — Generated SQL files (committed)

**Shared** (`packages/shared/src/`):
- `types/{domain}.ts` — Domain types
- `schemas/{domain}.ts` — Zod schemas (used by frontend forms + backend validation)
- `constants.ts` — Shared constants

**Frontend** (`apps/web/src/`):
- Pages: `pages/{PageName}.tsx`
- Components: `components/{domain}/{ComponentName}.tsx`
- Stores (Zustand): `stores/{domain}.ts`
- API hooks (TanStack Query): `api/hooks/{entity}.ts`
- API client core: `api/client.ts`
- Auth client: `lib/auth-client.ts` (better-auth React client)

**LLM prompts** (`packages/shared/src/prompts/`):
- One prompt per file, versioned via filename: `agent-query-v1.md`, `wiki-ingest-step1-v3.md`
- Loaded by ID at runtime

If unsure where something goes, **stop and ask**.

---

## Naming Conventions — Strict

### Identifiers
- All entity IDs: UUIDs (v4), stored as `id` column in DB, exposed as `id` in API
- Foreign keys: `{entityName}Id` in TypeScript / `{entity_name}_id` in DB. Drizzle handles the mapping; we use snake_case in DB, camelCase in TS code.
- The user who created/owns a resource: `ownerUserId` (NOT `userId`, NOT `creatorId`)
- Block IDs (within a paper): `blockId`, format `{8-char content hash}`
- Compound block references: `{paperId}#{blockId}` (e.g., `7e2f...#a3b21c4d`)

### Database (Postgres)
- Table names: snake_case, plural (e.g., `papers`, `wiki_pages`, `agent_observations`)
- Column names: snake_case
- Timestamps: always `created_at`, `updated_at`, both `timestamp with time zone NOT NULL`
- Soft delete: `deleted_at` nullable timestamp (when applicable)

### TypeScript code
- Variables, functions, methods: camelCase
- Types, interfaces, classes, components: PascalCase
- Constants: UPPER_SNAKE_CASE only for true compile-time constants; otherwise camelCase
- Files: kebab-case for non-component files, PascalCase for React component files
- Test files: `{filename}.test.ts` colocated with source

### API (HTTP)
- Routes: kebab-case in URLs (`/wiki-pages`, `/papers/{id}/pdf-url`)
- Request/response field names: **camelCase** in JSON (TypeScript-native; we don't translate to snake_case at the boundary)
- Resource paths: nested when natural, flat when not
- All API routes prefixed with `/api/v1`
- Auth routes prefixed with `/api/auth` (better-auth's default)

### Important: DB column names are snake_case, but JSON / TypeScript everywhere else is camelCase. Drizzle handles this translation in the schema definitions.

### Code style
- TS: biome defaults; line length 100; tabs (Biome default in 2026)
- Imports: absolute imports via path aliases (`@/...` for app-internal, `@sapientia/shared/...` for shared package)

---

## Critical Don'ts

These rules exist because past mistakes (or anticipated ones) made them necessary.

1. **Don't change the tech stack.** Even if you find a "better" library, write it to `docs/NOTES.md` instead. (Exception, sanctioned: the editor was migrated from BlockNote → Tiptap/Novel in late 2026; see `docs/DECISIONS.md`. Future swaps still need explicit user sign-off, not a unilateral call.)
2. **Don't add web search, browser automation, or external API calls** that aren't in the PRD or task card.
3. **Don't write tool calling for the agent.** v0.1 agent is single-turn. Tool calling is v0.2 (PRD §10).
4. **Don't add workspace-wide context loading to the agent.** v0.1 agent only has Layer 1 + Layer 2. See PRD §3.
5. **Don't optimize prematurely.** No caching, no indexes, no clever async patterns unless the task card asks.
6. **Don't add features not in the current task card.** Note them in `docs/NOTES.md`.
7. **Don't use SQLite, even for tests.** Use ephemeral Postgres via testcontainers-node.
8. **Don't use Prisma, TypeORM, MikroORM, or any ORM other than Drizzle.**
9. **Don't bypass BullMQ for slow operations.** MinerU calls, LLM calls, wiki ingestion all go through the worker.
10. **Don't store secrets in code.** Environment variables only, validated at boot via Zod.
11. **Don't write business logic in route handlers.** Routes parse + validate + delegate to services. Services own logic.
12. **Don't store editor JSON in Postgres directly.** Notes/wiki pages: JSON in MinIO, metadata + markdown cache in Postgres. (The DB column is named `blocknote_json` for legacy reasons; treat the contents as opaque Tiptap JSON.)
13. **Don't auto-format the user's PDF or modify the binary.** Annotations are an overlay, stored separately.
14. **Don't make assumptions about file structure.** Always `view` before `str_replace`.
15. **Don't expand the scope of a refactor.**
16. **Don't roll your own crypto or auth.** All auth flows go through better-auth.
17. **Don't import `node:` modules in code that runs in workers without checking Bun compatibility.** Most things work, but some Node APIs aren't yet supported.
18. **Don't use `any` in TypeScript.** Use `unknown` and narrow, or define proper types.
19. **Don't disable strict mode in tsconfig.** Ever.
20. **Don't add npm packages without checking the size.** Run `pnpm dlx package-size <pkg>` first for non-trivial deps.

---

## When to Stop and Ask

Halt and ask when:

- The task card is ambiguous about a behavior
- A new dependency would be added (any new pnpm package)
- A database schema change is needed (new table, column, type change)
- A new API endpoint is needed beyond what's in the task card
- An existing API contract would change (request/response shape)
- The task is bigger than estimated (>2x scope blowup)
- You'd need to delete or significantly rewrite existing code
- You'd need to disable or skip a test
- An external service (MinerU, LLM provider, MinIO) behaves unexpectedly
- A K8s manifest change has unclear failure mode
- Something requires `kubectl` against the user's cluster — always ask before touching their cluster

Asking is cheap. Wrong assumptions are expensive.

---

## Working Loop

For every task:

1. **Read the task card carefully.** All of it. Acceptance criteria, "do not" section, decisions.
2. **Read the relevant existing code.** Use `view` on files you'll touch.
3. **Plan briefly in chat.** 3-5 bullets. Wait for user OK on non-trivial changes.
4. **Implement in small commits.** Each commit one logical change. Format: `[TASK-NNN] Short imperative summary`.
5. **Write tests as you go.** Every new service function gets a test, every new route gets an integration test.
6. **Run typecheck, lint, tests** before announcing completion.
7. **Update relevant docs.** New API → update OpenAPI annotations. New decision → DECISIONS.md. New deferred work → NOTES.md.
8. **Report.** What you did, what you noticed, what's deferred. Then stop.

---

## Test Strategy

- **Backend unit tests**: services, with mocked DB (in-memory test double) and mocked external clients. Use vitest.
- **Backend integration tests**: full request → DB → response, against real ephemeral Postgres + Redis + MinIO via testcontainers-node.
- **Frontend unit tests**: pure functions, hooks (with renderHook from @testing-library/react). vitest.
- **Frontend component tests**: critical interactive components (editor, PDF viewer, agent panel). vitest + @testing-library/react.
- **E2E tests**: only for critical flows (auth, upload, write note, agent query). Playwright.
- **LLM prompt tests**: fixture inputs/outputs, gated to manual trigger in CI.

Coverage target: don't chase a number. Cover what would corrupt data or take a feature offline if it broke. PDF block ID stability, MinerU result parser, BlockNote serializer, wiki ingestion pipeline — these need rigor. UI tweaks don't.

---

## LLM Usage Inside Sapientia

When writing code that calls user LLM APIs:

- All calls go through `apps/api/src/services/llm-client.ts`. Don't import `@anthropic-ai/sdk` or `openai` directly elsewhere.
- The user's API key is loaded per-request from the `user_credentials` table (decrypted at use time, **never logged**).
- Streaming uses Server-Sent Events (SSE) endpoints; Hono has built-in SSE helpers.
- Token counting must be exposed in responses (Layer 1+2 token budget UI).
- All LLM calls log: prompt template ID, model name, input/output token counts, latency, userId, workspaceId. **Never log prompt content or response content.** Privacy first.
- Prompt templates live in `packages/shared/src/prompts/`, loaded by ID. Versioned via filename.

---

## Database Migration Discipline

- All schema changes go through Drizzle Kit: `pnpm db:generate` to create migration, `pnpm db:migrate` to apply.
- Migrations are checked into git in `packages/db/migrations/`.
- **Never edit a committed migration.** If a change is needed, generate a new migration.
- For destructive changes (drop column, rename table): create explicit, named migration files describing the intent. Never let `drizzle-kit push` make destructive changes silently.
- Test migrations both forward and backward where possible.

---

## K8s & Deployment

The user's K8s cluster has these prerequisites already installed:
- nginx-ingress controller
- cert-manager (auto TLS via Let's Encrypt)
- JuiceFS storage class

You may assume these are present and reference them in manifests. Don't write installation instructions for them.

What we add to their cluster:
- `local-path-provisioner` (if not present) — for Postgres/Redis PVCs that need real fsync
- Our own namespace: `sapientia` (or `sapientia-dev` for dev overlay)
- All app + data tier resources within that namespace

For deployment runbook details: `docs/DEPLOYMENT.md`.

When working on K8s manifests:
- Always work in `infra/k8s/base/` or `infra/k8s/overlays/{env}/`. Never write raw `kubectl apply` output anywhere else.
- Use Kustomize. No Helm.
- Image references use full digests for production overlay, tags acceptable in dev overlay.
- Never commit secrets to manifests. Use `kubectl create secret` workflow documented in DEPLOYMENT.md.

---

## Asking About This File

If you (Claude Code) see something in this file that contradicts a task card, **the task card wins for execution but flag the contradiction to the user**.

If you see something missing — a convention, a rule, a piece of context — that you needed for a task, suggest adding it to CLAUDE.md at the end of the task.

---

## Visual Design

All visual decisions trace to `docs/DESIGN_TOKENS.md`. Never hardcode colors, font sizes, spacing, or shadows in components — always reference Tailwind utilities mapped from tokens. If a value isn't in the tokens file, propose adding it.

---

## Current Phase

**Phase 1: Reading Foundation (Weeks 1–6)**

Goal: User can sign up, upload a PDF, see it parsed by MinerU, read it in the browser, highlight/select blocks.

For active tasks see `docs/STATUS.md` and `docs/tasks/`.

---

*Last updated: project inception. Keep this header current.*