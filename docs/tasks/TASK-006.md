# TASK-006: Frontend auth flow + minimal layout

**Estimated effort**: 6-8 hours
**Depends on**: TASK-003
**Phase**: 1 — Reading Foundation

---

## Context

We have backend auth working. Now we need the frontend to actually use it.

This task adds:
- better-auth React client setup (`createAuthClient`)
- Vite proxy so `/api/*` calls forward to the backend during local dev
- Sign-up / sign-in / sign-out pages
- Protected route wrapper
- Three-pane layout shell (left nav, center, right panel) — empty for now, populated by later tasks
- Tailwind v4 token wiring from `DESIGN_TOKENS.md` (`@theme` block)
- App router (TanStack Router or React Router 6 — pick one and document)

Visual styling references `docs/DESIGN_TOKENS.md`. Don't deviate.

---

## Acceptance Criteria

1. **Vite dev proxy**: requests to `/api/*` from `http://localhost:5173` forward to `http://localhost:3000`. Cookies pass through.
2. **better-auth client**: `apps/web/src/lib/auth-client.ts` exports `authClient`, `useSession`, `signIn`, `signUp`, `signOut`.
3. **Pages**:
   - `/sign-in` — email + password form + "continue with Google" / "continue with GitHub" buttons (only render OAuth buttons if backend has providers configured — query a `/api/v1/auth-providers` endpoint or hardcode for now and let it 404 gracefully)
   - `/sign-up` — email + password + name form
   - `/` (protected) — main app shell, redirects to `/sign-in` if no session
4. **App shell** (`apps/web/src/components/layout/AppShell.tsx`):
   - Left nav: 240px wide, contains "Library", "Notes", "Wiki", "Graph" items (all empty placeholders linking to nowhere yet) and a workspace picker at top
   - Center: route outlet
   - Right panel: 380px wide, collapsed by default, slot for agent panel (empty placeholder)
   - Top bar: 56px, contains current page title + user menu (avatar dropdown with "Sign out")
5. **`useCurrentUser` hook** wraps better-auth's `useSession`, throws if not authenticated (used inside protected routes only).
6. **`<ProtectedRoute>`** component: if loading session, show skeleton; if no session, redirect to `/sign-in`; if session, render children.
7. **Tailwind v4 tokens**: `apps/web/src/index.css` defines all design tokens via `@theme` directive.
8. **Top-bar user menu** opens via shadcn DropdownMenu, shows email + signout button.
9. **Sign-out**: button calls `authClient.signOut()`, then navigates to `/sign-in`.
10. **Tests**: at least one component test for the sign-in form (renders, calls signIn on submit) and one for the protected route redirect.

---

## What to Build

### Vite proxy

`apps/web/vite.config.ts`:

```typescript
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: false,
        cookieDomainRewrite: "",
      },
    },
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
})
```

The `cookieDomainRewrite` ensures auth cookies set by the backend work in the Vite dev environment.

### better-auth React client

```bash
cd apps/web
pnpm add better-auth
```

`apps/web/src/lib/auth-client.ts`:

```typescript
import { createAuthClient } from "better-auth/react"

export const authClient = createAuthClient({
  // Same-origin in dev (Vite proxy) and prod (path-routing per ADR-016) — no baseURL needed
})

export const { useSession, signIn, signUp, signOut } = authClient
```

### Router setup

Pick **TanStack Router** (typed routing, modern, integrates well with TanStack Query that we'll use in TASK-007):

```bash
cd apps/web
pnpm add @tanstack/react-router
pnpm add -D @tanstack/router-plugin
```

Add the router plugin to Vite config (auto-generates route tree).

`apps/web/src/router.ts`:

```typescript
import { createRouter } from "@tanstack/react-router"
import { routeTree } from "./routeTree.gen"

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
```

`apps/web/src/routes/__root.tsx`:

```typescript
import { createRootRoute, Outlet } from "@tanstack/react-router"

export const Route = createRootRoute({
  component: () => <Outlet />,
})
```

`apps/web/src/routes/index.tsx`:

```typescript
import { createFileRoute } from "@tanstack/react-router"
import { ProtectedRoute } from "@/components/auth/ProtectedRoute"
import { AppShell } from "@/components/layout/AppShell"

export const Route = createFileRoute("/")({
  component: () => (
    <ProtectedRoute>
      <AppShell>
        <div className="p-6">
          <h1 className="font-serif text-3xl text-text-primary">Welcome to Sapientia</h1>
          <p className="text-text-secondary mt-2">Library is empty. Upload a paper to begin.</p>
        </div>
      </AppShell>
    </ProtectedRoute>
  ),
})
```

`apps/web/src/routes/sign-in.tsx`:

```typescript
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { signIn } from "@/lib/auth-client"

export const Route = createFileRoute("/sign-in")({
  component: SignInPage,
})

function SignInPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const result = await signIn.email({ email, password })
      if (result.error) {
        setError(result.error.message ?? "sign in failed")
        return
      }
      await navigate({ to: "/" })
    } catch (err) {
      setError("sign in failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-primary">
      <div className="w-full max-w-narrow p-8 bg-bg-primary rounded-lg border border-border-subtle">
        <h1 className="font-serif text-3xl mb-6 text-text-primary">Sign in to Sapientia</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1 text-text-primary">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-10 px-3 rounded-md border border-border-default focus:border-border-accent outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-text-primary">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-10 px-3 rounded-md border border-border-default focus:border-border-accent outline-none"
            />
          </div>
          {error && <p className="text-text-error text-sm">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full h-10 rounded-md bg-accent-600 text-white font-medium disabled:opacity-50 hover:bg-accent-700 transition-colors"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="mt-6 space-y-2">
          <button
            type="button"
            onClick={() => signIn.social({ provider: "google" })}
            className="w-full h-10 rounded-md border border-border-default hover:bg-surface-hover text-sm font-medium"
          >
            Continue with Google
          </button>
          <button
            type="button"
            onClick={() => signIn.social({ provider: "github" })}
            className="w-full h-10 rounded-md border border-border-default hover:bg-surface-hover text-sm font-medium"
          >
            Continue with GitHub
          </button>
        </div>

        <p className="text-text-secondary text-sm mt-6 text-center">
          No account?{" "}
          <Link to="/sign-up" className="text-text-accent hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
```

`apps/web/src/routes/sign-up.tsx`:

Similar to sign-in but with `name` field and `signUp.email({...})`.

### Protected route

`apps/web/src/components/auth/ProtectedRoute.tsx`:

```typescript
import { useSession } from "@/lib/auth-client"
import { Navigate } from "@tanstack/react-router"
import type { ReactNode } from "react"

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useSession()

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-text-tertiary text-sm">Loading…</div>
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/sign-in" />
  }

  return <>{children}</>
}
```

### App shell

`apps/web/src/components/layout/AppShell.tsx`:

```typescript
import type { ReactNode } from "react"
import { TopBar } from "./TopBar"
import { LeftNav } from "./LeftNav"
import { RightPanel } from "./RightPanel"

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="h-screen grid grid-cols-[240px_1fr_380px] grid-rows-[56px_1fr]">
      <div className="col-span-3 row-start-1 border-b border-border-subtle">
        <TopBar />
      </div>
      <aside className="col-start-1 row-start-2 border-r border-border-subtle bg-bg-secondary overflow-y-auto">
        <LeftNav />
      </aside>
      <main className="col-start-2 row-start-2 overflow-y-auto bg-bg-primary">
        {children}
      </main>
      <aside className="col-start-3 row-start-2 border-l border-border-subtle bg-bg-secondary overflow-y-auto">
        <RightPanel />
      </aside>
    </div>
  )
}
```

`apps/web/src/components/layout/TopBar.tsx`:

```typescript
import { useSession, signOut } from "@/lib/auth-client"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"

export function TopBar() {
  const { data: session } = useSession()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  async function handleSignOut() {
    await signOut()
    await navigate({ to: "/sign-in" })
  }

  return (
    <div className="h-full px-6 flex items-center justify-between bg-bg-primary">
      <div className="font-serif text-lg font-semibold tracking-tight">Sapientia</div>
      <div className="relative">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="h-8 w-8 rounded-full bg-accent-600 text-white text-sm font-medium"
        >
          {session?.user?.email?.[0]?.toUpperCase() ?? "?"}
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-10 w-56 bg-bg-primary border border-border-subtle rounded-md shadow-md p-2">
            <div className="text-sm text-text-secondary px-3 py-2 truncate">
              {session?.user?.email}
            </div>
            <button
              onClick={handleSignOut}
              className="w-full text-left px-3 py-2 text-sm hover:bg-surface-hover rounded-md"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
```

`apps/web/src/components/layout/LeftNav.tsx`:

```typescript
const NAV_ITEMS = [
  { label: "Library", icon: "📚" },
  { label: "Notes", icon: "📝" },
  { label: "Wiki", icon: "🔗" },
  { label: "Graph", icon: "🌐" },
]

export function LeftNav() {
  return (
    <div className="p-4">
      <div className="text-xs uppercase tracking-wider text-text-secondary mb-3">
        Workspace
      </div>
      <div className="text-sm font-medium text-text-primary mb-6 px-2 py-1.5 rounded-md bg-surface-selected">
        My Research
      </div>
      <nav className="space-y-1">
        {NAV_ITEMS.map((item) => (
          <div
            key={item.label}
            className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-text-secondary hover:bg-surface-hover cursor-pointer"
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </div>
        ))}
      </nav>
    </div>
  )
}
```

`apps/web/src/components/layout/RightPanel.tsx`:

```typescript
export function RightPanel() {
  return (
    <div className="p-4">
      <div className="text-xs uppercase tracking-wider text-text-secondary">
        Assistant
      </div>
      <p className="text-sm text-text-tertiary mt-3">
        Highlight a passage and press <kbd className="px-1.5 py-0.5 text-xs bg-bg-tertiary rounded">?</kbd> to ask the agent.
      </p>
    </div>
  )
}
```

### Tailwind v4 token wiring

`apps/web/src/index.css` (replace contents):

```css
@import "tailwindcss";

@theme {
  /* === Color primitives === */
  --color-neutral-50: oklch(0.985 0.003 75);
  --color-neutral-100: oklch(0.965 0.005 75);
  --color-neutral-200: oklch(0.925 0.006 75);
  --color-neutral-300: oklch(0.870 0.007 75);
  --color-neutral-400: oklch(0.745 0.008 75);
  --color-neutral-500: oklch(0.585 0.008 75);
  --color-neutral-600: oklch(0.460 0.008 75);
  --color-neutral-700: oklch(0.355 0.008 75);
  --color-neutral-800: oklch(0.235 0.008 70);
  --color-neutral-900: oklch(0.165 0.008 65);
  --color-neutral-950: oklch(0.115 0.008 60);

  --color-accent-50: oklch(0.965 0.020 195);
  --color-accent-100: oklch(0.920 0.040 195);
  --color-accent-200: oklch(0.860 0.070 195);
  --color-accent-300: oklch(0.770 0.100 195);
  --color-accent-400: oklch(0.660 0.115 195);
  --color-accent-500: oklch(0.540 0.120 195);
  --color-accent-600: oklch(0.450 0.110 195);
  --color-accent-700: oklch(0.370 0.090 195);
  --color-accent-800: oklch(0.290 0.065 195);
  --color-accent-900: oklch(0.220 0.040 195);

  /* === Semantic tokens === */
  --color-bg-primary: var(--color-neutral-50);
  --color-bg-secondary: var(--color-neutral-100);
  --color-bg-tertiary: var(--color-neutral-200);

  --color-surface-hover: var(--color-neutral-100);
  --color-surface-selected: var(--color-accent-100);

  --color-text-primary: var(--color-neutral-900);
  --color-text-secondary: var(--color-neutral-600);
  --color-text-tertiary: var(--color-neutral-500);
  --color-text-accent: var(--color-accent-700);
  --color-text-error: oklch(0.45 0.130 25);

  --color-border-subtle: var(--color-neutral-200);
  --color-border-default: var(--color-neutral-300);
  --color-border-accent: var(--color-accent-500);

  /* === Typography === */
  --font-serif: "Source Serif 4", Georgia, "Times New Roman", serif;
  --font-sans: "Inter", system-ui, -apple-system, sans-serif;
  --font-mono: "JetBrains Mono", "SF Mono", Menlo, monospace;

  /* === Layout === */
  --container-narrow: 640px;
  --container-content: 800px;
  --container-wide: 1200px;
}

/* Load fonts */
@import url("https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@400;500;600&family=JetBrains+Mono&display=swap");

html, body {
  margin: 0;
  font-family: var(--font-sans);
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
}
```

> Note: full DESIGN_TOKENS.md has more tokens. This is the v0.1 minimum needed for shell + auth. Add more incrementally per task.

### Entry point

`apps/web/src/main.tsx`:

```typescript
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "@tanstack/react-router"
import { router } from "./router"
import "./index.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
```

### useCurrentUser hook

`apps/web/src/lib/use-current-user.ts`:

```typescript
import { useSession } from "./auth-client"

export function useCurrentUser() {
  const { data: session, isPending } = useSession()
  if (isPending) return { user: null, isPending: true } as const
  if (!session) throw new Error("useCurrentUser called outside ProtectedRoute")
  return { user: session.user, isPending: false } as const
}
```

### Tests

```bash
cd apps/web
pnpm add -D vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom
```

`apps/web/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
  },
  resolve: {
    alias: { "@": "/src" },
  },
})
```

`apps/web/test/setup.ts`:

```typescript
import "@testing-library/jest-dom"
```

Component tests for sign-in form and ProtectedRoute (mocking `useSession`).

---

## Do Not

- **Do not implement the workspace switcher dropdown.** v0.1 has only one workspace per user.
- **Do not add password strength meter, password reset, or email verification UI.** v0.2.
- **Do not implement avatar upload.** First letter of email is fine.
- **Do not skip TanStack Router types.** `routeTree.gen.ts` is auto-generated; commit it.
- **Do not add a global app store yet** (no Zustand). State is local until proven otherwise.
- **Do not prefetch session in router** until we know it's a real win. Lazy is fine.
- **Do not add E2E (Playwright) tests yet.** Component tests are sufficient.
- **Do not configure CORS in Vite.** The proxy handles it.
- **Do not deviate from the layout grid measurements.** 240/main/380 with 56 top bar — these are spec.
- **Do not add Source Serif 4 as a self-hosted font yet.** Google Fonts CDN is fine for v0.1.

---

## Decisions Recorded for This Task

- **TanStack Router** over React Router. File-based routes, full type safety, integrates with TanStack Query (TASK-007).
- **Vite proxy** for dev → backend. Cleanest way to keep cookies same-origin during dev without configuring CORS.
- **Tailwind v4 with `@theme`** in `index.css`. CSS-first, no `tailwind.config.ts`. Tokens incremental — only add what each task uses.
- **No Zustand yet.** Local component state until pain emerges.
- **DropdownMenu manually implemented** for the user menu. shadcn primitive can be added when there are more dropdowns to justify the dependency.

---

## Definition of Done — Quick Checklist

- [ ] `pnpm dev:web` starts and shows app
- [ ] Vite proxies `/api/*` to backend successfully
- [ ] `/sign-up` creates a new user (verify via backend `/api/v1/me`)
- [ ] `/sign-in` works for created user
- [ ] After sign in, `/` shows the app shell with placeholder content
- [ ] `/` redirects to `/sign-in` when not authenticated
- [ ] OAuth buttons render (clicks attempt the redirect, server may 404 if provider not configured — acceptable)
- [ ] Sign out works
- [ ] All component tests pass
- [ ] Existing backend tests still pass
- [ ] STATUS.md updated, commit `[TASK-006] Frontend auth flow with better-auth client and app shell`

---

## Report Back

After completing:
- Confirm Vite proxy + cookies works (this is the most likely failure point)
- Note TanStack Router + Vite plugin version compatibility (sometimes the plugin needs Node, but Bun usually works)
- Suggest design improvements you noticed against `docs/DESIGN_TOKENS.md`
- Flag if any DESIGN_TOKENS.md tokens are missing for tasks 7-8 ahead