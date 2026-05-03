# TASK-021: Concept graph view (Sigma.js / Graphology)

**Estimated effort**: 2-3 working days
**Depends on**: TASK-020 umbrella, practically at least TASK-020D (local concepts + global concept clusters + cross-paper links)
**Phase**: 3 — Zettelkasten Output (closing card; UX-heavy, architecturally simple)
**Status**: in progress — first workspace graph slice shipped behind `/graph`

---

## Context

TASK-020 produces the data — local concept nodes, global concept clusters, paper wiki/source pages, and the references between them. TASK-021 makes the **concept graph** visible.

Important product rule:

- `020A`'s paper wiki / source page is a compiled summary artifact
- that artifact remains primarily agent-facing
- the user-facing Phase 3 surface should foreground **concepts + evidence**, not a standalone summary-reading page

So TASK-021 is now the first intended user-facing Phase 3 page.

The graph isn't decorative. It's the answer to "what have I been reading about?", "which authors keep showing up across my papers?", "where does this idea connect to others I've marked?" Sapientia's product claim is that accumulated marginalia compounds into a survey of the reader's own thinking. The graph is the surface where that claim is most legible.

Tech stack direction has changed from the first-pass **Cytoscape.js** implementation to an Atomic-inspired graph stack:

- **Sigma.js** as the primary high-performance renderer for the user-facing workspace graph.
- **Graphology** as the in-memory graph data model for nodes, edges, attributes, filtering, and derived projections.
- **d3-force** as the initial force-layout engine when server-side/stored positions are absent.
- **react-zoom-pan-pinch** for surrounding canvas/panel interactions where Sigma's built-in camera is not enough.

Cytoscape.js remains acceptable for existing debug panels until they are migrated or removed. The user-facing `/graph` surface should move to Sigma/Graphology because the Sapientia graph is becoming a large, evolving concept substrate rather than a small debug visualization.

### Scope

- A single `/graph` route showing the workspace's compiled concept graph.
- Nodes: concept surfaces derived from TASK-020's compiled substrate, colored per `--graph-node-*` tokens.
  - first-pass default visible kinds should be the core graph layer:
    - `concept`
    - `method`
    - `task`
    - `metric`
  - supporting kinds such as `dataset`, author-level `person`, and author-affiliation `organization` may exist in the substrate but should not automatically appear as primary graph nodes in v0.1
- Edges: derived from inner-paper and cross-paper concept relationships emitted by TASK-020D.
- Clicking a concept node opens the best available concept/evidence surface for that concept.
- It may optionally expose supporting summary context later, but should not require users to read a standalone AI summary page.
- Filters: by concept kind/subtype, by recency when useful.
- A readable force/layout strategy, without turning this into a node-editor product.

### Implementation status (2026-05-02)

Shipped first pass:

- `GET /api/v1/workspaces/:workspaceId/graph` in `apps/api/src/routes/graph.ts`.
- `useWorkspaceGraph()` in `apps/web/src/api/hooks/graph.ts`.
- `/graph` route in `apps/web/src/routes/graph.tsx`.
- Left nav `Graph` entry now links to `/graph`.
- `WorkspaceGraphView` renders a Cytoscape canvas plus an evidence-first inspector.
- Clicking a node/top concept opens paper-specific cluster members, not a standalone wiki summary page.
- The graph now consumes `workspace_concept_clusters` from TASK-020F as primary nodes.

Package baseline added:

- `sigma`
- `graphology`
- `d3-force`
- `react-zoom-pan-pinch`
- `@types/d3-force`

Intentional first-pass boundaries:

- Nodes are workspace concept clusters from TASK-020F, filtered to core graph kinds: `concept`, `method`, `task`, `metric`.
- Supporting kinds (`dataset`, author-level `person`, author-affiliation `organization`) remain available in the substrate but are not primary visible graph nodes yet.
- Edges are currently persisted local inner-paper concept edges projected onto workspace concept clusters.
- Semantic/LLM cross-paper fusion beyond deterministic canonical-name grouping is not implemented yet.
- Filter chips and URL query state are deferred until the graph has enough real data to reveal the right filter model.
- No graph response cache yet; add only if dogfooding shows repeated refresh cost.

### Explicitly NOT in scope (v0.1)

- **Editing the graph.** No node drag-pin, no manual edge creation. The graph reflects state; mutations happen via marginalia + wiki ingestion.
- **3D layouts, WebGL effects, animation budgets.** Default Sigma renderer is enough for the corpora we'll see in v0.1 (≤ ~500 nodes).
- **Time-travel.** No "show graph as of date X" — just current state.
- **Graph algorithms beyond layout.** No community detection, no centrality scores, no PageRank. UX-style filtering only.
- **Cross-workspace graphs.** Graph is workspace-scoped (matches wiki_pages scope).

---

## Acceptance Criteria

1. **Route**: `/graph` renders a graph filling the main pane. ✅ first pass uses Cytoscape; next pass migrates to Sigma.
2. **Data fetch**: a single `useWorkspaceGraph()` hook calls `GET /api/v1/workspaces/:wsId/graph` and returns nodes + edges in UI-friendly JSON. ✅
3. **Nodes**: one per visible paper-local concept surface. Color by kind. ✅ first pass
4. **Edges**: concept relationships produced by TASK-020D. Edge color via `--graph-edge-default`. ✅ first pass
5. **Click node**: opens the source paper for that concept. ✅ first pass
6. **Filter chips**: above the canvas, toggles for concept kinds/subtypes. Filter state in URL query so the view is shareable. ⏸ deferred
7. **Empty state**: when there are <2 concepts, render a friendly forming-state message instead of an empty canvas. ✅
8. **Performance**: graph with 500 nodes + 2000 edges renders in <500ms on a current laptop, scrolls/zooms smoothly. ⏳ not yet benchmarked
9. **Tests**: API route returns expected shape; node-click/router behavior covered. ✅ first pass mocks Cytoscape; next pass should mock Sigma/Graphology adapter.

---

## Backend

### New endpoint: `GET /api/v1/workspaces/:wsId/graph`

```ts
// Response shape, simplified
{
  workspaceId: string
  visibility: {
    defaultNodeKinds: ["concept", "method", "task", "metric"]
    supportingNodeKinds: ["dataset", "person", "organization"]
  }
  graph: {
    nodeCount: number
    edgeCount: number
    relationCounts: Record<string, number>
    nodes: Array<{
      id: string
      conceptId: string
      label: string
      kind: string
      canonicalName: string
      paperId: string
      paperTitle: string | null
      salienceScore: number
      highlightCount: number
      noteCitationCount: number
      degree: number
      evidenceBlockIds: string[]
    }>
    edges: Array<{
      id: string
      source: string
      target: string
      sourceConceptId: string
      targetConceptId: string
      paperId: string
      relationType: string
      confidence: number | null
      evidenceBlockIds: string[]
    }>
  }
}
```

Implementation in `apps/api/src/routes/graph.ts`. Builds:

- The relevant concept-layer nodes from TASK-020.
- Cross-paper cluster/local-node relationships if exposed.
- Any typed concept edges persisted by TASK-020.

This card should not need to infer graph structure from wiki prose if the compiled concept substrate already exists.

Cache the response per (workspaceId, lastWikiPageUpdatedAt) for 60s only if repeated refresh cost becomes visible in dogfooding.

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

- `apps/web/src/components/graph/WorkspaceGraphView.tsx` — Cytoscape renderer + right inspector in one first-pass component.
- `apps/web/src/components/graph/GraphFilters.tsx` — deferred. Reads/writes URL query.
- `apps/web/src/components/graph/GraphLegend.tsx` — deferred. Small legend showing node-color → type mapping.
- `apps/web/src/api/hooks/graph.ts` — TanStack Query hook for the endpoint.

### Cytoscape configuration

Use Cytoscape's layout system with a conservative first-pass layout such as `cose` or `fcose`. Run the layout on data load, then freeze. Do not continuously re-simulate.

```ts
import cytoscape from "cytoscape"

const cy = cytoscape({
  container,
  elements,
  style: [
    // node + edge styles from CSS-token-derived values
  ],
  layout: {
    name: "cose",
    animate: false,
  },
})

cy.on("tap", "node", (event) => {
  const node = event.target
  // final destination depends on the concept/evidence surface chosen at implementation time
})
```

Read CSS vars via `getComputedStyle(document.documentElement).getPropertyValue('--graph-node-source')` so dark-mode swaps automatically on theme toggle. Re-read on a `MutationObserver` listening for `data-theme` changes (cheap, fires only on toggle).

### Theme tokens (already in design doc, ship to index.css)

If not yet present in `apps/web/src/index.css` from TASK-019.1, add the §2.6 graph tokens:

```css
:root {
  --graph-node-source:  var(--color-neutral-500);
  --graph-node-entity:  oklch(0.55 0.110 30);
  --graph-node-concept: oklch(0.50 0.120 195);
  --graph-edge-default: oklch(0.5 0.005 75 / 0.4);
  --graph-edge-active:  var(--color-accent-500);
}
[data-theme="dark"] {
  /* +0.15 lightness on the node oklch values; edge alpha bumped */
}
```

(Confirm during implementation — TASK-019.1 may have shipped these already.)

---

## Risks

1. **Library bundle size.** Cytoscape.js should be lazy-imported via TanStack Router code-splitting so the rest of the app doesn't carry it. Verify in the production bundle output.

2. **Node count vs readability.** A workspace with 500 nodes is dense and looks like a hairball at default zoom. Provide a zoom-to-node action on click and a "fit" button that resets to graph-level view. If hairball persists, the right answer is filters and graph layering, not a different library.

3. **Edge derivation accuracy.** Edges should come from TASK-020D's explicit inner-paper and cross-paper relation substrate, not from substring matching over prose.

4. **Stale graph when wiki updates.** TanStack Query stale time of 60s is probably right; don't put real-time invalidation in v0.1.

5. **Mobile.** Cytoscape.js supports touch interaction, but v0.1 should still ship desktop-first; mobile graph viewing is "best-effort".

6. **Color-blind users.** Three node colors that need to be distinguishable: the doc picks neutral / warm-30° / accent-teal-195°. They're chosen for contrast in oklch space but verify with a deuteranopia simulator before shipping.

---

## Open questions

- **Layout choice.** Start with `cose`; upgrade to `fcose` only if real graph readability demands it.
- **Should the source-paper wiki page be a node, or should the underlying paper be the node?** The current recommendation is: neither should be the primary user-facing destination. The graph should foreground concept-layer nodes; paper/source summary artifacts remain supporting substrate.
- **Edge directionality.** The graph is logically directed for several relation types, but many readers interpret graphs better as lightly-directed or visually softened. Recommendation: keep directed semantics in data, but render arrows subtly.
- **Node sizing.** Currently the API returns `referenceCount` which the frontend can map to node radius. Should also factor in "how many notes cite this page's source"? Defer — sizing by single signal is simpler to read at first.
- **Search/select-by-name.** A search box that filters nodes and zooms to matches. Useful in dense graphs. Defer to v0.2 unless dogfooding shows the bare filter chips aren't enough.

---

## Testing strategy

- **API route test**: seed a workspace with 3 wiki pages and a few wiki_page_references; assert the graph endpoint returns the right node count + edge count.
- **Edge derivation correctness**: feed the page-to-page parser a fixture body referencing two known canonicalNames; assert it produces 2 edges.
- **Filter integration**: render `<GraphCanvas>` with a fixture graph; click each filter chip; assert nodes hide/unhide via Cytoscape filtering/state.
- **Click → navigate**: click a node; assert mocked router navigates to the chosen concept/evidence destination.
- **No tests for layout convergence.** Visual layouts are inherently subjective; test data shape and interaction, not exact coordinates.

---

## References

- **Cytoscape.js docs** — graph/network visualization and interaction model.
- **DESIGN_TOKENS.md §2.6** — graph color tokens.
- **TASK-020 / TASK-020D** — produce local concept nodes, inner-paper edges, cross-paper clusters, and evidence-backed links.
- **PRD §1** — Zettelkasten thesis; the graph is the most legible UX of that thesis.

---

## Report Back

When done, append to `docs/tasks/README.md`:

| TASK-021 | Knowledge graph view | ~3 days | TASK-020 | ✅ done |

Plus a screenshot or two — this is the most photogenic surface in the whole app and worth a record for the project README.

---

*Drafted 2026-04-29 and updated 2026-05-01. Implementation starts only after TASK-020 has enough real local concepts and edges to expose genuine graph readability problems rather than synthetic toy layouts.*
