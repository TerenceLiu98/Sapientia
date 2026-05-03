# TASK-020F: Cross-paper concept clustering

**Estimated effort**: 2-4 working days  
**Depends on**: TASK-020A, TASK-020D, TASK-021  
**Phase**: 2/3 bridge — concept substrate becomes workspace graph substrate  
**Status**: in progress — deterministic cluster substrate shipped

---

## Goal

Turn paper-local concepts into workspace-level concept clusters.

Without this layer, `/graph` is only a bag of local paper concepts. With it, Sapientia can represent:

```text
workspace concept cluster: sparse autoencoder features
  ├─ paper A local concept: Sparse Autoencoder Features
  ├─ paper B local concept: SAE features
  └─ paper C local concept: interpretable feature directions
```

This is the bridge between inner-paper structure and cross-paper understanding.

---

## Product Principle

The cluster is not a wiki article and not an AI summary page. It is an index object:

- it connects similar local concepts across papers
- it preserves paper-specific meanings through members
- it sends the user back to paper evidence
- it supports later comparison of “same/similar term, different paper-level definition”

The user reads papers. The graph helps them traverse concepts back into papers.

---

## Data Model

Implemented first-pass tables:

- `workspace_concept_clusters`
- `workspace_concept_cluster_members`

Cluster fields:

- `workspaceId`
- `ownerUserId`
- `kind`
- `canonicalName`
- `displayName`
- `shortDescription`
- `memberCount`
- `paperCount`
- `salienceScore`
- `confidence`
- status/error/timestamps

Member fields:

- `clusterId`
- `localConceptId`
- `paperId`
- `matchMethod`
- `similarityScore`

`matchMethod` is intentionally future-proof:

- `canonical_name`
- `semantic`
- `llm`
- `user_confirmed`

---

## Implemented

- `packages/db/src/schema/workspace-concept-clusters.ts`
- `packages/db/migrations/0025_workspace_concept_clusters.sql`
- `apps/api/src/services/workspace-concept-clusters.ts`
- `compileWorkspaceConceptClusters({ workspaceId, userId })`
- `paper-concept-refine.worker` refreshes workspace clusters after salience refinement
- `/workspaces/:workspaceId/graph` now returns cluster nodes
- local inner-paper edges are projected into cluster edges
- `/graph` inspector shows cluster members and links back to source papers

Current clustering method:

- normalize `kind + canonicalName`
- group exact normalized matches
- aggregate `memberCount`, `paperCount`, `salienceScore`
- choose the highest-salience member display name as the cluster label

This is intentionally deterministic and cheap, but the schema is designed for semantic/LLM/user-confirmed fusion later.

---

## Next

1. Add source-level short descriptions for local concepts.
2. Generate embeddings over `(canonicalName + displayName + shortDescription + evidence snippets)`.
3. Create semantic candidate pairs within the same `kind`.
4. Use LLM only for uncertain merge decisions, not for every pair.
5. Add user-visible merge/split/retype controls later, probably from the graph inspector or concept review surface.

---

## Acceptance Criteria

1. Workspace clusters persist independently of paper-local concepts. ✅
2. Each local concept belongs to at most one generated cluster. ✅
3. `/graph` uses cluster nodes as the primary graph surface. ✅
4. Cluster inspector shows paper-specific members and links back to source papers. ✅
5. Semantic cross-paper fusion beyond exact canonical matching. ⏳
6. User-confirmed merge/split/retype path. ⏳

---

## Open Questions

- Should `dataset`, author-level `person`, and author-affiliation `organization` be clustered but hidden by default, or should some be visible as supporting nodes?
- Should cluster labels be user-owned once edited, while generated labels keep refreshing?
- Should semantic clustering be a queue job or a synchronous post-refine step? Recommendation: queue job, because embeddings/LLM checks can grow with workspace size.

