# TASK-001: Initialize TypeScript monorepo + Hono + Vite skeleton

**Estimated effort**: 4-6 hours
**Depends on**: nothing
**Phase**: 1 — Reading Foundation

---

## Context

This is day 1. We need a clean monorepo with the TypeScript full-stack skeleton: React frontend (Vite) + Hono backend (Bun) + shared package + DB schema package. No business logic yet — just scaffolding.

We use pnpm workspaces. Both apps and packages share TypeScript config patterns and biome lint rules.

---

## Acceptance Criteria

When complete:

1. `git init` (or `git mv` if repo exists) and first meaningful commit `[TASK-001] Initialize TypeScript monorepo skeleton`.
2. Repository structure matches the layout in `CLAUDE.md`:
   ```
   sapientia/
   ├── apps/
   │   ├── web/           # Vite + React + TS, prints "Sapientia"
   │   └── api/           # Hono + Bun, GET /health returns {status:"ok"}
   ├── packages/
   │   ├── shared/        # Stub package with index.ts exporting one constant
   │   └── db/            # Stub package, drizzle config placeholder
   ├── infra/
   │   ├── docker/        # Empty, TASK-002 fills
   │   └── k8s/           # Empty, future task fills
   ├── docs/              # Existing docs moved here
   ├── biome.json         # Shared lint config
   ├── package.json       # Root with workspace scripts
   ├── pnpm-workspace.yaml
   ├── tsconfig.base.json # Shared tsconfig
   ├── README.md
   ├── CLAUDE.md
   └── .gitignore
   ```
3. **Frontend works**: `pnpm dev:web` starts Vite, opens browser, shows "Sapientia".
4. **Backend works**: `pnpm dev:api` starts Hono on port 3000 via `bun --hot`. `curl http://localhost:3000/health` returns `{"status":"ok"}`.
5. **Single-command bootstrap**: `pnpm install` from repo root installs all dependencies for all packages.
6. **Type checking**: `pnpm typecheck` runs in all packages and apps with no errors.
7. **Linting**: `pnpm lint` (biome check) passes.
8. `.gitignore` covers Node (`node_modules`, `dist`, `.vite`), envs (`.env`, `.env.local`), IDE (`.idea`, `.vscode/settings.json`), OS (`.DS_Store`), and Bun (`bun.lockb` should be committed actually — but no `.bun` cache).
9. Root `README.md` has project description (one paragraph from PRD §1) and quick-start instructions.

---

## What to Build

### Bun installation

If Bun isn't installed:
```bash
curl -fsSL https://bun.sh/install | bash
```

### Root files

**`package.json`** (root):
```json
{
  "name": "sapientia",
  "private": true,
  "version": "0.1.0",
  "packageManager": "pnpm@9.x.x",
  "scripts": {
    "dev:web": "pnpm --filter @sapientia/web dev",
    "dev:api": "pnpm --filter @sapientia/api dev",
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "lint": "biome check .",
    "format": "biome format --write .",
    "test": "pnpm -r test"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.0.0",
    "typescript": "^5.6.0"
  }
}
```

Use the actual latest stable versions installed at the time. Pin `packageManager` to whatever pnpm is available.

**`pnpm-workspace.yaml`**:
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

**`tsconfig.base.json`**:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  }
}
```

**`biome.json`**:
```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "files": {
    "ignore": ["node_modules", "dist", "build", ".vite", "**/*.gen.ts"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "tab",
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "error"
      }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "semicolons": "asNeeded",
      "trailingCommas": "all"
    }
  }
}
```

**`.gitignore`**: Node + Bun + envs + IDE + OS standard items.

**`README.md`**: project description (from PRD §1) + quick-start.

### Frontend skeleton (`apps/web/`)

Use Vite's React + TS template:
```bash
pnpm create vite@latest apps/web --template react-ts
```

Then:
- Set `name` in `apps/web/package.json` to `@sapientia/web`
- Add `"typecheck": "tsc --noEmit"` to scripts
- Strip Vite demo content; replace `App.tsx` with `<h1>Sapientia</h1>`
- Add Tailwind v4 via `@tailwindcss/vite` plugin (the modern CSS-first path):
  ```bash
  pnpm --filter @sapientia/web add -D tailwindcss @tailwindcss/vite
  ```
- Add `@tailwindcss/vite` to `vite.config.ts` plugins
- In `src/index.css`, replace contents with `@import "tailwindcss";`
- Verify `pnpm dev:web` works

`apps/web/tsconfig.json` extends the base:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

### Backend skeleton (`apps/api/`)

Initialize manually (don't use `bun init` — we want full control):

```bash
mkdir -p apps/api/src
cd apps/api
bun init -y  # creates package.json, but we'll override
```

`apps/api/package.json`:
```json
{
  "name": "@sapientia/api",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "bun --hot src/index.ts",
    "build": "bun build src/index.ts --target=bun --outdir=dist",
    "start": "bun dist/index.js",
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "dependencies": {
    "hono": "^4.6.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.6.0"
  }
}
```

`apps/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["bun"],
    "outDir": "dist"
  },
  "include": ["src"]
}
```

`apps/api/src/index.ts`:
```typescript
import { Hono } from "hono"

const app = new Hono()

app.get("/health", (c) => c.json({ status: "ok" }))

export default {
  port: 3000,
  fetch: app.fetch,
}
```

### Shared package (`packages/shared/`)

```bash
mkdir -p packages/shared/src
```

`packages/shared/package.json`:
```json
{
  "name": "@sapientia/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

`packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/shared/src/index.ts`:
```typescript
export const APP_NAME = "Sapientia"
```

### DB package (`packages/db/`)

Stub for now — TASK-002 fills it with Drizzle.

```bash
mkdir -p packages/db/src
```

`packages/db/package.json`:
```json
{
  "name": "@sapientia/db",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

`packages/db/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/db/src/index.ts`:
```typescript
// Drizzle schema and client will go here in TASK-002
export {}
```

### Documentation move

Move existing docs into `docs/`:
- `PRD_v0.1.md` (provided)
- `DECISIONS.md` (provided)
- `DESIGN_TOKENS.md` (provided)
- `DEPLOYMENT.md` (provided)
- Create `STATUS.md` with content:
  ```markdown
  # Sapientia — Current Status

  **Phase**: 1 — Reading Foundation
  **Active task**: TASK-001 (in progress)
  **Last updated**: <today>

  ## Recently completed
  (none yet)

  ## Up next
  - TASK-001: Initialize TypeScript monorepo + Hono + Vite skeleton
  - TASK-002: Local infrastructure + config + healthcheck
  - ...
  ```
- Create `NOTES.md` with header `# Deferred Notes & Ideas` and one-line description of its purpose.
- Move task cards into `docs/tasks/`.

`CLAUDE.md` stays at repo root.

---

## Do Not

- **Do not install database libraries yet**. TASK-002 handles Drizzle, postgres-js, etc.
- **Do not install editor / PDF / graph libraries** in `apps/web`. Each has its own task later.
- **Do not write any business logic.** Only the `/health` endpoint.
- **Do not configure CORS yet.** TASK-006 handles it (and per ADR-016 it might not even be needed in production).
- **Do not configure Docker yet.** TASK-002 adds `docker-compose.yml`.
- **Do not switch package manager, runtime, or framework.** pnpm + Bun + Hono + Vite are locked.
- **Do not auto-format the Vite template files** during this task — they're fine as-is. Your changes only need to follow biome formatting.

---

## Decisions Recorded for This Task

- **`packageManager` field in root `package.json`** pins pnpm version for all contributors. Use `corepack enable && corepack prepare pnpm@latest --activate` if pnpm isn't available.
- **Bun is the JS runtime for the backend**, not Node.js. This means `node:` imports work but native Bun APIs are preferred where applicable.
- **Tailwind v4 with `@tailwindcss/vite` and CSS-first config** — no `tailwind.config.ts`. The `@theme` directive in `index.css` will hold tokens (set up in TASK-006).
- **Biome** instead of ESLint+Prettier. Tabs (Biome 2 default).

---

## Definition of Done — Quick Checklist

- [ ] `pnpm install` succeeds from repo root
- [ ] `pnpm dev:web` shows "Sapientia" in browser
- [ ] `pnpm dev:api` returns `{"status":"ok"}` on `/health`
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] All four docs present in `docs/`: PRD, DECISIONS, DESIGN_TOKENS, DEPLOYMENT
- [ ] STATUS.md and NOTES.md created
- [ ] CLAUDE.md at repo root
- [ ] Commit made: `[TASK-001] Initialize TypeScript monorepo skeleton`
- [ ] STATUS.md updated to mark TASK-001 done

---

## Report Back

After completing, tell the user:
- What was created
- Any decisions you had to make beyond what's specified (and why)
- Bun version installed
- Any issues encountered (Vite template version drift, etc.)
- What you'd recommend addressing in TASK-002 prep