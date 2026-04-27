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

# Apply migrations (creates better-auth tables in Phase 1)
pnpm db:migrate

# Backend on http://localhost:3000 → `curl :3000/health`
pnpm dev:api

# Frontend on http://localhost:5173 → sign-in / sign-up / protected shell
pnpm dev:web
```

`/health` reports the status of every dependency. Returns `200 {status:"ok",db:"connected",redis:"connected",s3:"connected"}` when everything is up; `503 {status:"degraded",...}` if any service is unreachable.

After signing in: configure your MinerU + LLM API keys in **/settings**. Uploaded PDFs are queued for parsing by the worker (see `pnpm worker:dev`); progress shows in the library badge as `parsing N/M`. Click into a parsed paper to see the side-by-side PDF + blocks panel; click "New note for this paper" for the three-pane reading + writing layout, with a Cite button on every block and a `(N)` badge on blocks that any of your notes already reference.

## Common scripts

| Command             | What it does                                                                  |
| ------------------- | ----------------------------------------------------------------------------- |
| `pnpm dev:web`      | Vite dev server                                                               |
| `pnpm dev:api`      | `bun --hot` Hono server                                                       |
| `pnpm worker:dev`   | BullMQ worker (paper parsing). Run alongside `dev:api`                        |
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

`pnpm test` runs vitest across the workspace. `apps/web` contains component tests for the auth flow; `apps/api` contains integration tests backed by `testcontainers-node`, which needs a working Docker socket. The vitest config auto-discovers colima / Docker-Desktop / standard sockets and sets `DOCKER_HOST` for you. If your Docker socket lives somewhere unusual, export `DOCKER_HOST=unix:///path/to/docker.sock` before running.

## Frontend notes

The web app uses TanStack Router with the Vite router plugin. File-based routes live in `apps/web/src/routes`, and `apps/web/src/routeTree.gen.ts` is generated automatically during build/dev and should be committed when it changes.

In local development, Vite proxies `/api/*` from `http://localhost:5173` to `http://localhost:3000`, so better-auth stays same-origin from the browser's perspective and auth cookies work without extra client configuration.

## OAuth setup for local development

OAuth is optional in v0.1 local development. Email/password auth works with `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and `FRONTEND_ORIGIN` set. For the default local setup, use `BETTER_AUTH_URL=http://localhost:3000` and `FRONTEND_ORIGIN=http://localhost:5173`.

For Google OAuth:

1. Go to `https://console.cloud.google.com/`.
2. Create a project or select an existing one.
3. Enable the Google Sign-In APIs required by your project setup.
4. Create an OAuth 2.0 client with application type `Web application`.
5. Add the redirect URI `http://localhost:3000/api/auth/callback/google`.
6. Copy the client ID and secret into `apps/api/.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

For GitHub OAuth:

1. Go to `https://github.com/settings/developers`.
2. Create a new OAuth App.
3. Set the authorization callback URL to `http://localhost:3000/api/auth/callback/github`.
4. Copy the client ID and secret into `apps/api/.env` as `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.

If you set one value from an OAuth provider pair, you must set the other too. The API config validation rejects partial provider configuration on boot.

Current phase + status: [docs/STATUS.md](docs/STATUS.md).
