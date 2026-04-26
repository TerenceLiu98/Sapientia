# Sapientia

Sapientia is a web app for researchers who want to read papers deeply while AI assists with restraint. Humans read; AI helps only when summoned. PDFs are parsed into addressable blocks, notes cite blocks, and accumulated notes grow into auto-built wiki pages and a knowledge graph.

For full product context see [docs/PRD_v0.1.md](docs/PRD_v0.1.md). For architecture decisions see [docs/DECISIONS.md](docs/DECISIONS.md). For the agent operations manual see [CLAUDE.md](CLAUDE.md).

## Repository layout

```
apps/web/      React 19 + Vite + TypeScript frontend
apps/api/      Hono backend on Bun
packages/
  shared/      Zod schemas, types, prompts shared across the stack
  db/          Drizzle schema and migrations (filled in TASK-002)
infra/
  docker/      docker-compose for local dev (filled in TASK-002)
  k8s/         Kustomize manifests (filled in deployment task)
docs/          PRD, ADRs, deployment runbook, design tokens, task cards
```

## Prerequisites

- Node.js ≥ 20 with [Corepack](https://nodejs.org/api/corepack.html) enabled — `corepack enable && corepack prepare pnpm@latest --activate`
- [Bun](https://bun.sh) ≥ 1.2 — `curl -fsSL https://bun.sh/install | bash`

## Quick start

```bash
pnpm install

# Frontend on http://localhost:5173 — shows "Sapientia"
pnpm dev:web

# Backend on http://localhost:3000 — `curl :3000/health` returns {"status":"ok"}
pnpm dev:api
```

## Common scripts

| Command           | What it does                       |
| ----------------- | ---------------------------------- |
| `pnpm dev:web`    | Vite dev server                    |
| `pnpm dev:api`    | `bun --hot` Hono server            |
| `pnpm typecheck`  | TypeScript across all packages     |
| `pnpm run lint`   | `biome check .` (run via `pnpm run` since pnpm 10 reserves `pnpm lint`) |
| `pnpm format`     | `biome format --write .`           |
| `pnpm build`      | Build all packages                 |
| `pnpm test`       | Run all package test scripts       |

Phase 1 status and active task: [docs/STATUS.md](docs/STATUS.md).
