# Sapientia

Sapientia is a web app for researchers who want to read papers deeply while AI assists with restraint. Humans read; AI helps only when summoned. PDFs are parsed into addressable blocks, notes cite blocks, and accumulated notes grow into auto-built wiki pages and a knowledge graph.

For full product context see [docs/PRD_v0.1.md](docs/PRD_v0.1.md). For architecture decisions see [docs/DECISIONS.md](docs/DECISIONS.md). For the agent operations manual see [CLAUDE.md](CLAUDE.md).

## Repository layout

```
apps/web/      React 19 + Vite + TypeScript frontend
apps/api/      Hono backend on Bun (config, logger, S3 client, /health)
packages/
  shared/      Zod schemas, types, prompts shared across the stack
  db/          Drizzle schema, client, and migrations
infra/
  docker/      docker-compose for local dev (Postgres + Redis + MinIO)
  k8s/         Kustomize manifests (filled in deployment task)
docs/          PRD, ADRs, deployment runbook, design tokens, task cards
```

## Prerequisites

- Node.js ≥ 20 with [Corepack](https://nodejs.org/api/corepack.html) enabled — `corepack enable && corepack prepare pnpm@latest --activate`
- [Bun](https://bun.sh) ≥ 1.2 — `curl -fsSL https://bun.sh/install | bash`
- Docker + Docker Compose. On macOS: [colima](https://github.com/abiosoft/colima) or OrbStack works fine — `brew install colima docker docker-compose && colima start`

## Quick start

```bash
pnpm install

# Copy env templates (real values live outside git)
cp apps/api/.env.example apps/api/.env
cp packages/db/.env.example packages/db/.env

# Start Postgres + Redis + MinIO (port 5432, 6379, 9000+9001)
pnpm infra:up

# Apply migrations (no-op until TASK-004 adds the first schema)
pnpm db:migrate

# Backend on http://localhost:3000 → `curl :3000/health`
pnpm dev:api

# Frontend on http://localhost:5173 → renders "Sapientia"
pnpm dev:web
```

`/health` reports the status of every dependency. Returns `200 {status:"ok",db:"connected",redis:"connected",s3:"connected"}` when everything is up; `503 {status:"degraded",...}` if any service is unreachable.

## Common scripts

| Command             | What it does                                                                  |
| ------------------- | ----------------------------------------------------------------------------- |
| `pnpm dev:web`      | Vite dev server                                                               |
| `pnpm dev:api`      | `bun --hot` Hono server                                                       |
| `pnpm infra:up`     | `docker compose up -d` for Postgres + Redis + MinIO                           |
| `pnpm infra:down`   | Stop the dev stack                                                            |
| `pnpm infra:logs`   | Tail compose logs                                                             |
| `pnpm db:generate`  | Drizzle Kit — diff schema files to a new migration                            |
| `pnpm db:migrate`   | Apply migrations against `DATABASE_URL`                                       |
| `pnpm db:studio`    | Drizzle Studio (web UI on a free port)                                        |
| `pnpm typecheck`    | TypeScript across all packages                                                |
| `pnpm run lint`     | `biome check .` (use `pnpm run` because pnpm 10 reserves `pnpm lint`)         |
| `pnpm format`       | `biome format --write .`                                                      |
| `pnpm build`        | Build all packages                                                            |
| `pnpm test`         | Run all package test scripts (vitest, with testcontainers for integration)   |

## Tests

`pnpm test` runs vitest in `apps/api/`. Integration tests use `testcontainers-node`, which needs a working Docker socket. The vitest config auto-discovers colima / Docker-Desktop / standard sockets and sets `DOCKER_HOST` for you. If your Docker socket lives somewhere unusual, export `DOCKER_HOST=unix:///path/to/docker.sock` before running.

Phase 1 status and active task: [docs/STATUS.md](docs/STATUS.md).
