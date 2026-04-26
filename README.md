# Sapientia

Sapientia is a web app for researchers who want to read papers deeply while AI assists with restraint. Humans read; AI helps only when summoned. PDFs are parsed into addressable blocks, notes cite blocks, and accumulated notes grow into auto-built wiki pages and a knowledge graph.

For full product context see [docs/PRD_v0.1.md](docs/PRD_v0.1.md). For agent operations see [CLAUDE.md](CLAUDE.md).

## Repository layout

```
apps/web/      React 19 + Vite + TypeScript frontend
apps/api/      FastAPI + uv backend
packages/      Shared TS packages (generated types, prompts) — populated later
infra/         docker-compose + Alembic migrations — populated in TASK-002
docs/          PRD, decisions, status, task cards
```

## Prerequisites

- Node.js ≥ 20 with [Corepack](https://nodejs.org/api/corepack.html) enabled (`corepack enable`)
- [`uv`](https://docs.astral.sh/uv/) for Python — `brew install uv` or see upstream docs
- Python 3.12+ (uv will fetch one if missing)

## Quick start

```bash
# Install everything (frontend deps + backend venv)
pnpm install
pnpm bootstrap

# Run the frontend (http://localhost:5173)
pnpm dev:web

# Run the backend (http://localhost:8000, /health returns {"status": "ok"})
pnpm dev:api
```

## Common scripts

| Command            | What it does                                    |
| ------------------ | ----------------------------------------------- |
| `pnpm dev:web`     | Vite dev server for the frontend                |
| `pnpm dev:api`     | uvicorn with reload for the backend             |
| `pnpm typecheck`   | TypeScript type-check (frontend)                |
| `pnpm lint`        | Biome (web) + Ruff (api)                        |
| `pnpm test:api`    | Backend pytest                                  |
| `pnpm build:web`   | Production build for the frontend               |

Phase 1 status and next tasks live in [docs/STATUS.md](docs/STATUS.md).
