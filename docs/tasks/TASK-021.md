# TASK-021: Read-only Paper Map observation point

**Estimated effort**: 2-3 working days
**Depends on**: TASK-020 umbrella, practically at least TASK-020D (local concepts + global concept clusters + cross-paper links)
**Phase**: 3 — Zettelkasten Output
**Status**: complete foundation — 3D Paper Map shipped; future work is polish/hardening only

---

## Context

TASK-020 produces the substrate: paper-local concepts, evidence, semantic relations, source pages, note-born observations, and stable paper-paper edges. TASK-021 is the read-only graph projection over that substrate.

Important product rule:

- source wiki/page artifacts are agent-facing substrate
- users do not maintain wiki pages, graph edges, or ontology
- `/graph` is an observation point, not the main reading workflow
- Concept Lens v2 in the reader is the primary Phase 3 user surface

The default `/graph` view answers: "How are the papers I read connected?" Concepts remain the bridge layer and explain each paper-paper edge, but the user does not edit those concepts or edges directly.

Current visualization direction:

- 3D Paper Map is the default and only visible `/graph` visualization.
- The graph is backed by persisted stable Paper Map snapshots.
- Hysteresis keeps links stable: create conservatively, retain weakened edges, stale old edges gradually.
- Reader notes/highlights influence concepts and edges indirectly through the background pipeline.
- Wiki debug and reader graph debug panels should not return as primary UI.

### Scope

- A single `/graph` route showing workspace papers as nodes.
- Paper-paper edges come from confirmed concept evidence and stable Paper Map lifecycle.
- Clicking a paper opens a compact read-only paper detail sheet.
- Clicking an edge opens evidence: concept pairs, confidence, rationale, snippets, and reader-note provenance.
- Search and visual focus help observation, but do not create graph editing controls.
- Concept Lens can link out to `/graph` for neighborhood inspection, but `/graph` is not the default reading path.

### Implementation status (2026-05-04)

Shipped:

- `GET /api/v1/workspaces/:workspaceId/graph` in `apps/api/src/routes/graph.ts`.
- `useWorkspaceGraph()` in `apps/web/src/api/hooks/graph.ts`.
- `/graph` route in `apps/web/src/routes/graph.tsx`.
- `workspace_paper_graph_edges` and `workspace_paper_graph_snapshots` persist stable Paper Map lifecycle.
- `WorkspaceGraphView` renders a 3D force-directed Paper Map.
- Paper and edge selection opens compact sheets rather than a permanent inspector rail.
- Related evidence shows retained/weaker state and reader-note provenance.
- Legacy reader wiki debug and reader concept graph debug panels were removed.

### Explicitly NOT in scope (v0.1)

- **Editing the graph.** No node drag-pin persistence, no manual edge creation, no review queue. The graph reflects state; mutations happen through reading signals.
- **Time-travel.** No "show graph as of date X" — just current state.
- **Ontology maintenance.** No rename/retype/merge/split in the graph.
- **Cross-workspace graphs.** Graph is workspace-scoped (matches wiki_pages scope).

---

## Acceptance Criteria

1. **Route**: `/graph` renders the 3D Paper Map as the main canvas. ✅
2. **Data fetch**: `useWorkspaceGraph(workspaceId, "papers")` calls `GET /api/v1/workspaces/:wsId/graph?view=papers`. ✅
3. **Nodes**: papers are nodes; node size reflects connectedness/concept count. ✅
4. **Edges**: paper links use stable persisted graph evidence and hysteresis. ✅
5. **Click node/link**: opens read-only detail/evidence sheet. ✅
6. **No editing**: no graph edit/review controls. ✅
7. **Empty/loading/error**: render graph-specific states. ✅
8. **Performance**: ongoing polish; 3D layout is intentionally not persisted yet. ⏳
9. **Concept Lens handoff**: Lens consumes Paper Map evidence for related papers instead of recomputing links. ✅ TASK-027 checkpoint

---

## Backend

### New endpoint: `GET /api/v1/workspaces/:wsId/graph`

```ts
// Response shape, simplified
{
  workspaceId: string
  view: "papers"
  graph: {
    nodeCount: number
    edgeCount: number
    nodes: Array<{
      id: string
      label: string
      paperId: string
      title: string
      conceptCount: number
      degree: number
      topConcepts: Array<{ id: string; displayName: string; kind: string }>
    }>
    edges: Array<{
      id: string
      source: string
      target: string
      edgeKind: string
      weight: number
      status?: "active" | "stale"
      isRetained?: boolean
      hasReaderNoteEvidence?: boolean
      topEvidence: Array<{
        sourceConceptName: string
        targetConceptName: string
        rationale: string | null
        sourceEvidenceBlockIds: string[]
        targetEvidenceBlockIds: string[]
      }>
    }>
  }
}
```

Implementation in `apps/api/src/routes/graph.ts`. Builds:

- Paper nodes from workspace papers.
- Paper-paper edges from confirmed concept and semantic evidence.
- Stable edge lifecycle from `workspace_paper_graph_edges`.
- Stable snapshots from `workspace_paper_graph_snapshots`.

This card should not infer graph structure from wiki prose. It reads the compiled concept/evidence substrate and persisted Paper Map lifecycle.

---

## Frontend

### `/graph` route

```tsx
// apps/web/src/routes/graph.tsx (TanStack Router)
export const Route = createFileRoute("/graph")({
  component: GraphPage,
})
```

### Components

- `apps/web/src/components/graph/WorkspaceGraphView.tsx` — 3D force Paper Map canvas plus compact paper/edge sheets.
- `apps/web/src/api/hooks/graph.ts` — TanStack Query hook for the endpoint.

### Visualization configuration

Use `react-force-graph-3d` as the renderer. Map backend `PaperGraphPayload` directly to `{ nodes, links }`.

- node id: paper graph node id
- link source/target: paper graph edge source/target
- node size: degree + concept count
- node color: deep blue-green, with brighter hover/selected state and gray out-of-focus state
- link color: restrained gray/near-black, with selected/neighbor emphasis
- link width: relationship strength, capped low enough to avoid visual clutter

Do not add layout persistence yet. The graph is a viewing surface, not an editing surface.

---

## Risks

1. **WebGL / bundle cost.** Keep the graph route code-split. Verify `/reader` does not pay for 3D graph dependencies.

2. **Node count vs readability.** A workspace with 500 nodes is dense and looks like a hairball at default zoom. Provide a zoom-to-node action on click and a "fit" button that resets to graph-level view. If hairball persists, the right answer is filters and graph layering, not a different library.

3. **Edge derivation accuracy.** Edges should come from TASK-020D's explicit inner-paper and cross-paper relation substrate, not from substring matching over prose.

4. **Stale graph when concepts update.** Paper Map uses persisted stable snapshots; background refresh and query invalidation should update the observation point without causing link churn.

5. **Mobile.** 3D graph viewing is best-effort. Reader Concept Lens should remain the primary mobile-friendly surface.

6. **Color-blind users.** Three node colors that need to be distinguishable: the doc picks neutral / warm-30° / accent-teal-195°. They're chosen for contrast in oklch space but verify with a deuteranopia simulator before shipping.

---

## Open questions

- **Camera defaults.** Tune default camera distance and zoom-to-fit behavior once real workspaces grow past 100 papers.
- **Layout persistence.** Do not add until users explicitly need stable spatial memory.
- **Neighborhood entry from Lens.** Future polish can add an "Open neighborhood" affordance from reader Lens to `/graph` if it proves useful.

---

## Testing strategy

- **API route test**: seed a workspace with papers, concepts, semantic candidates, and graph snapshot rows; assert paper nodes/edges/evidence return.
- **Edge lifecycle correctness**: verify create/keep/stale/supersede thresholds.
- **Canvas integration**: mock `react-force-graph-3d`; assert node/link data, styling callbacks, click callbacks, and compact sheets.
- **Click → inspect**: click a node/link; assert paper/evidence sheet content.
- **No tests for layout convergence.** Visual layouts are inherently subjective; test data shape and interaction, not exact coordinates.

---

## References

- **react-force-graph-3d / Three.js docs** — current graph rendering stack.
- **DESIGN_TOKENS.md §2.6** — graph color tokens.
- **TASK-020 / TASK-020D** — produce local concept nodes, inner-paper edges, cross-paper clusters, and evidence-backed links.
- **PRD §1** — Zettelkasten thesis; the graph is the most legible UX of that thesis.

---

## Report Back

When done, append to `docs/tasks/README.md`:

| TASK-021 | Read-only Paper Map observation point | ~3 days | TASK-020 | ✅ done |

Plus a screenshot or two — this is the most photogenic surface in the whole app and worth a record for the project README.

---

*Drafted 2026-04-29 and updated 2026-05-01. Implementation starts only after TASK-020 has enough real local concepts and edges to expose genuine graph readability problems rather than synthetic toy layouts.*
