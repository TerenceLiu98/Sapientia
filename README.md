<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="demo/logit-dark.svg">
    <img alt="Sapientia" src="demo/logo-light.svg" width="120" height="120">
  </picture>

  <h1>Sapientia</h1>

  <p><strong>Human do Marginalia, AIs do Zettelkasten</strong></p>

  <p>
    A web reader for researchers. PDFs are parsed into addressable blocks; notes cite blocks; accumulated notes grow into auto-built wiki pages and a knowledge graph. AI is summoned, not assumed.
  </p>
</div>

---

## Why

Most "AI for papers" tools answer for you. Sapientia is built for the opposite habit: you read, and the assistant stays out of the way until you summon it. When you do summon it, every claim is grounded in addressable blocks of the paper you're reading, citations stay verifiable, and the notes you write become the knowledge base — not a chat log. A more detailed motivation is in [Human do Marginalia, AIs do Zettelkasten](https://blog.cklau.cc/post/sapientia-development/)

## Features

- **Block-addressable PDFs.** Papers are parsed by [MinerU](https://mineru.net) into stable, content-hashed blocks. Every figure, equation, paragraph, and table has its own ID — `paperId#blockId` — that survives re-parse.
- **Side-by-side reading.** PDF and parsed-Markdown views of the same paper, kept in sync. Click a block in either pane to focus it in the other; both views remember scroll on toggle.
- **Citations as first-class data.** Notes are written in a Tiptap-based editor (built on the [Novel](https://novel.sh) primitives) and embed `@[block N]` chips that link to the source block. Click a chip to jump to the exact figure or paragraph it cites.
- **Highlights with semantics.** A built-in five-color palette (Questioning / Important / Original / Pending / Conclusion) plus user-defined palettes. Highlights persist per-block, render in both views, and tag the citation chip with the same color.
- **Reader markup.** Highlight, underline, and freehand ink on the PDF itself — overlay-only, your original PDF is never modified.
- **Restraint-first AI.** v0.1 ships a single-turn "ask about this paper" agent with explicit context layers. No tool-calling, no auto-summoning, no workspace-wide context bleed.
- **Self-hostable.** Bring your own MinerU token and Anthropic / OpenAI key. Postgres + Redis + RustFS/S3-compatible object storage run in your cluster.

## For Now

**Sapientia is in early development and in a quick iteration phase.** 

Date: Apr 29, 2026: 
<center>
    <figure>
        <img src="https://32cf906.webp.li/2026/04/sapientia-development-example-1.png" width="100%" alt="Sapientia Reading Mode">
    <figure>
</center>

## Quick start

### Full Docker Compose stack

```bash
# Builds and starts web, API, worker, migrations, Postgres, Redis, and RustFS.
pnpm infra:up
```

Open `http://localhost:8080`. The API is also exposed on `http://localhost:3000`,
RustFS/S3 on `http://localhost:9000`, and the RustFS console on `http://localhost:9001`.

For anything beyond local testing, copy `infra/docker/.env.example`, replace the
secrets, and pass it to Compose:

```bash
cp infra/docker/.env.example infra/docker/.env
docker compose --env-file infra/docker/.env -f infra/docker/docker-compose.yml up -d --build --force-recreate
```

GitHub Actions publishes `sapientia-api` and `sapientia-web` images to GHCR on
pushes to the `publish` branch, version tags, and manual dispatch. To deploy from
published images instead of building locally, set `API_IMAGE` and `WEB_IMAGE` in
`infra/docker/.env`, then pull and start without building:

```bash
API_IMAGE=ghcr.io/<owner>/sapientia-api:latest
WEB_IMAGE=ghcr.io/<owner>/sapientia-web:latest

docker compose --env-file infra/docker/.env -f infra/docker/docker-compose.yml pull api worker web migrate
docker compose --env-file infra/docker/.env -f infra/docker/docker-compose.yml up -d --no-build --force-recreate
```

After signing in, configure your **MinerU token** and **LLM API key** in
`/settings`; user credentials are stored encrypted using `ENCRYPTION_KEY`.

### Local development

```bash
# Toolchain
corepack enable && corepack prepare pnpm@latest --activate
curl -fsSL https://bun.sh/install | bash    # Bun ≥ 1.2
brew install colima docker docker-compose && colima start   # macOS

# Project
pnpm install
cp apps/api/.env.example apps/api/.env
cp packages/db/.env.example packages/db/.env

docker compose -f infra/docker/docker-compose.yml up -d postgres redis object-storage object-storage-init
pnpm db:migrate      # better-auth + app schema

pnpm dev:api         # http://localhost:3000  →  /health
pnpm dev:web         # http://localhost:5173  →  sign in
pnpm worker:dev      # BullMQ worker for parse + enrich
```

`/health` returns `200 {status:"ok",db:"connected",redis:"connected",s3:"connected"}` when every dependency is up, `503 {status:"degraded",...}` otherwise.

After signing in, configure your **MinerU token** and **LLM API key** in `/settings`. Uploaded PDFs queue for parsing; progress shows in the library badge as `parsing N/M`. Open a parsed paper for the side-by-side reader; click "New note" for the three-pane reading + writing layout.

## Tech stack

| Layer | Stack |
| --- | --- |
| Frontend | React 19 · TypeScript (strict) · Vite · Tailwind v4 · shadcn/ui · Zustand · TanStack Query/Router · Tiptap (via [Novel](https://novel.sh)) · PDF.js · sigma.js |
| Backend | Bun ≥ 1.2 · Hono · Drizzle ORM · Zod · BullMQ · better-auth · AWS SDK v3 |
| Data | PostgreSQL 16 + pgvector · Redis 7 · RustFS / S3-compatible object storage |
| External | MinerU (PDF parsing) · Anthropic or OpenAI (LLM) |
| Tooling | pnpm workspaces · Biome · vitest · Playwright · testcontainers-node · Docker Compose · Kustomize |

## Repository layout

```
apps/
  web/                  React frontend (Vite)
  api/                  Hono backend (Bun) — routes, services, BullMQ workers
packages/
  shared/               Zod schemas, types, prompts shared across the stack
  db/                   Drizzle schema, migrations, client
infra/
  docker/               docker-compose for full self-hosted stack
  k8s/                  Kustomize manifests (base + dev/prod overlays)
docs/                   PRD, ADRs, deployment runbook, design tokens, task cards
demo/                   Logo + landing assets
```

## Common scripts

| Command | What it does |
| --- | --- |
| `pnpm dev:web` | Vite dev server |
| `pnpm dev:api` | `bun --hot` Hono server |
| `pnpm worker:dev` | BullMQ worker (paper parse + enrich) |
| `pnpm infra:up` / `infra:down` / `infra:logs` | Docker Compose full stack |
| `pnpm db:generate` | Drizzle Kit — diff schema files into a new migration |
| `pnpm db:migrate` | Apply migrations against `DATABASE_URL` |
| `pnpm db:studio` | Drizzle Studio web UI |
| `pnpm typecheck` | TypeScript across the workspace |
| `pnpm run lint` | `biome check .` (use `pnpm run` — pnpm 10 reserves `pnpm lint`) |
| `pnpm format` | `biome format --write .` |
| `pnpm build` | Build all packages |
| `pnpm test` | Vitest across the workspace (testcontainers for backend integration) |

## Tests

`pnpm test` runs vitest across the workspace. The web tests cover auth flow + reader components; the API tests use [`testcontainers-node`](https://node.testcontainers.org) for ephemeral Postgres + Redis + S3-compatible object storage and need a working Docker socket. The vitest config auto-discovers colima / Docker-Desktop / standard sockets and sets `DOCKER_HOST` for you. If your Docker socket lives somewhere unusual, export `DOCKER_HOST=unix:///path/to/docker.sock` first.

## Authentication

Email/password works out of the box with `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=http://localhost:3000`, and `FRONTEND_ORIGIN=http://localhost:5173` set in `apps/api/.env`. OAuth is optional in local development.

<details>
<summary><strong>Google OAuth</strong></summary>

1. Visit [Google Cloud Console](https://console.cloud.google.com/) and create a project.
2. Enable the Google Sign-In APIs.
3. Create an **OAuth 2.0 Web application** client.
4. Add redirect URI `http://localhost:3000/api/auth/callback/google`.
5. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `apps/api/.env`.
</details>

<details>
<summary><strong>GitHub OAuth</strong></summary>

1. Visit [GitHub Developer Settings](https://github.com/settings/developers) → **New OAuth App**.
2. Authorization callback URL: `http://localhost:3000/api/auth/callback/github`.
3. Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in `apps/api/.env`.
</details>

If you set one value of an OAuth provider pair you must set the other — config validation rejects partial provider configuration on boot.

## Frontend notes

The web app uses TanStack Router with the Vite router plugin. File-based routes live in `apps/web/src/routes`; `apps/web/src/routeTree.gen.ts` is generated automatically during build/dev and should be committed when it changes.

In dev, Vite proxies `/api/*` from `:5173` to `:3000`, so better-auth stays same-origin from the browser's perspective and auth cookies work without extra client configuration.

## Project status

Phase 1 — **Reading Foundation**. Sign-up → upload PDF → parse via MinerU → block-addressable reader.

## Contributing

Sapientia is in heavy development. Open an issue before significant changes; the [`CLAUDE.md`](CLAUDE.md) file at the repo root is the operations manual that human + AI contributors share — it documents the locked tech stack, naming conventions, and "do not" rules.

## License

Not yet decided. Treat as source-available for now; add an explicit license before any external use.
