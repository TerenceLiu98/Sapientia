# TASK-007: Frontend PDF upload UI + library list

**Estimated effort**: 4-6 hours
**Depends on**: TASK-005, TASK-006
**Phase**: 1 — Reading Foundation

---

## Context

Backend can store papers; frontend has the auth/shell skeleton. Now wire them together.

This task adds:
- TanStack Query for server state
- A typed API client targeting backend endpoints
- Drag-and-drop upload zone
- Library page with TanStack Table v8 listing the user's papers
- Parse-status badges (pending / parsing / done / failed)
- Click-through routing to a paper detail page (skeleton; PDF rendering is TASK-008)

---

## Acceptance Criteria

1. **TanStack Query** installed and provider mounted in `main.tsx`.
2. **API client** at `apps/web/src/api/client.ts` — typed wrapper around `fetch` that handles cookies + JSON.
3. **Hooks** at `apps/web/src/api/hooks/`:
   - `usePapers(workspaceId)` — list
   - `usePaper(paperId)` — detail
   - `useUploadPaper(workspaceId)` — mutation
4. **Library page** (`/library`) shows a TanStack Table of papers with columns: Title, Uploaded At, Parse Status, Size.
5. **Empty state** with prominent "Upload PDF" call-to-action.
6. **Upload zone** with drag-drop + click-to-browse, using `react-dropzone`.
7. **Upload progress** shown via `XMLHttpRequest` `progress` events (TanStack Query mutation alone doesn't expose this; document the workaround).
8. **Status badges** in the appropriate semantic color from DESIGN_TOKENS.md:
   - pending → neutral
   - parsing → accent (info)
   - done → success
   - failed → error
9. **Click row** → navigate to `/papers/{id}` (route exists, page is a placeholder until TASK-008).
10. **Tests**: hook tests (mocked fetch), component test for upload zone showing error states.

---

## What to Build

### Install dependencies

```bash
cd apps/web
pnpm add @tanstack/react-query @tanstack/react-table react-dropzone
pnpm add -D @tanstack/react-query-devtools
```

### TanStack Query provider

`apps/web/src/main.tsx` — wrap with provider:

```typescript
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
```

### API client

`apps/web/src/api/client.ts`:

```typescript
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message)
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  })

  if (!res.ok) {
    let body: unknown
    try {
      body = await res.json()
    } catch {
      body = await res.text()
    }
    throw new ApiError(res.status, res.statusText, body)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
```

### Hooks

`apps/web/src/api/hooks/papers.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "../client"

export interface Paper {
  id: string
  title: string
  fileSizeBytes: number
  parseStatus: "pending" | "parsing" | "done" | "failed"
  createdAt: string
}

export function usePapers(workspaceId: string) {
  return useQuery<Paper[]>({
    queryKey: ["papers", workspaceId],
    queryFn: () => apiFetch(`/api/v1/workspaces/${workspaceId}/papers`),
  })
}

export function usePaper(paperId: string) {
  return useQuery<Paper>({
    queryKey: ["paper", paperId],
    queryFn: () => apiFetch(`/api/v1/papers/${paperId}`),
  })
}

export interface PdfUrlResponse {
  url: string
  expiresInSeconds: number
}

export function usePaperPdfUrl(paperId: string) {
  return useQuery<PdfUrlResponse>({
    queryKey: ["paper", paperId, "pdf-url"],
    queryFn: () => apiFetch(`/api/v1/papers/${paperId}/pdf-url`),
    staleTime: 30 * 60 * 1000,  // refresh every ~30 min before URL expires
  })
}

export function useUploadPaper(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      file,
      onProgress,
    }: {
      file: File
      onProgress?: (pct: number) => void
    }): Promise<Paper> => {
      // Use XHR for progress events; fetch streams aren't reliable cross-browser yet
      return new Promise<Paper>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        const formData = new FormData()
        formData.append("file", file)

        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable && onProgress) {
            onProgress(Math.round((e.loaded / e.total) * 100))
          }
        })

        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText) as Paper)
          } else {
            try {
              reject(new Error(JSON.parse(xhr.responseText).error ?? xhr.statusText))
            } catch {
              reject(new Error(xhr.statusText))
            }
          }
        })
        xhr.addEventListener("error", () => reject(new Error("network error")))

        xhr.open("POST", `/api/v1/workspaces/${workspaceId}/papers`)
        xhr.withCredentials = true
        xhr.send(formData)
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["papers", workspaceId] })
    },
  })
}
```

### Workspace hook

`apps/web/src/api/hooks/workspaces.ts`:

```typescript
import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "../client"

export interface Workspace {
  id: string
  name: string
  type: "personal" | "shared"
  role: "owner" | "editor" | "reader"
  createdAt: string
}

export function useWorkspaces() {
  return useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: () => apiFetch("/api/v1/workspaces"),
  })
}

export function useCurrentWorkspace() {
  // v0.1: just return the first (personal) workspace
  const { data, ...rest } = useWorkspaces()
  return { ...rest, data: data?.[0] }
}
```

### Library page

`apps/web/src/routes/library.tsx`:

```typescript
import { createFileRoute, Link } from "@tanstack/react-router"
import { ProtectedRoute } from "@/components/auth/ProtectedRoute"
import { AppShell } from "@/components/layout/AppShell"
import { LibraryView } from "@/components/library/LibraryView"

export const Route = createFileRoute("/library")({
  component: () => (
    <ProtectedRoute>
      <AppShell>
        <LibraryView />
      </AppShell>
    </ProtectedRoute>
  ),
})
```

`apps/web/src/components/library/LibraryView.tsx`:

```typescript
import { useState } from "react"
import { useCurrentWorkspace } from "@/api/hooks/workspaces"
import { usePapers } from "@/api/hooks/papers"
import { UploadDropzone } from "./UploadDropzone"
import { LibraryTable } from "./LibraryTable"

export function LibraryView() {
  const { data: workspace } = useCurrentWorkspace()
  const { data: papers, isLoading } = usePapers(workspace?.id ?? "")
  const [uploadOpen, setUploadOpen] = useState(false)

  if (!workspace || isLoading) {
    return <div className="p-6 text-text-tertiary text-sm">Loading…</div>
  }

  if (!papers || papers.length === 0) {
    return (
      <div className="p-6">
        <h1 className="font-serif text-3xl text-text-primary mb-2">Library</h1>
        <p className="text-text-secondary mb-8">
          Your library is empty. Upload a PDF to get started.
        </p>
        <UploadDropzone workspaceId={workspace.id} />
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-serif text-3xl text-text-primary">Library</h1>
        <button
          onClick={() => setUploadOpen(!uploadOpen)}
          className="h-9 px-4 rounded-md bg-accent-600 text-white text-sm font-medium hover:bg-accent-700"
        >
          Upload PDF
        </button>
      </div>

      {uploadOpen && (
        <div className="mb-6">
          <UploadDropzone
            workspaceId={workspace.id}
            onComplete={() => setUploadOpen(false)}
          />
        </div>
      )}

      <LibraryTable papers={papers} />
    </div>
  )
}
```

### Upload dropzone

`apps/web/src/components/library/UploadDropzone.tsx`:

```typescript
import { useDropzone } from "react-dropzone"
import { useState } from "react"
import { useUploadPaper } from "@/api/hooks/papers"

export function UploadDropzone({
  workspaceId,
  onComplete,
}: {
  workspaceId: string
  onComplete?: () => void
}) {
  const upload = useUploadPaper(workspaceId)
  const [progress, setProgress] = useState<number>(0)
  const [error, setError] = useState<string | null>(null)

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { "application/pdf": [".pdf"] },
    maxSize: 50 * 1024 * 1024,
    multiple: false,
    onDrop: async (accepted) => {
      const file = accepted[0]
      if (!file) return
      setError(null)
      setProgress(0)
      try {
        await upload.mutateAsync({ file, onProgress: setProgress })
        onComplete?.()
      } catch (err) {
        setError(err instanceof Error ? err.message : "upload failed")
      }
    },
    onDropRejected: (rejections) => {
      const reason = rejections[0]?.errors[0]?.message ?? "rejected"
      setError(reason)
    },
  })

  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
        isDragActive
          ? "border-border-accent bg-surface-hover"
          : "border-border-default hover:border-border-accent"
      }`}
    >
      <input {...getInputProps()} />
      {upload.isPending ? (
        <div>
          <div className="text-sm text-text-secondary mb-2">Uploading… {progress}%</div>
          <div className="h-1 bg-bg-tertiary rounded-full overflow-hidden">
            <div
              className="h-full bg-accent-600 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : (
        <div>
          <p className="text-text-primary font-medium">
            {isDragActive ? "Drop the PDF here" : "Drop a PDF here, or click to browse"}
          </p>
          <p className="text-sm text-text-secondary mt-1">Max 50 MB</p>
        </div>
      )}
      {error && <p className="text-text-error text-sm mt-3">{error}</p>}
    </div>
  )
}
```

### Library table

`apps/web/src/components/library/LibraryTable.tsx`:

```typescript
import { useReactTable, getCoreRowModel, flexRender, createColumnHelper } from "@tanstack/react-table"
import { Link } from "@tanstack/react-router"
import type { Paper } from "@/api/hooks/papers"

const columnHelper = createColumnHelper<Paper>()

const columns = [
  columnHelper.accessor("title", {
    header: "Title",
    cell: (info) => (
      <Link
        to={`/papers/$paperId`}
        params={{ paperId: info.row.original.id }}
        className="text-text-primary hover:text-text-accent"
      >
        {info.getValue()}
      </Link>
    ),
  }),
  columnHelper.accessor("createdAt", {
    header: "Uploaded",
    cell: (info) => new Date(info.getValue()).toLocaleDateString(),
  }),
  columnHelper.accessor("parseStatus", {
    header: "Status",
    cell: (info) => <StatusBadge status={info.getValue()} />,
  }),
  columnHelper.accessor("fileSizeBytes", {
    header: "Size",
    cell: (info) => `${(info.getValue() / 1024 / 1024).toFixed(1)} MB`,
  }),
]

function StatusBadge({ status }: { status: Paper["parseStatus"] }) {
  const styles: Record<Paper["parseStatus"], string> = {
    pending: "bg-bg-tertiary text-text-secondary",
    parsing: "bg-accent-100 text-accent-700",
    done: "bg-[oklch(0.92_0.035_145)] text-[oklch(0.42_0.085_145)]",
    failed: "bg-[oklch(0.93_0.035_25)] text-[oklch(0.45_0.130_25)]",
  }
  return (
    <span className={`px-2 py-0.5 text-xs rounded-md ${styles[status]}`}>{status}</span>
  )
}

export function LibraryTable({ papers }: { papers: Paper[] }) {
  const table = useReactTable({
    data: papers,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <table className="w-full">
      <thead className="border-b border-border-subtle">
        {table.getHeaderGroups().map((hg) => (
          <tr key={hg.id}>
            {hg.headers.map((header) => (
              <th
                key={header.id}
                className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wider text-text-secondary"
              >
                {flexRender(header.column.columnDef.header, header.getContext())}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr
            key={row.id}
            className="border-b border-border-subtle hover:bg-surface-hover"
          >
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id} className="px-4 py-3 text-sm">
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

### Paper detail placeholder route

`apps/web/src/routes/papers/$paperId.tsx`:

```typescript
import { createFileRoute } from "@tanstack/react-router"
import { ProtectedRoute } from "@/components/auth/ProtectedRoute"
import { AppShell } from "@/components/layout/AppShell"
import { usePaper } from "@/api/hooks/papers"

export const Route = createFileRoute("/papers/$paperId")({
  component: PaperDetail,
})

function PaperDetail() {
  const { paperId } = Route.useParams()
  const { data: paper, isLoading } = usePaper(paperId)
  return (
    <ProtectedRoute>
      <AppShell>
        <div className="p-6">
          {isLoading ? (
            <div className="text-text-tertiary text-sm">Loading…</div>
          ) : !paper ? (
            <div className="text-text-tertiary text-sm">Not found.</div>
          ) : (
            <>
              <h1 className="font-serif text-3xl text-text-primary">{paper.title}</h1>
              <p className="text-text-secondary mt-2">
                Status: {paper.parseStatus}
              </p>
              <p className="text-text-tertiary text-sm mt-6">
                PDF viewer comes in TASK-008.
              </p>
            </>
          )}
        </div>
      </AppShell>
    </ProtectedRoute>
  )
}
```

### LeftNav update

Update `LeftNav` to navigate to `/library` for the Library item:

```typescript
import { Link } from "@tanstack/react-router"

// ...
<Link to="/library" className="flex items-center gap-2 ...">
  📚 Library
</Link>
```

---

## Do Not

- **Do not implement search/filter on the library table.** v0.2.
- **Do not implement multi-file upload.** Single file at a time.
- **Do not show MinerU progress bar in the table.** `parseStatus` badge is enough.
- **Do not auto-poll for status updates.** v0.1 user refreshes manually. Add polling in TASK-009 when MinerU integration arrives.
- **Do not delete papers from UI.** No delete endpoint.
- **Do not add bulk operations.** Future.
- **Do not break the cookie credential flow.** Always pass `credentials: "include"` in fetch.
- **Do not bypass the workspace abstraction.** Even in single-user mode, paper queries always go through `workspaceId`.

---

## Decisions Recorded for This Task

- **XHR for upload progress** — fetch's progress streaming is too inconsistent in 2026; XHR is reliable, supports `withCredentials` for cookies.
- **TanStack Table v8** even for simple tables — establishes the pattern early. The library is small.
- **TanStack Query staleTime 30s** by default — papers don't change frequently; fewer redundant refetches.
- **Status badge colors map to DESIGN_TOKENS.md semantic colors** — currently using arbitrary OKLCH values inline for done/failed because tokens for status backgrounds aren't yet in `index.css`. Add to `@theme` if it appears in 2+ places.

---

## Definition of Done — Quick Checklist

- [ ] Library page loads at `/library`
- [ ] Empty state shows upload zone prominently
- [ ] PDF upload via drag-drop succeeds → table updates
- [ ] PDF upload via click-to-browse succeeds
- [ ] Upload progress bar updates during upload
- [ ] >50MB upload shows error
- [ ] Non-PDF upload rejected
- [ ] Status badges render with appropriate colors
- [ ] Click row → `/papers/{id}` placeholder shows paper title
- [ ] All component tests pass
- [ ] Existing tests still pass
- [ ] STATUS.md updated, commit `[TASK-007] Library list and PDF upload UI`

---

## Report Back

After completing:
- Note any quirks of TanStack Table v8 that needed working around
- Whether `react-dropzone` is the right choice (alternatives: native drag events)
- Suggest if status colors need promoted to formal tokens in DESIGN_TOKENS.md