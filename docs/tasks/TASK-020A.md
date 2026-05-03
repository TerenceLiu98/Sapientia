# TASK-020A: Upload-time concept/entity extraction + initial wiki projection

**Estimated effort**: 2-3 working days  
**Depends on**: TASK-019 (per-paper summary for source-page synthesis), TASK-014 (paper metadata), parsed `blocks` pipeline  
**Phase**: 3 — Zettelkasten Output (first executable slice of TASK-020)
**Status**: Implemented / hardening on real papers

---

## Goal

Ship the first durable Phase 3 artifact immediately after paper upload:

- a paper wiki / `source` page for the paper
- initial local concept candidates
- block-grounded evidence links

This card intentionally ignores user marginalia. It answers only:

> What does this paper contain?

Not yet:

> What matters to this user about this paper?

---

## Scope

### In scope

- run silently after `paper-parse` through the existing `paper-summarize` queue
- extract local concept candidates from:
  - parsed `blocks`
  - paper metadata when useful
- create or update:
  - paper wiki / `source` page
  - initial local concept projections
  - page references back to `(paperId, blockId)`
- normalize local concept names within a single paper

### Explicitly NOT in scope

- highlights / notes / citations as weighting signals
- agent Q&A signals
- cross-paper merging
- graph UI
- editable wiki pages

---

## Why 020A comes first

This card is the smallest Phase 3 slice that produces a durable knowledge artifact without depending on real user behavior density.

Why it should go first:

- it only depends on already-shipped upload/parse/summary infrastructure
- it proves Sapientia can produce more than chat responses
- it avoids the ambiguity of interpreting highlights or dialogue too early
- it creates the stable substrate that later cards (`020B`, `020C`, `020D`) can refine rather than re-invent

If `020A` is weak, every downstream Phase 3 card gets noisier.

---

## Current implementation checkpoint

The current engineering implementation has moved from a wiki-specific compile step to a paper-level compile step:

- queue name remains `paper-summarize` for compatibility with the existing upload pipeline
- worker implementation is `apps/api/src/workers/paper-summarize.worker.ts`
- service implementation is `apps/api/src/services/paper-compile.ts`
- single-page/small-input prompt is `packages/shared/src/prompts/paper-compile-v1.ts`
- hierarchical map prompt is `packages/shared/src/prompts/paper-compile-window-v1.ts`
- hierarchical reduce prompt is `packages/shared/src/prompts/paper-compile-reduce-v1.ts`
- persisted prompt version is `paper-compile-hierarchical-v1`
- the old `wiki-compile` service path has been removed from the runtime path

Despite the legacy queue name, this job now produces **one combined compile object**:

- `papers.summary`
- one workspace-scoped `wiki_pages` row of type `source`
- `wiki_page_references`
- `compiled_local_concepts`
- `compiled_local_concept_evidence`

This means `020A` is no longer “summary first, wiki compile later.” It is moving toward:

> parsed blocks → adaptive paper compile → summary + source page + local concepts + evidence

After this job completes, the worker enqueues:

- `paper-concept-refine` for `020B` salience
- `paper-inner-graph-compile` for the first slice of `020D`

---

## Compile rule

`020A` should treat **source-page synthesis** and **local concept extraction** as sibling artifacts built from the same parsed paper substrate, not as a parent/child chain.

That means:

- the paper wiki / source page may still use `papers.summary` as an agent-facing summary artifact
- but local concept extraction should be derived from parsed `blocks`, not from summary text

Why:

- summary text is already compressed and selective
- extracting concepts from summary compounds information loss
- summary bias can over-determine which concepts survive

So the intended direction is:

- `blocks (+ metadata)` define the local concept skeleton
- `summary/source page` remains a parallel projection for agent consumption

The first production-oriented refactor has now happened in implementation: summary/source-page synthesis and local concept extraction share the same compile service, but multi-page papers no longer require the whole parsed paper to fit in one prompt. The design rule remains:

> do not treat summary text as the authoritative upstream source for concept extraction

### Long-paper compile rule

Do not build `020A` around an MVP assumption that every paper fits cleanly into one LLM context.

The target architecture must handle long papers without silently truncating the knowledge substrate:

> parsed blocks → section/window compile passes → reduce/merge pass → paper-level source page + concept atoms + evidence

The current single-call `paper-compile-v1` path is an implementation stepping stone and may remain as an optimization for genuinely small papers, but it must not define the product contract.

For long papers, `020A` uses / should continue hardening hierarchical compile:

1. Partition parsed blocks into deterministic sections or overlapping block windows.
2. Extract section-local concept candidates, aliases, evidence block ids, first-seen block ids, and short section summaries.
3. Reduce candidates across sections into paper-local concept atoms.
4. Generate paper-level source summary from section summaries plus the merged concept/evidence substrate.
5. Preserve all evidence links back to original blocks.

Do not split by individual block as the primary unit. A single block is often too local and will overproduce noisy noun phrases. Prefer section boundaries when available; otherwise use stable windows with modest overlap.

Current implementation starts with page-aware windows:

- `buildPaperCompileWindows()` groups blocks by page.
- default primary window size is 2 pages.
- blocks are never split; the full block is included in any window that needs it.
- each window has `primaryBlockIds` and nearby `contextBlockIds`.
- default overlap is 2 context blocks on each side, not a full page.
- window map calls run with per-paper concurrency `4`.
- reduce merges all window artifacts into the existing persisted shape.
- worker completion logs include `compileStrategy` (`single-pass` or `hierarchical`) and `windowCount` so real-paper runs can be audited without inferring the path from prompt ids.

The long-paper path should preserve:

- concepts appearing late in the paper
- methods/tasks/metrics introduced outside the abstract/introduction
- evidence blocks from all sections
- section-specific aliases
- source-level meaning that reflects the whole paper, not only early blocks

---

## Schema boundary

This card should establish the minimum compiled substrate needed by later cards:

- `wiki_pages`
- `wiki_page_references`
- `compiled_local_concepts` or equivalent
- `compiled_local_concept_evidence` or equivalent

Minimum fields needed now:

- canonical name
- display name
- type (`source` for the paper wiki; local concept subtype for concept nodes)
- `paperId`
- source block references
- source-level meaning for each local concept atom
- generation metadata (`generatedAt`, `modelName`, `promptVersion`, `status`)

Do not over-design ontology here.

---

## Schema decision — concept vs wiki

`020A` should treat **local concepts** and **paper wiki pages** as two related but different layers.

### Core rule

- **`compiled_local_concepts` is the structural layer**
- **`wiki_pages` is the presentation layer**

That means:

- local concept records are the substrate later used for:
  - salience refinement
  - cross-paper fusion
  - concept-first retrieval
  - graph projection
- wiki pages are the human-readable projection of that substrate

### Relationship

For `020A`, the simplest relationship is:

- one paper wiki / `source` page per paper
- many local concept nodes per paper
- optional one-to-one or one-to-many projection from local concepts into wiki sub-sections or later concept pages, depending on implementation simplicity

So in practice:

- `paper -> paper wiki / source page`
- `paper -> local concept nodes`
- `local concept -> local concept evidence -> blocks`
- `paper wiki -> wiki_page_references -> blocks`

### Why we split them

If wiki pages become the only durable truth, later cards get boxed in:

- salience can only change prose, not structure
- graph edges become derived from page text instead of stable nodes
- concept-first retrieval becomes harder
- cross-paper merging becomes a page-rewrite problem instead of a node-fusion problem

Keeping the two layers separate lets Sapientia remain:

- graph-ready
- retrieval-ready
- source-grounded
- human-readable

### Practical implication for 020A

`020A` should persist both:

1. **compiled local concept records**
2. **paper wiki projections**

even if the first UI only exposes the wiki page.

### Optional linkage field

It is reasonable for `wiki_pages` to carry an optional `compiledConceptId` or otherwise expose a paper-to-concept relationship:

- null for the main paper wiki / `source` page
- optional for later concept-page projections if those remain separate rows

This is not mandatory if the relationship is represented differently, but the design intent must remain the same:

> paper wiki prose should project concept structure, not replace it as the only truth.

---

## Suggested schema sketch

This is intentionally schematic, not final migration syntax.

### `wiki_pages`

Used as the human-readable projection layer.

Minimum fields for `020A`:

- `id`
- `workspaceId`
- `ownerUserId`
- `type` = `source | entity | concept`
- `canonicalName`
- `displayName`
- `sourcePaperId` (nullable except for `source`)
- `body`
- `generatedAt`
- `modelName`
- `promptVersion`
- `status`
- `error`
- timestamps / soft-delete fields following current repo conventions

### `wiki_page_references`

Used to keep pages visibly grounded.

Minimum fields for `020A`:

- `id`
- `pageId`
- `paperId`
- `blockId`
- `createdAt`

In `020A`, `highlightId` / `noteId` are not required yet because no user marginalia has been incorporated.

### `compiled_local_concepts`

The substrate layer that prevents wiki pages from becoming the only truth.

Minimum fields:

- `id`
- `workspaceId`
- `ownerUserId`
- `paperId`
- `kind` = subtype such as:
  - core knowledge kinds: `concept | method | task | metric`
  - supporting entity kinds: `dataset | person | organization`
- `canonicalName`
- `displayName`
- `aliases` or equivalent normalized alias surface
- `sourceLevelMeaning`
- optional `sourceLevelMeaningEmbedding`
- optional `firstSeenBlockId`
- `lifecycleStatus` such as `candidate | provisional | activated | confirmed | hidden | merged`
- `sourceSummaryVersion` or equivalent generation invalidation signal
- `generatedAt`
- `modelName`
- `promptVersion`
- `status`
- timestamps

### `compiled_local_concept_evidence`

The direct concept→block link layer.

Minimum fields:

- `id`
- `conceptId`
- `paperId`
- `blockId`
- optional `snippet`
- optional `confidence`
- `createdAt`

This card does **not** need:

- cross-paper canonical clusters
- salience score from marginalia
- concept-to-concept graph edges unless they fall out cheaply from extraction

### Source-level meaning rule

Each local concept should eventually store a short source-level meaning:

> "In this paper, X means ..."

This is not a generic encyclopedia description. It is the local interpretation of the concept inside the current paper.

Why this matters:

- same-name concepts can mean different things in different papers
- different names can point to the same underlying idea
- later cross-paper clustering needs semantic comparison, not string matching alone
- user comments and Q&A can refine this meaning over time

Examples:

```text
alignment in Paper A = making LLM outputs match human preferences
alignment in Paper B = matching image and text embeddings
alignment in Paper C = token-level sequence matching
```

These local meanings should become inputs to `020D` cross-paper clustering.

### Minimum schema draft

The following is the recommended minimum draft for `020A`. It is deliberately small and should be preferred over a more ambitious first migration.

```ts
// wiki_pages
{
  id: uuid
  workspaceId: uuid
  ownerUserId: text
  type: "source" | "entity" | "concept"
  canonicalName: text
  displayName: text
  sourcePaperId: uuid | null
  compiledConceptId: uuid | null
  body: text | null
  generatedAt: timestamptz | null
  modelName: text | null
  promptVersion: text | null
  status: "pending" | "running" | "done" | "failed"
  error: text | null
  createdAt: timestamptz
  updatedAt: timestamptz
  deletedAt: timestamptz | null
}

// wiki_page_references
{
  id: uuid
  pageId: uuid
  paperId: uuid
  blockId: text
  createdAt: timestamptz
}

// compiled_local_concepts
{
  id: uuid
  workspaceId: uuid
  ownerUserId: text
  paperId: uuid
  kind: "concept" | "method" | "task" | "metric" | "dataset" | "person" | "organization"
  canonicalName: text
  displayName: text
  aliases: jsonb | null
  sourceLevelMeaning: text | null
  sourceLevelMeaningEmbedding: vector | null
  firstSeenBlockId: text | null
  lifecycleStatus: "candidate" | "provisional" | "activated" | "confirmed" | "hidden" | "merged"
  generatedAt: timestamptz | null
  modelName: text | null
  promptVersion: text | null
  status: "pending" | "running" | "done" | "failed"
  error: text | null
  createdAt: timestamptz
  updatedAt: timestamptz
  deletedAt: timestamptz | null
}

// compiled_local_concept_evidence
{
  id: uuid
  conceptId: uuid
  paperId: uuid
  blockId: text
  snippet: text | null
  confidence: numeric | null
  createdAt: timestamptz
}
```

Recommended uniqueness/index direction:

- `wiki_pages`:
  - unique on `(ownerUserId, workspaceId, canonicalName, type, sourcePaperId?)` with implementation-specific handling for the `source` special case
  - index on `(workspaceId, type)`
- `wiki_page_references`:
  - index on `(pageId)`
  - index on `(paperId, blockId)`
- `compiled_local_concepts`:
  - unique on `(ownerUserId, workspaceId, paperId, canonicalName, kind)`
  - index on `(paperId, kind)`
- `compiled_local_concept_evidence`:
  - index on `(conceptId)`
  - index on `(paperId, blockId)`

The important design rule is:

- **paper-local uniqueness now**
- **cross-paper uniqueness later in `020D`**

Do not try to make `020A` solve corpus-wide canonicalization in the first schema.

---

## Output contract

At the end of `020A`, a single uploaded paper should be able to yield:

1. one paper wiki / `source` page
2. zero or more paper-local concept atoms
3. a paper-local compiled concept layer
4. source-level meaning for each usable concept atom
5. block-grounded references for every generated page and concept atom

The important thing is not the exact number of pages. The important thing is that every artifact is:

- paper-scoped
- source-grounded
- idempotently reproducible

---

## Prompt contract

`020A` currently uses three compile prompts:

- `paper-compile-v1.ts`
- `paper-compile-window-v1.ts`
- `paper-compile-reduce-v1.ts`

The target production architecture should support multiple prompts/passes when paper length requires it. Do not wait for failures caused by truncation to justify this split.

### Compile prompt requirements

Input slots should be bounded and deterministic:

- `paperTitle`
- `paperAuthors`
- `paperMetadata` (only if useful and cheap)
- `blocks`

Output should be structured, not free-form prose. For example:

```ts
type PaperCompileResult = {
  summary: string
  referenceBlockIds: string[]
  concepts: Array<{
    kind: "concept" | "method" | "task" | "metric" | "dataset" | "person" | "organization"
    canonicalName: string
    displayName: string
    evidenceBlockIds: string[]
  }>
}
```

Extraction taxonomy rule:

- `concept | method | task | metric` are the default **core knowledge kinds**
- `dataset | person | organization` are **supporting entity kinds**
- `person` is restricted to paper authors or clearly author-level named people
- `organization` is restricted to author affiliations / institutions
- do not extract arbitrary people or organizations mentioned in body prose unless later cards explicitly expand scope

Current implementation details:

- the prompt uses a soft target of roughly `12-35` concepts for normal papers, but concept count is not hard-capped
- the service rejects concepts with no valid evidence block
- `evidenceBlockIds` has a wide service hard cap of `200` per concept as a runaway-output guard
- source-page `referenceBlockIds` has a wide service hard cap of `500`
- source-page references are assembled from model references and explicit `[blk ...]` summary citations
- source-page references do **not** automatically include every concept evidence block; concept evidence is persisted separately in `compiled_local_concept_evidence`
- concept kind aliases such as `baseline`, `framework`, `model`, `benchmark`, `evaluation`, `authors`, and `affiliations` are normalized service-side
- unknown concept kinds are downgraded to `concept` instead of failing the whole compile

The prompt should explicitly require:

- no concepts without evidence blocks
- concept extraction grounded in parsed blocks
- a bounded markdown source page body
- no unsupported claims outside the evidence supplied
- not emitting every noun phrase in the paper
- not extracting arbitrary body-level people/organizations outside the author/affiliation boundary

### Structured-output provider note

`020A` uses schema-validated object output for the combined compile object.
Provider handling is currently:

- `anthropic`: uses AI SDK `Output.object({ schema })`
- `openai`: uses `@ai-sdk/openai-compatible` with `response_format: { type: "json_object" }`
- OpenAI-compatible JSON mode embeds the generated JSON schema into the system instructions, then parses and validates the returned text with Zod

This matters because the task depends on deterministic objects, not just "mostly JSON" prose.
The service layer should still assume provider behavior varies in practice, so the compile schema is intentionally tolerant of common JSON-mode aliases:

- root aliases such as `body`, `sourcePage`, `source_page`, `references`, and `local_concepts`
- concept aliases such as `type`, `category`, `name`, `term`, `label`, `block_ids`, and object-shaped `evidence`

If JSON parsing or schema validation fails, the error bubbles to the BullMQ retry policy and the source page / summary status is marked failed on the final attempt.

---

## Worker flow

```
1. Load paper metadata + parsed blocks.
2. Choose compile strategy from deterministic input size / section structure.
3. For short papers, run the current combined compile path.
4. For long papers, run section/window compile passes and reduce into paper-local concept atoms.
5. Canonicalize concepts/entities within the paper.
6. Create/update source page.
7. Create/update first-pass local concept/entity projections.
8. Write evidence links to referenced blocks.
9. Mark the paper as compiled for generation version X.
```

Triggered from the upload pipeline after `paper-parse`. The queue is still named `paper-summarize`, but the job now compiles the full paper context.

---

## Concrete worker/file direction

Likely files:

- `apps/api/src/queues/paper-summarize.ts`
- `apps/api/src/workers/paper-summarize.worker.ts`
- `apps/api/src/services/paper-compile.ts`
- `packages/shared/src/prompts/paper-compile-v1.ts`
- `packages/db/src/schema/wiki-pages.ts`
- `packages/db/src/schema/compiled-local-concepts.ts`

Recommended split inside implementation:

### Queue/worker

Owns orchestration and idempotency only.

### Service layer

Owns:

- loading paper + blocks + summary
- extraction prompt assembly
- canonicalization
- page / compiled-concept persistence
- reference refresh

### Shared prompt layer

Owns prompt text and output-format contracts only.

This mirrors the separation that worked well in TASK-019 and TASK-022.

---

## Idempotency / invalidation boundary

`020A` should re-run only when the upload-time content substrate changes.

Good invalidation inputs:

- `papers.summaryGeneratedAt`
- `papers.summaryModel`
- `papers.summaryPromptVersion`
- parsed block content fingerprint / parse version
- current extraction prompt version
- current synthesis prompt version
- current model name

It should **not** re-run just because:

- highlights changed
- notes changed
- chat changed

Those belong to later cards.

---

## Canonicalization rules

Keep these intentionally conservative in `020A`.

Safe first-pass rules:

- lowercase for canonical matching
- collapse whitespace
- normalize Unicode
- trim punctuation around edges
- optionally singularize only if a very safe heuristic exists

Do **not** attempt in `020A`:

- aggressive ontology merging
- cross-paper deduplication
- semantic alias resolution beyond paper-local obvious cases

The rule here is:

> prefer duplicates over wrong merges

---

## Acceptance checkpoints

### Checkpoint 1 — Schema exists

Before any worker logic:

- migrations are generated
- tables can represent:
  - wiki pages
  - page references
  - local concepts
  - local concept evidence

### Checkpoint 2 — Worker produces first artifact

On one seeded paper:

- paper wiki / `source` page is generated
- at least one local concept artifact is created when evidence exists
- all references point to valid blocks

### Checkpoint 3 — Rerun is idempotent

Running again with identical inputs:

- makes no extra LLM calls
- does not duplicate pages
- does not duplicate references

### Checkpoint 4 — Prompt failure is survivable

Malformed extraction or synthesis output:

- marks status as failed
- stores bounded error
- is retried by the queue's bounded retry policy
- stops after the configured final attempt to avoid unbounded user-token spend
- does not corrupt previously good data

---

## Acceptance Criteria

1. A background worker runs after `paper-parse` through the existing `paper-summarize` queue.
2. A new paper can produce:
   - one `source` page
   - at least one local concept artifact when evidence exists
3. Every synthesized page can link back to `(paperId, blockId)` evidence.
4. The run is idempotent when summary/block content has not changed.
5. All LLM calls go through `services/llm-client.ts`.
6. Logs preserve the same privacy contract as TASK-019 / TASK-022.
7. Tests cover:
   - worker idempotency
   - extraction fixture shape
   - reference integrity
   - malformed extraction output / bounded failure path

---

## Testing strategy

### Schema / migration

- migration up
- required columns / indexes / enums exist

### Worker

- first run creates source page + compiled concepts + references
- rerun with unchanged inputs skips
- rerun after summary/prompt/model invalidation refreshes

### Prompt/service

- extraction fixture returns structured candidates with evidence
- synthesis fixture returns bounded markdown body
- concepts without evidence are rejected or dropped before persistence

### Integrity

- every `wiki_page_reference.blockId` points to an existing block of the same paper
- every `compiled_local_concept_evidence` row points to an existing local concept and block

### Privacy

- no prompt or response content is logged

---

## Major decisions to defer

These should stay out of `020A` even if tempting:

- whether the paper wiki / `source` page should remain a distinct stored row or become a thin projection over `papers.summary`
- whether local concept-to-local concept links deserve their own table immediately
- whether page bodies should reference other wiki pages inline
- whether retrieval indices should be persisted now or only in `020D`

---

## Risks

1. **Concept over-generation**
   - paper text may produce too many noun phrases
2. **Weak grounding**
   - candidate concepts must not exist without evidence blocks
3. **Schema lock-in**
   - avoid baking wiki-page shape in as the only durable truth
4. **Premature complexity**
   - over-modeling graph/retrieval concerns here will slow the first meaningful artifact

---

## Done means

`020A` is done when:

- upload-time silent compilation works
- the first wiki pages are real and grounded
- local concepts exist as substrate, not just page prose
- reruns are idempotent
- later cards can safely assume the paper-level concept skeleton already exists

---

## Handoff to TASK-020B

The output of this card is the stable paper-level concept skeleton that `020B` will later enrich with highlights/notes/citations.
