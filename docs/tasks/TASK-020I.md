# TASK-020I: Paper graph from concept evidence

**Status**: Implemented foundation / checkpoint ready  
**Depends on**: TASK-020F, TASK-020G, TASK-020H  
**Phase**: 3 — Zettelkasten Output

---

## Decision

`/graph` should default to a **paper graph**, not a concept graph.

Sapientia users read papers. The graph page should therefore answer:

> "How are the papers in my workspace connected?"

Concepts are still central, but they are the evidence layer behind paper-paper edges:

```text
paper blocks
  -> paper-local concept atoms
  -> source-level concept descriptions
  -> incremental embeddings + LLM judgement
  -> paper-paper edge evidence
  -> paper graph
```

The existing concept graph remains useful as:

- inner substrate
- debug/admin view
- optional drill-down from a paper edge
- Concept Lens context inside the reader

It should not be the default `/graph` surface.

---

## Product Model

### Node

Each node is a paper.

Recommended fields:

- `paperId`
- `title`
- `authors`
- `year`
- `venue`
- `summaryStatus`
- `conceptCount`
- `readerSignalCount`
- `lastReadAt` / recent activity when available

Visual mapping:

- node size: concept count / degree-derived graph weight
- node color: design-token graph source color (`--graph-node-source`) for paper nodes
- node label: hidden on canvas by default; selected paper metadata appears in the inspector

### Edge

Each edge connects two papers.

Edges are built by aggregating concept-level evidence:

- exact shared concept cluster
- LLM-confirmed `same` or `related` concept pairs
- same task / similar method / shared metric

Edges are not merely cosine similarity between paper summaries. They should be explainable through grounded concept evidence.

Recommended edge fields:

- `sourcePaperId`
- `targetPaperId`
- `weight`
- `edgeKind`
  - `shared_concepts`
  - `similar_methods`
  - `same_task`
  - `related_metrics`
  - `semantic_neighbor`
  - `mixed`
- `evidenceCount`
- `strongEvidenceCount`
- `maxSimilarity`
- `avgSimilarity`
- `llmSameCount`
- `llmRelatedCount`
- `llmDifferentCount`
- `topEvidence`

`topEvidence` should contain concept-level explanations:

- source concept name
- target concept name
- source paper title
- target paper title
- kind
- similarity score
- LLM judgement when available
- short rationale
- source-level descriptions
- evidence block IDs
- at most one evidence snippet per side for the inspector

---

## Edge Scoring

Initial scoring should be conservative and reversible.

Suggested formula:

```text
base = 0

+ 1.00 for each exact shared concept cluster
+ 1.00 for each AI-confirmed same concept link
+ 0.80 for each AI-confirmed related concept link

kind modifier:
+ 0.25 for method/task matches
+ 0.10 for metric matches
+ 0.00 for broad concept matches

edge weight = normalized aggregate score
```

Semantic-link thresholds:

- embedding similarity `>= 0.70`: insert new candidate pair and send to LLM judgement
- LLM decision in `same` / `related` and confidence `>= 0.80`: keep as confirmed concept link
- all other LLM outcomes: hide from the reader-facing graph

Paper graph display threshold:

- show paper-paper edge if aggregate paper edge score `>= 0.70`

These thresholds should be tuned on real workspaces, but the principle should remain: embedding recalls promising pairs, LLM promotes conservatively, graph displays only confirmed links. Refresh is incremental: new papers generate new concepts, new concepts create new high-similarity pairs, and old pair decisions remain stable.

---

## API

Add or evolve graph API so `/graph` can fetch paper graph payloads.

Recommended endpoint:

```http
GET /api/v1/workspaces/:workspaceId/graph?view=papers
```

Default behavior:

- `/graph` frontend calls `view=papers`
- concept graph remains available through `view=concepts` or a separate debug route

Payload shape:

```ts
type WorkspacePaperGraphPayload = {
  workspaceId: string
  graph: {
    nodeCount: number
    edgeCount: number
    nodes: PaperGraphNode[]
    edges: PaperGraphEdge[]
  }
}
```

The API may compute v1 edges dynamically from existing tables. A persisted paper-edge table can be added later if needed for performance.

---

## UI

The default `/graph` page should show paper nodes and paper-paper edges.

Graph inspector should support:

- selected paper
  - paper metadata
  - top concepts
  - connected papers sorted by edge strength
  - recent/important notes when available
- selected paper edge
  - why these papers are connected
  - top shared/related concepts
  - grouped evidence by kind
  - source-level description for each side of the concept pair
  - one evidence snippet per side when available
  - jump links back to paper blocks

Canvas interaction policy:

- Do not render paper titles directly on the graph canvas.
- Clicking a node updates the inspector; the canvas remains a structural map, not a label cloud.
- Nodes can be freely dragged to improve local readability.
- Edge width maps to paper-edge weight through `--graph-edge-width-min` and `--graph-edge-width-max`.
- Colors must come from graph design tokens:
  - `--graph-node-source`
  - `--graph-node-concept`
  - `--graph-node-entity`
  - `--graph-node-method`
  - `--graph-node-task`
  - `--graph-node-metric`
  - `--graph-edge-default`
  - `--graph-edge-active`

The graph should avoid showing all weak semantic candidates as visible edges. Weak candidates belong in debug/LLM judgement flows, not the reader-facing graph.

---

## Concept Graph Relationship

The current concept graph should be demoted to:

- optional "Concept Map" mode
- developer/debug surface
- edge drill-down visualization
- reader-local Concept Lens context

This keeps Sapientia's philosophy intact:

- the user reads papers
- AI compiles concepts
- concept structure explains paper relationships
- users are not asked to browse or maintain ontology as the main product loop

---

## Acceptance Criteria

1. `/graph` defaults to paper nodes.
2. Paper-paper edges are derived from concept evidence, not raw paper-summary similarity alone.
3. Edge inspector explains every connection with grounded concept evidence.
4. Only LLM-confirmed semantic links contribute to graph edges.
5. Weak candidates are hidden from the default graph.
6. Existing concept graph remains accessible as a secondary/debug view.
7. No candidate relation irreversibly merges concept clusters.
8. Tests cover exact shared concepts, embedding candidates, LLM judgement modifiers, and hidden weak candidates.

---

## Implementation Snapshot — 2026-05-03

Implemented:

- `GET /api/v1/workspaces/:workspaceId/graph` now defaults to `view=papers`.
- `GET /api/v1/workspaces/:workspaceId/graph?view=concepts` keeps the existing concept graph as secondary/debug mode.
- Paper graph nodes are workspace papers with title, authors, year, venue, summary status, concept count, degree, and top concepts.
- Paper graph edges are computed dynamically from:
  - exact shared workspace concept clusters
  - LLM-confirmed semantic concept links
- Edge evidence includes concept names, kinds, match method, similarity, LLM decision, rationale, and source-level descriptions.
- Edge evidence now carries source/target paper IDs, evidence block IDs, and at most one evidence snippet per side.
- `/graph` frontend now requests `view=papers` and renders the paper map by default.
- Graph inspector now has paper-node and paper-edge modes.
- Paper node inspector shows paper metadata, top concepts, and connected papers.
- Paper edge inspector explains connections with concept pair names, source-level descriptions, LLM decision/confidence, rationale, evidence snippets, and jump links.
- Paper edge evidence can jump back to `/papers/:paperId?blockId=:blockId`, and the reader auto-selects/scrolls to that block once blocks load.
- Graph canvas uses Sigma + Graphology + d3-force.
- Nodes can be dragged.
- Canvas node labels are hidden by design; metadata is inspector-only.
- Edge width maps to edge strength.
- Graph colors are aligned with design tokens from `apps/web/src/index.css` and `docs/DESIGN_TOKENS.md`.
- Concept graph UI remains available through the API and the existing concept inspector path.
- API tests cover default paper graph generation and secondary concept graph behavior.
- Web tests cover paper graph rendering and edge evidence inspection.

Current v1 limits:

- Paper edges are computed live from concept/semantic candidate tables; no persisted paper-edge table yet.
- Edge kind is a single dominant label (`mixed` when evidence kinds differ).
- The default paper graph should hide raw embedding candidates. Embedding is recall only; LLM confirmation is the graph gate.
- Paper edge block jumps currently open the first evidence block for each side of an evidence pair; richer multi-block evidence browsing can come later.
- Concept graph mode is API-accessible but not yet exposed as an explicit UI toggle.
- There is no graph quality audit script by design for this checkpoint; edge quality will be tuned from real user-visible samples when needed.

Next refinements:

- Add multi-block evidence browsing for evidence items with several supporting blocks.
- Decide whether to persist paper-paper edges for large workspaces.
- Add a visible Concept Map/debug toggle after the paper graph interaction stabilizes.
- Add LLM judgement aggregation fields (`llmSameCount`, `llmRelatedCount`, `llmDifferentCount`) if paper edge explanations need stronger auditability.
- Tune edge density only after real workspace samples show the current thresholds are too loose or too strict.

---

## Open Questions

- Should paper graph edges be computed live or persisted?
- Should LLM judgement be required before a semantic candidate becomes a visible paper edge?
- Should paper graph edge kinds be single-label (`similar_methods`) or multi-label?
- What minimum evidence count prevents noisy edges in large workspaces?
- Should user highlights/notes increase paper edge weight when they touch connecting concepts?
