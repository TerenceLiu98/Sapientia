# TASK-020D: Inner-paper graph edges + cross-paper synthesis + global concept clusters + concept-first retrieval substrate

**Estimated effort**: 2-3 working days  
**Depends on**: TASK-020A, TASK-020B, TASK-020C (optional but helpful), enough real papers to expose duplication/alias problems  
**Phase**: 3 — Zettelkasten Output (corpus-level layer)
**Status**: In Progress — inner-paper edge layer implemented; cross-paper clustering/retrieval substrate still pending

---

## Goal

Move from paper-local knowledge to graph-structured knowledge, then to corpus-level knowledge:

- add explicit inner-paper concept edges on top of local concept nodes
- merge or link related local concepts across papers into global concept clusters
- use paper-local source-level meanings to disambiguate same-name concepts and cluster different-name concepts
- preserve evidence grounding
- prepare the substrate for `query → concept → block evidence`

This is the step where Sapientia stops being only a set of paper-local summaries/concepts and becomes a true graph-backed personal research corpus.

---

## Current implementation checkpoint

The first slice of `020D` now exists in engineering:

- migration: `packages/db/migrations/0024_inner_paper_concept_edges.sql`
- schema: `packages/db/src/schema/compiled-local-concept-edges.ts`
- queue: `apps/api/src/queues/paper-inner-graph-compile.ts`
- worker: `apps/api/src/workers/paper-inner-graph-compile.worker.ts`
- service: `apps/api/src/services/concept-graph.ts`
- prompt: `packages/shared/src/prompts/wiki-extract-inner-graph-v1.ts`
- tests: `apps/api/src/services/concept-graph.test.ts` and graph-related route coverage
- graph API: `GET /api/v1/workspaces/:workspaceId/papers/:paperId/concept-graph`
- web hook: `usePaperConceptGraph(workspaceId, paperId)`
- reader surface: `PaperConceptGraphPanel`

Current runtime flow:

1. `paper-compile-v1` creates local concepts from parsed blocks.
2. `paper-summarize.worker.ts` enqueues `paper-concept-refine`.
3. The same worker also enqueues `paper-inner-graph-compile` for each workspace linked to the paper.
4. `compilePaperInnerGraph()` loads existing local concepts and parsed blocks.
5. It sends only core graph-visible concepts to the relation prompt.
6. It persists sanitized edges and edge evidence.

This means the implemented part of `020D` is currently:

- inner-paper concept edges
- edge evidence grounding
- core-node filtering
- graph output sanitization
- paper-local graph API payload with Cytoscape-ready `nodes` and `edges`
- first reader-visible graph panel that does not expose the source-page summary
- graph evidence chips that jump back to original reader blocks

Still not implemented:

- cross-paper alias clustering
- global concept clusters
- concept-first retrieval API
- corpus-level retrieval ranking
- polished TASK-021 user-facing graph surface and interaction model

---

## Scope

### In scope

- inner-paper concept graph edges
- conservative relation extraction among already-compiled local concepts
- cross-paper alias clustering
- conservative merge / keep-separate decisions
- global concept clusters
- links between related concepts across papers
- source-level meaning comparison across local concept atoms
- retrieval-oriented substrate for concept-first lookup

### Explicitly NOT in scope

- embeddings-first retrieval stack
- polished end-user search UX
- graph UI itself (that belongs to TASK-021)

---

## Design rule

Graph construction and synthesis must stay:

- conservative
- reversible where possible
- evidence-grounded

It is better to omit a weak edge or keep two concepts separate than to invent structure too aggressively.

---

## Canonical model

### Node model

Inner-paper graph nodes come from `020A` local concept/entity extraction, but the first graph surface should default to the core knowledge layer only.

For cross-paper work, each local node should be treated as a **paper-local concept atom**, not just a term string. The important comparison unit is:

```text
canonicalName
kind
sourceLevelMeaning
evidence blocks
user marginalia / Q&A signal summary
inner-paper graph neighborhood
```

`sourceLevelMeaning` answers:

> "What does this concept mean in this paper?"

This is required because:

- same display names can have different meanings across papers
- different display names can describe the same research idea
- user comments may clarify local meaning after upload-time extraction
- cross-paper clustering should compare meanings, not names alone

Core graph-visible taxonomy for the first pass:

- `concept`
- `method`
- `task`
- `metric`

Supporting extracted-but-not-default-visible kinds:

- `dataset`
- `person` (authors only)
- `organization` (author affiliations only)

`020D` should not invent new node kinds. It should only add graph structure around the extracted substrate.

Default graph rule:

- inner-paper and cross-paper graph construction should focus on the **core** kinds first
- supporting kinds may be stored, filtered, or attached as metadata
- supporting kinds should not automatically become primary graph nodes in the initial UX unless later evidence shows they improve readability

### Edge model

`020D` should add a new paper-local edge layer between already-extracted local concepts.

Recommended first-pass edge types:

- `addresses`
  - typically `method -> task`
- `uses`
  - typically `method -> concept`
- `measured_by`
  - typically `task -> metric` or `method -> metric`
- `improves_on`
  - typically `method -> method`
- `related_to`
  - conservative fallback when relation is clearly present but more specific typing is weak

Every edge must carry:

- `sourceConceptId`
- `targetConceptId`
- `relationType`
- `evidenceBlockIds`
- optional `confidence`

No evidence means no edge.

Current persisted tables:

- `compiled_local_concept_edges`
- `compiled_local_concept_edge_evidence`

Current edge uniqueness:

- `(ownerUserId, workspaceId, paperId, sourceConceptId, targetConceptId, relationType)`

Current integrity checks:

- source and target cannot be the same concept
- edge evidence references an existing `(paperId, blockId)`
- confidence must be null or between `0` and `1`

### Output normalization

Real JSON-mode model outputs can drift from the ideal prompt shape, so the service normalizes common aliases before validation and persistence.

Supported root aliases include:

- `edges`
- `relations`
- `relationships`
- `links`
- `graphEdges`
- `graph_edges`

Supported edge aliases include:

- `sourceCanonicalName`, `source_canonical_name`, `source`, `sourceName`, `source_name`, `from`
- `targetCanonicalName`, `target_canonical_name`, `target`, `targetName`, `target_name`, `to`
- `relationType`, `relation_type`, `type`, `relation`, `label`
- `evidenceBlockIds`, `evidence_block_ids`, `evidenceBlocks`, `evidence_blocks`, `blockIds`, `block_ids`, `evidence`, `references`

Relation aliases are normalized into the canonical relation set:

- `solves`, `targets`, `tackles` → `addresses`
- `use`, `utilizes`, `employs`, `depends_on`, `requires` → `uses`
- `evaluated_by`, `measured_using`, `evaluated_using` → `measured_by`
- `outperforms`, `extends` → `improves_on`
- unknown but otherwise valid relation labels → `related_to`

Endpoint matching uses both `canonicalName` and `displayName`, because models often copy the visible concept label rather than the normalized canonical form.

### Salience rule

`020B` salience signals should affect:

- default ranking
- default expansion order
- node emphasis
- future retrieval prioritization

They should **not** change canonical graph structure.

In other words:

- `020A` defines nodes
- `020D` defines edges and cross-paper cluster structure
- `020B` adjusts weights, not topology

---

## Suggested outputs

- inner-paper local concept edges
- cross-paper concept links
- alias sets / canonical clusters
- source-level meaning summaries for global clusters
- merge / related / keep-separate rationales
- explicit global concept cluster records
- merged salience and evidence summaries
- retrieval-friendly indices that support:
  - query → global concept cluster candidates
  - global concept cluster → local concept nodes
  - local concept nodes → evidence blocks

This does not need to be a full search product yet; it needs to make that product possible.

---

## Worker flow

```
1. Gather paper-local concepts for a paper.
2. Extract only the strongest inner-paper relations among those existing nodes.
3. Persist paper-local graph edges with evidence.
4. Gather compiled concepts across papers.
5. Build candidate clusters from names, aliases, kinds, embeddings, and source-level meanings.
6. Use LLM disambiguation when local meanings or graph neighborhoods conflict.
7. Persist one of three outcomes: merge, related, or keep-separate.
8. Merge or link concepts conservatively into global concept clusters.
9. Persist graph-ready and retrieval-ready substrate.
```

This pass should not run until enough real corpus density exists.

### Inner-paper extraction rule

The relation pass should operate on:

- parsed paper blocks
- paper metadata if useful
- already-compiled local concepts/entities

It should **not** re-open node extraction from scratch.  
Node extraction stays in `020A`; `020D` only connects the existing nodes.

### First-pass output shape

Recommended v1 behavior:

- do not hard-cap graph nodes from `020A`
- do not hard-cap persisted inner-paper edges
- let the graph UI choose default top-N / filtering later
- at most `2` evidence blocks per edge
- no requirement that the graph be fully connected

This preserves structure at compile time while keeping the UI free to make readability decisions later.

Current implementation:

- `MAX_EDGE_EVIDENCE_BLOCK_IDS = 2`
- core graph nodes are restricted to `concept | method | task | metric`
- `/concept-graph` returns only the default graph-visible core kinds as nodes.
- `/concept-graph.visibility.supportingNodeKinds` advertises `dataset | person | organization` as stored-but-hidden support kinds for future UI toggles.
- `/concept-graph.graph.nodes[]` includes `degree`, salience fields, and `evidenceBlockIds` so the client can size/filter nodes without recomputing from the debug wiki payload.
- `/concept-graph.graph.edges[]` includes both Cytoscape-friendly `source`/`target` and explicit `sourceConceptId`/`targetConceptId`.
- `PaperConceptGraphPanel` is collapsed by default in the reader and expands into a Cytoscape view plus an evidence inspector.
- selecting a graph node or edge reveals its evidence block ids; clicking an evidence chip jumps back into the paper reader.
- the first reader panel includes kind/relation filter chips and a Top Concepts list, so graph navigation does not depend only on force-layout visual scanning.

---

## Acceptance Criteria

1. A paper with compiled local concepts can produce a conservative inner-paper graph edge set.
2. Every persisted edge remains grounded in block evidence.
3. Repeated concepts across papers can be merged or linked conservatively.
4. Merged/fused concepts remain grounded in block evidence.
5. Same-name concepts with different source-level meanings can be kept separate.
6. Different-name concepts with similar source-level meanings can become merge or related candidates.
7. The resulting substrate supports the future direction:
   `query → global concept cluster → local concept nodes → evidence blocks`.
8. The graph layer in TASK-021 can consume this substrate without inventing structure client-side.
9. Tests cover:
   - clear inner-paper edge case
   - no-edge / weak-edge omission case
   - clear merge case
   - clear keep-separate case
   - same-name / different-meaning case
   - different-name / similar-meaning case
   - evidence integrity after merge/link

---

## Risks

1. **False inner-paper edges**
   - concept co-occurrence may tempt the model to invent weak relations
2. **False merges**
   - similar names may hide genuinely different concepts
3. **Corpus sparsity**
   - too few papers make synthesis look smarter than it is
4. **Retrieval overreach**
   - trying to build final search UX here would bloat the card

---

## Handoff to TASK-021

After this card, TASK-021 can treat the concept substrate as stable enough to visualize:

- local concept nodes
- inner-paper edges
- global concept clusters
- evidence-backed navigation paths
