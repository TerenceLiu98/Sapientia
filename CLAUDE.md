# CLAUDE.md — Sapientia Project Operations Manual

This file is automatically read by Claude Code at the start of every session. It's the primary onboarding doc for AI agents working on Sapientia. Keep it tight, keep it accurate, keep it updated.

---

## What is Sapientia

Sapientia is a web app that lets researchers read papers deeply while AI assists with restraint. Three core ideas:

1. **Human-centric reading**: humans read; AI helps only when summoned (v0.1) or learned to be helpful (v0.2+).
2. **Block-level addressing**: PDFs are parsed into blocks via MinerU; users cite blocks in notes; wikis cross-reference blocks.
3. **Accumulating knowledge**: notes grow into auto-built wiki pages and a knowledge graph (LLM Wiki paradigm, web-native rebuild).

For full product context, see `PRD_v0.1.md`. For the current implementation phase and active tasks, see `STATUS.md`.

---

## Tech Stack — Locked

These choices are final for v0.1. **Do not propose alternatives unless explicitly asked.** If something seems suboptimal, write it in `NOTES.md` and continue.

### Frontend
- React 19 + TypeScript (strict mode)
- Vite (no Next.js — we don't need SSR)
- Tailwind CSS + shadcn/ui
- Zustand (state) + TanStack Query (server state)
- BlockNote (editor) + PDF.js via react-pdf (PDF rendering)
- sigma.js + graphology (knowledge graph)
- TanStack Table v8 (lists/tables)

### Backend
- Python 3.12
- FastAPI + uvicorn
- SQLAlchemy 2.0 + Alembic (ORM + migrations)
- Dramatiq + Redis (task queue)
- Pydantic v2 (validation)
- httpx (HTTP client)

### Infrastructure
- PostgreSQL 16 (with pgvector extension reserved for v0.2)
- Cloudflare R2 (object storage, S3-compatible)
- Supabase (Auth only, not their Postgres for now)
- Sentry (error tracking from day 1)

### External services (user-provided keys)
- Anthropic API or OpenAI API (LLM)
- MinerU API (PDF parsing)

### Tooling
- pnpm workspaces (monorepo)
- ruff + black (Python lint/format)
- biome (TS/JS lint/format) — yes biome, not eslint+prettier
- pytest (Python tests)
- vitest + Playwright (TS tests)
- GitHub Actions (CI)

---

## Repository Layout

```
sapientia/
├── apps/
│   ├── web/                    # React frontend
│   └── api/                    # FastAPI backend
├── packages/
│   ├── shared-types/           # Generated TypeScript types from OpenAPI
│   └── prompts/                # LLM prompt templates (versioned)
├── infra/
│   ├── docker-compose.yml      # Local dev: postgres + redis
│   └── migrations/             # Alembic migrations (committed)
├── docs/
│   ├── PRD_v0.1.md             # Product requirements (don't edit unless explicit task)
│   ├── ARCHITECTURE.md         # Current implementation architecture
│   ├── DECISIONS.md            # Architecture Decision Records
│   ├── STATUS.md               # Current phase + active tasks
│   ├── NOTES.md                # Deferred improvements / ideas
│   └── tasks/                  # Task cards (TASK-NNN.md)
├── CLAUDE.md                   # This file
├── README.md
├── pnpm-workspace.yaml
└── .gitignore
```

### Where files belong

- **API route handlers**: `apps/api/src/routes/{resource}.py`
- **DB models (SQLAlchemy)**: `apps/api/src/models/{entity}.py`
- **Pydantic schemas**: `apps/api/src/schemas/{entity}.py`
- **Business logic**: `apps/api/src/services/{domain}.py`
- **Background tasks**: `apps/api/src/tasks/{task_name}.py`
- **LLM prompts**: `packages/prompts/{purpose}.md` (with version suffix when changing)
- **React pages**: `apps/web/src/pages/{PageName}.tsx`
- **React components**: `apps/web/src/components/{domain}/{ComponentName}.tsx`
- **Zustand stores**: `apps/web/src/stores/{domain}.ts`
- **API client (generated)**: `apps/web/src/api/generated/`

If you're not sure where something goes, **stop and ask**.

---

## Naming Conventions — Strict

### Identifiers
- All entity IDs: UUIDs (v4), stored as `id` column in DB, exposed as `id` in API
- Foreign keys: `{entity_name}_id` (e.g., `workspace_id`, `paper_id`, `owner_user_id`)
- The user who created/owns a resource: `owner_user_id` (NOT `user_id`, NOT `creator_id`)
- Block IDs (within a paper): `block_id`, format `{8-char content hash}`
- Compound block references: `{paper_id}#{block_id}` (e.g., `7e2f...#a3b21c4d`)

### Database
- Table names: snake_case, plural (e.g., `papers`, `wiki_pages`, `agent_observations`)
- Column names: snake_case
- Timestamps: always `created_at`, `updated_at`, both `timestamptz NOT NULL DEFAULT now()`
- Soft delete: `deleted_at timestamptz NULL` (when applicable)

### API
- Routes: kebab-case in URL (`/wiki-pages`, not `/wikiPages` or `/wiki_pages`)
- Request/response field names: snake_case (matches Python convention; frontend converts)
- Resource paths: nested when natural (`/workspaces/{wid}/notes`), flat when not (`/papers/{id}`)

### Frontend
- React components: PascalCase
- Hooks: camelCase, prefix `use`
- Zustand stores: camelCase, suffix `Store` (e.g., `editorStore`)
- Types/interfaces: PascalCase
- API hooks (TanStack Query): `use{Entity}{Action}` (e.g., `usePaperUpload`, `useWikiPages`)

### Code style
- Python: ruff defaults + black; line length 100
- TS: biome defaults; line length 100
- No abbreviations except universally understood (`id`, `url`, `api`, `db`)

---

## Critical Don'ts

These rules exist because past mistakes (or anticipated ones) made them necessary. Don't violate them without explicit user approval.

1. **Don't change the tech stack.** Even if you find a "better" library, write it to `NOTES.md` instead.
2. **Don't add web search, browser automation, or external API calls** that aren't in the PRD or task card.
3. **Don't write tool calling for the agent.** v0.1 agent is single-turn. Tool calling is v0.2 (see PRD §10).
4. **Don't add workspace-wide context loading to the agent.** v0.1 agent only has Layer 1 (project intent) + Layer 2 (full current paper). See PRD §3.
5. **Don't optimize prematurely.** No caching, no indexes, no async-when-not-needed unless the task card asks for it.
6. **Don't add features not in the current task card.** Even if "obviously useful." Note them in `NOTES.md`.
7. **Don't use SQLite.** Even for tests. Use ephemeral Postgres via testcontainers.
8. **Don't use ORMs other than SQLAlchemy 2.0.** No Tortoise, no SQLModel, no raw asyncpg for queries.
9. **Don't bypass the task queue for slow operations.** MinerU calls, LLM calls, wiki ingestion all go through Dramatiq.
10. **Don't store secrets in code.** All credentials go through environment variables, validated at boot via Pydantic Settings.
11. **Don't write business logic in route handlers.** Routes call services. Services contain logic.
12. **Don't store BlockNote JSON in Postgres directly.** Notes/wiki pages: JSON in R2, metadata + markdown cache in Postgres.
13. **Don't auto-format the user's PDF or modify the binary.** Annotations are an overlay, stored separately.
14. **Don't make assumptions about file structure.** Always `read` before `edit`.
15. **Don't expand the scope of a refactor.** If a task says "rename field X", don't also "improve" adjacent code.

---

## When to Stop and Ask

Halt and ask the user (not assume) when:

- The task card is ambiguous about a behavior
- A new dependency would be added (any new pip/npm package)
- A database schema change is needed (new table, column, type change)
- A new API endpoint is needed beyond what's in the task card
- An existing API contract would change (request/response shape)
- You discover the task is bigger than estimated (>2x scope blowup)
- You'd need to delete or significantly rewrite existing code
- You'd need to disable or skip a test
- An external service (MinerU, LLM provider, R2) behaves unexpectedly

Asking is cheap. Wrong assumptions are expensive.

---

## Working Loop

For every task:

1. **Read the task card carefully.** All of it. Acceptance criteria, "do not" section, decisions.
2. **Read the relevant existing code.** Use `view` on files you'll touch. Don't guess.
3. **Plan briefly in chat.** 3-5 bullet points: what you'll create, what you'll modify, what tests you'll add. Wait for user OK on non-trivial changes.
4. **Implement in small commits.** Each commit one logical change. Commit message format: `[TASK-NNN] Short imperative summary`.
5. **Write tests as you go**, not after. Aim for: every new service function has a test, every new route has an integration test.
6. **Run lint, typecheck, tests** before announcing completion. Fix what you broke.
7. **Update relevant docs.** New API → update OpenAPI annotations. New decision → DECISIONS.md. New deferred work → NOTES.md.
8. **Report.** What you did, what you noticed, what's deferred. Then stop.

---

## Test Strategy

- **Backend unit tests**: services, with mocked DB session and mocked external clients
- **Backend integration tests**: full request → DB → response, against real ephemeral Postgres
- **Frontend unit tests**: pure functions, hooks (with renderHook)
- **Frontend component tests**: critical interactive components (editor, PDF viewer)
- **E2E tests**: only for critical flows (auth, upload, write note, agent query)
- **LLM prompt tests**: fixtures of expected inputs/outputs for the wiki ingestion pipeline; run as a `pytest` suite, allowed to be slow, gated to manual trigger in CI

Coverage target: don't chase a number. Cover the things that, if they break, would let bad data into the system or take a feature offline. The PDF block ID stability, the MinerU result parser, the BlockNote serializer, the wiki ingestion pipeline — these need rigorous tests. UI tweaks don't.

---

## LLM Usage Inside Sapientia

When writing code that calls user LLM APIs:

- All calls go through `apps/api/src/services/llm_client.py`. Don't import `anthropic` or `openai` directly elsewhere.
- The user's API key is loaded per-request from `user_credentials` table (decrypted at use time, never logged).
- Streaming responses use Server-Sent Events (SSE) endpoint conventions.
- Token counting must be exposed in responses (for the Layer 1+2 token budget UI).
- All LLM calls log: prompt template ID, model name, input/output token counts, latency, user_id, workspace_id. **Never log prompt content or response content.** Privacy first.
- Prompt templates live in `packages/prompts/`, loaded by ID. Versioned via filename (`agent_query_v1.md`, `wiki_ingest_step1_v3.md`).

---

## Asking About This File

If you (Claude Code) see something in this file that contradicts a task card, **the task card wins for execution but flag the contradiction to the user**. The user may want to update CLAUDE.md.

If you see something missing — a convention, a rule, a piece of context — that you needed for a task, suggest adding it to CLAUDE.md at the end of the task.

---

## Current Phase

**Phase 1: Reading Foundation (Weeks 1–6)**

Goal: User can sign up, upload a PDF, see it parsed by MinerU, read it in the browser, and highlight/select blocks.

For active tasks see `docs/STATUS.md` and `docs/tasks/`.

---

*Last updated: project inception. Keep this header current as the project evolves.*