# TASK-020H: AI-maintained semantic cluster layer

**Estimated effort**: 3-5 working days  
**Depends on**: TASK-020F, TASK-020G  
**Phase**: 3 — cross-paper concept fusion  
**Status**: implemented foundation / checkpoint ready

---

## Goal

Upgrade workspace concept clustering from exact canonical-name grouping to AI-maintained semantic clustering.

The system should find cases like:

```text
"SAE features"
"sparse autoencoder latents"
"interpretable feature directions"
```

and link or cluster them when appropriate, while preserving each paper's local meaning.

The first version should produce **reversible AI-maintained cluster/relationship hypotheses**, not irreversible ontology truth.

---

## Product Principle

Semantic clustering is an AI-maintained background layer, not user-maintained ontology law.

Sapientia should be helpful without becoming overconfident:

- exact canonical-name matches can be auto-clustered
- embedding recall should generate high-quality candidate pairs
- LLM judgement promotes only reliable `same` / `related` links
- explicit user review is not part of the normal workflow

This matters because research terms are slippery. Two papers may use similar language for different objects, or different language for the same object. The product should reveal that tension, not flatten it away.

2026-05-02 product decision:

> Users should not be asked to review or maintain graph clusters as a normal workflow.
> The graph is AI-maintained infrastructure for reading, retrieval, and agent reasoning.
> User action is an override/correction path, not the default cluster formation path.

2026-05-02 semantic-link policy update:

```text
source-level concept descriptions
  -> incremental embedding recall for new/changed concepts with similarity >= 0.70
  -> batched LLM judgement with concept names, short descriptions, and 1 evidence block snippet per side
  -> keep links where decision in ["same", "related"] and confidence >= 0.80
  -> reject the rest as AI-maintained non-links
```

Embedding similarity is recall, not truth. LLM confidence is the promotion gate. Semantic refresh must be incremental: when a new paper produces new concepts, only newly discovered concept pairs above the embedding threshold are sent to LLM judgement. Existing pairs and their `ai_confirmed` / `ai_rejected` status remain untouched unless one side's source-level description changes and its embedding input hash changes.

---

## Scope

### In scope

- Generate semantic representations for local concepts.
- Find candidate matches within a workspace.
- Restrict first-pass candidates to compatible concept kinds.
- Store match method, similarity score, AI decision, confidence, rationale, and provenance.
- Let graph/query/Concept Lens layers use generated semantic relations conservatively.
- Preserve explicit user overrides across regeneration.

### Out of scope

- Full user merge/split UI as a required workflow.
- Cross-workspace clustering.
- Global public ontology.
- Automatic merging across incompatible kinds without explicit confirmation.
- Rewriting source descriptions.
- Reranker stage. Keep the semantic pipeline simple: embedding recall plus LLM judgement.

---

## Current Implementation Snapshot — 2026-05-03

Implemented so far:

- Added `workspace_concept_cluster_candidates`.
- Candidate generation uses local concept `displayName`, `canonicalName`, `kind`, and TASK-020G `sourceLevelDescription`.
- Lexical fallback `matchMethod` is `lexical_source_description`.
- Added `compiled_local_concept_embeddings` with pgvector-backed `embedding`.
- Added separate embedding credentials for API/OpenAI-compatible and local HTTP backends.
- Added concept embedding generation service.
- Added embedding backfill script: `apps/api/scripts/backfill-concept-embeddings.ts`.
- Candidate generation now prefers embedding top-K when embeddings are available, then falls back to lexical/source-description matching.
- Candidate generation is incremental: new pairs are inserted with `on conflict do nothing`; existing candidate, AI-confirmed, and AI-rejected pairs are preserved.
- LLM judgement annotates candidates with `same`, `related`, `different`, or `uncertain`, plus confidence.
- LLM judgement consumes up to 32 candidate pairs per call.
- LLM judgement includes concept names, source-level descriptions, and at most one evidence snippet per side.
- LLM judgement stores `llmConfidence`.
- Promotion policy is implemented:
  - `same` / `related` with confidence `>= 0.80` becomes `ai_confirmed`
  - everything else becomes `ai_rejected`
- LLM judgement should run automatically after semantic refresh when chat credentials exist.
- Candidates are generated after `paper-concept-description` completes.
- Workspace semantic refresh now runs through a dedicated `workspace-semantic-refresh` queue.
- `paper-concept-description` enqueues semantic refresh instead of synchronously running embeddings/candidates.
- Saving embedding credentials enqueues a forced semantic refresh for existing described concepts.
- Backfill script: `apps/api/scripts/backfill-workspace-concept-cluster-candidates.ts`.
- Workspace graph API returns concept semantic candidates in `view=concepts`.
- Default paper graph consumes only AI-confirmed semantic candidates and exact shared clusters.
- Graph inspector no longer asks users to keep/hide semantic candidates.
- Semantic candidates do not mutate exact-name clusters.
- Reader-facing block concept lookup API is available:
  - `GET /workspaces/:workspaceId/papers/:paperId/blocks/:blockId/concepts`
  - returns directly evidenced concepts for the block
  - returns each concept's source-level description and cluster membership
  - returns generated related-concept hints for those clusters

Current implementation is intentionally conservative. Embeddings improve candidate recall, and LLM judgement can annotate semantic relationships, but generated relations must remain reversible and provenance-backed. User review should not be required for the graph to be useful; explicit user decisions are overrides when the AI-maintained layer is wrong.

Operational defaults:

- embedding recall threshold: `>= 0.70`
- LLM promotion threshold: `>= 0.80`
- evidence snippets in LLM judgement: `1` per side
- judgement batch size: up to `32` candidates
- normal generation is incremental and does not delete old decisions

Known deferred improvements:

- LLM judgement concurrency can later be set to `2` if token/cost behavior remains acceptable.
- A persisted paper-edge table may be added later if live graph computation becomes expensive.
- Reranking is intentionally deferred; embedding recall plus LLM judgement is sufficient for the current architecture.

---

## Candidate Inputs

Each local concept should be represented by:

```text
kind
canonicalName
displayName
sourceLevelDescription
top evidence snippets
paper title / abstract-ish context when needed
```

Embedding text template:

```text
Kind: method
Name: Sparse Autoencoder Features
Paper-specific meaning: ...
Evidence: ...
```

Do not embed the full paper. Use the local concept substrate.

---

## Data Model

The current `workspace_concept_cluster_members` table has future-proof fields:

- `matchMethod`
- `similarityScore`

But semantic clustering needs a generated relation/candidate layer before durable cluster membership is changed.

Recommended new table:

`workspace_concept_cluster_candidates`

Fields:

- `id`
- `workspaceId`
- `ownerUserId`
- `sourceLocalConceptId`
- `targetLocalConceptId`
- `sourceClusterId nullable`
- `targetClusterId nullable`
- `kind`
- `similarityScore`
- `llmDecision nullable`
  - `same`
  - `related`
  - `different`
  - `uncertain`
- `decisionStatus`
  - `candidate`
  - `auto_accepted`
  - `ai_confirmed`
  - `ai_rejected`
  - `needs_review`
  - `rejected`
  - `user_accepted`
  - `user_rejected`
- `llmConfidence nullable`
- `rationale text nullable`
- `modelName nullable`
- `promptVersion nullable`
- timestamps

Interpretation note:

- `candidate` / `needs_review` mean "embedding/lexical recalled and not yet promoted", not "the user must review this".
- `ai_confirmed` means "LLM promoted this relation by policy".
- `ai_rejected` means "LLM rejected this relation or confidence was too low".
- `auto_accepted` is legacy-compatible and should be treated like `ai_confirmed` only when needed.
- `user_accepted` / `user_rejected` are explicit overrides and must be preserved across regeneration.
- Product surfaces should avoid `Accept` / `Reject` copy. The normal reader-facing experience is AI-maintained.

Promotion rule:

```text
if llmDecision in ["same", "related"] and llmConfidence >= 0.80:
  decisionStatus = "ai_confirmed"
else:
  decisionStatus = "ai_rejected"
```

LLM prompt input must include at most one evidence block snippet per side. More snippets increase token cost without reliably improving judgement quality.

Batching policy:

- Send up to 32 candidate pairs per LLM judgement call.
- The service should only select candidates without an existing `llmDecision`.
- Candidate generation should return the number of newly inserted pairs, not the number of pairs it rediscovered.

### Embedding storage and search

Recommended default: **Postgres + pgvector**.

pgvector is sufficient for Sapientia's near-term scale because our retrieval target is workspace-local concept atoms, not a web-scale paper corpus. It also keeps vectors beside the relational evidence graph, which matters for filtering by workspace, user, kind, paper, deleted state, and cluster membership.

pgvector supports vector similarity search inside Postgres, including:

- exact nearest-neighbor search by default
- approximate nearest-neighbor search with HNSW or IVFFlat indexes
- cosine distance, L2 distance, inner product, and other distance operators
- ordinary SQL filtering and joins around vector search

Preferred distance:

- use cosine distance for normalized text embeddings
- query with `embedding <=> query_embedding`
- compute similarity as `1 - cosine_distance`

Example retrieval shape:

```sql
select
  e.local_concept_id,
  1 - (e.embedding <=> $query_embedding) as similarity
from compiled_local_concept_embeddings e
join compiled_local_concepts c on c.id = e.local_concept_id
where
  e.workspace_id = $workspace_id
  and e.owner_user_id = $owner_user_id
  and c.kind = $kind
  and c.paper_id <> $source_paper_id
  and c.deleted_at is null
order by e.embedding <=> $query_embedding
limit 20;
```

For very small workspaces, Node-side brute-force cosine can remain a development fallback if pgvector is not installed. That fallback should not become the production path.

Dedicated vector databases such as Qdrant, Chroma, Pinecone, or Faiss are unnecessary until a workspace reaches much larger concept counts or we need cross-workspace/global retrieval. If that happens, preserve the same embedding table as the source of truth and treat the vector DB as a derived index.

Recommended table:

`compiled_local_concept_embeddings`

Fields:

- `id`
- `workspaceId`
- `ownerUserId`
- `localConceptId`
- `embeddingProvider`
- `embeddingModel`
- `dimensions`
- `embedding vector(n)`
- `inputHash`
- `inputTextVersion`
- `createdAt`
- `updatedAt`

Recommended uniqueness:

- unique on `(localConceptId, embeddingProvider, embeddingModel, inputHash)`
- do not assume embeddings from different providers/models/dimensions are comparable

Current index policy:

- use ordinary relational indexes for workspace/provider/model filtering
- use exact pgvector search first
- add HNSW/IVFFlat only after we enforce a fixed active embedding dimension per indexed column

```sql
create extension if not exists vector;

create index idx_compiled_local_concept_embeddings_workspace
on compiled_local_concept_embeddings (
  workspace_id,
  owner_user_id,
  embedding_provider,
  embedding_model
);
```

Do not create `using hnsw (embedding vector_cosine_ops)` on an unbounded `vector` column. Postgres will reject it because the column has no fixed dimensions.

Future HNSW path:

- use one table per active dimension, or
- use a fixed `vector(n)` column after choosing one active embedding model, or
- use expression/partial indexes per model/dimension if we keep a mixed-dimension table

### Embedding backends

Support two backend modes behind one `EmbeddingProvider` interface:

```ts
type EmbeddingProvider =
  | { kind: "openai-compatible"; baseUrl: string; bearerTokenRef: string; model: string }
  | { kind: "local"; endpoint: string; model: string }
```

OpenAI-compatible mode:

- best default for hosted web usage
- works with BYOK and any endpoint that accepts Bearer auth plus `POST /v1/embeddings`
- examples include SiliconFlow, official OpenAI, and OpenAI-compatible proxy endpoints
- users may paste either the API base URL such as `https://api.siliconflow.cn/v1` or the full embeddings URL such as `https://api.siliconflow.cn/v1/embeddings`; the service normalizes the latter to the base URL before calling the AI SDK provider
- should be configured separately from chat model settings

Example:

```bash
curl -X POST https://api.siliconflow.cn/v1/embeddings \
  -H "Authorization: Bearer $SILICONFLOW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": "Hello, world!",
    "model": "Qwen/Qwen3-VL-Embedding-8B"
  }'
```

Local mode:

- best for privacy-sensitive/local workflows
- can be backed by Ollama, sentence-transformers, or a local HTTP embedding server
- may be slower and less consistent, so store provider/model/input hash carefully

Embedding input template:

```text
Kind: {kind}
Name: {displayName}
Canonical name: {canonicalName}
Paper-specific meaning: {sourceLevelDescription}
Evidence hints: {top evidence snippets or empty}
```

Do not embed the full paper. Embed the paper-local concept meaning.

Re-embed when:

- source-level description changes
- kind changes
- canonical/display name changes substantially
- embedding provider/model changes
- input template version changes
- `createdAt`

---

## Algorithm

### First-pass deterministic + semantic hybrid

1. Read all local concepts in a workspace.
2. Exclude deleted concepts.
3. Restrict to graph-visible kinds first:
   - `concept`
   - `method`
   - `task`
   - `metric`
4. Build semantic input from TASK-020G.
5. Current implementation uses embedding retrieval when embedding credentials are configured, and falls back to lexical/source-description similarity otherwise.
6. Embedding retrieval uses pgvector exact nearest-neighbor search for now; approximate indexes can be added once dimensions are fixed per deployment.
7. Drop pairs already matched by exact canonical-name cluster.
8. Persist candidate pairs above a conservative recall threshold as generated candidates.
9. Optionally run LLM judgement only for promising ambiguous pairs.

Embedding retrieval pipeline:

1. Build embedding inputs for concepts with `sourceLevelDescriptionStatus = done`.
2. Upsert embeddings into `compiled_local_concept_embeddings`.
3. For each local concept, query pgvector top-K within:
   - same workspace
   - same owner
   - same `kind`
   - different paper
   - not deleted
4. Exclude pairs already in the same exact-name cluster.
5. Deduplicate unordered pairs.
6. Persist top candidates to `workspace_concept_cluster_candidates` as generated semantic relation hypotheses.

No semantic candidate generation path should irreversibly merge concepts. Embedding and lexical matching are retrieval signals. Promotion into graph/cluster truth must be policy-gated, provenance-backed, and reversible.

Candidate generation should be idempotent. Regeneration can delete and replace generated statuses:

- `candidate`
- `needs_review`
- `auto_accepted`

It must preserve explicit user override decisions:

- `user_accepted`
- `user_rejected`
- `rejected` when produced by explicit correction or admin policy

Current deterministic fallback thresholds:

- `>= 0.48`: generated candidate
- `< 0.48`: ignore

Current embedding thresholds:

- `>= 0.70`: generated candidate and eligible for LLM judgement
- `< 0.70`: ignore for the semantic-link pipeline

These numbers are not final; they must be tuned on real Sapientia papers. Higher scores should influence ranking and promotion policy, not irreversible merging.

### LLM judgement

Use LLM only when embedding similarity is promising enough to matter for the paper graph.

Prompt should ask:

> Are these two paper-local concepts the same research concept, merely related, or different?

Inputs:

- both names
- both kinds
- both source-level descriptions
- 1 evidence block snippet each

Outputs:

```json
{
  "decision": "same" | "related" | "different" | "uncertain",
  "confidence": 0.0,
  "rationale": "..."
}
```

Do not ask the model to rewrite cluster labels in this task.

Current script:

```bash
set -a && source apps/api/.env && set +a
bun apps/api/scripts/judge-workspace-semantic-candidates.ts --workspace <workspace-id> --user <user-id> --limit 12
```

The script processes generated candidates (`candidate` plus legacy `needs_review`) without an existing `llmDecision` unless `--force` is passed.

Current implementation stores:

- `llmDecision`
- LLM confidence and rationale in `rationale`
- judgement model in `modelName`
- `semantic-candidate-judgement-v1` in `promptVersion`

It does not have to modify `decisionStatus` in the current implementation. In the AI-maintained model, a future worker can promote high-confidence generated relations without user review, but must preserve provenance and explicit user overrides.

Implementation note:

- New generation writes `decisionStatus = candidate`.
- Legacy `needs_review` rows remain readable and judgeable for compatibility.
- Concept Lens no longer shows approve/reject controls; it presents related hints as context while reading.
- Graph inspector keeps explicit Keep/Hide override controls for power-user correction.

---

## Cluster Update Policy

First implementation should not aggressively mutate clusters.

Recommended policy:

- exact canonical-name matches stay auto-clustered
- high-confidence semantic pairs become generated related/same/different hypotheses
- graph can optionally show “related concepts” without framing them as user homework
- cluster membership changes only when:
  - confidence is very high and same kind
  - or AI policy explicitly promotes a relation with strong evidence
  - or user explicitly overrides/corrects

This protects against semantic overreach.

---

## UI Impact

Concept Lens can show:

- “Related concepts in other papers”
- candidate target name
- source paper
- target paper
- similarity score
- short rationale when available
- evidence-backed explanation of why this relation appears
- optional correction affordance when the relation is clearly wrong

Concept Lens should not present related-concept candidates as a required review queue. If correction actions exist, they should update explicit override state and should not become a normal reading task.

Graph inspector / Concept Map can additionally show:

- generated relation status
- confidence
- LLM decision
- override state
- provenance and debug metadata

Reader Concept Lens API:

- scoped by `workspaceId`, `paperId`, and `blockId`
- returns only concepts directly evidenced by the current block
- filters to graph-visible concept kinds:
  - `concept`
  - `method`
  - `task`
  - `metric`
- includes source-level descriptions so the reader can inspect meaning without leaving the paper
- includes cluster metadata so the UI can bridge from paper-local concept to workspace-level concept
- includes semantic candidates for those clusters as generated related-context hints

Do not force this into the main graph yet.

The main graph should remain readable; semantic candidates can be:

- dashed edges
- secondary inspector list
- hidden by default until promoted or relevant

---

## Queue / Runtime

Recommended queue:

- `workspace-concept-cluster-candidates`
- Current implementation queue: `workspace-semantic-refresh`

Trigger points:

- after `paper-concept-description` completes
- after embedding credentials are created or changed
- after backfill of descriptions
- after explicit user correction/override changes a concept description or relation
- manually from debug/admin scripts

Concurrency:

- embeddings can be batched
- LLM judgement should be rate-limited and cost-aware
- avoid running full O(N²) across large workspaces without ANN/top-K retrieval

---

## Acceptance Criteria

1. Local concept semantic inputs are generated from TASK-020G fields.
2. Candidate pairs are persisted with similarity and decision status.
3. Exact canonical-name clusters remain unchanged.
4. Candidates do not automatically pollute the primary graph unless explicitly enabled.
5. Concept Lens can expose related concepts without creating a review task.
6. Explicit user corrections are stored as overrides and are preserved across regeneration.
7. Backfill script can generate candidates for existing workspaces.
8. Tests cover thresholding, same-kind restriction, duplicate-pair prevention, and exact-match exclusion.

---

## Risks

- **False merges**: mitigated by generated relation layer, confidence/provenance, and reversible overrides.
- **Embedding model drift**: store model/input hash.
- **Cost explosion**: avoid full pairwise LLM checks.
- **Kind taxonomy errors**: explicit user corrections can retype concepts; semantic clustering should re-run after kind changes.
- **Graph hairball**: semantic candidates should be hidden or dashed, not primary edges.
- **User burden creep**: similar-concept review can become another inbox. Do not require users to process candidates for the graph to work.

---

## Relation to TASK-020F

TASK-020F creates the durable cluster substrate and exact-match grouping.

TASK-020H adds semantic candidate intelligence on top:

```text
020F: local concepts → deterministic workspace clusters
020G: local concepts → paper-specific meanings
020H: meanings → semantic cluster candidates
```
