# TASK-020G: Source-level concept descriptions

**Estimated effort**: 3-5 working days  
**Depends on**: TASK-020A, TASK-020B, TASK-020F  
**Phase**: 3 — concept substrate hardening  
**Status**: Implemented foundation / checkpoint ready

---

## Goal

Give every paper-local concept a concise, paper-specific meaning.

This is the missing bridge between:

- a name like `sparse autoencoder features`
- the evidence blocks where it appears
- the reader's natural marginalia/comments around those blocks
- cross-paper clustering that needs semantic comparison rather than exact name matching

The output should answer:

> In this paper, what does this concept mean?

Not:

> What is the universal encyclopedia definition of this concept?

---

## Product Principle

Sapientia's concept atom is **paper-local first**.

The same surface phrase can mean different things in different papers. Conversely, different phrases may describe the same underlying idea. Therefore, each local concept needs a `sourceLevelMeaning` before we can safely compare it across papers.

This field is not user-facing as a standalone AI summary and should not ask the user to maintain it. It powers:

- Concept Lens explanations
- agent retrieval and comparison
- graph inspector member descriptions
- semantic clustering candidates
- concept-first retrieval
- paper-to-paper comparison
- future correction/override flows

The user still reads papers. The description helps Sapientia route them back to the right evidence.

### 2026-05-02 direction update

Concept descriptions are **AI-maintained background memory**, not user-authored wiki content.

Default behavior:

- Generate and refresh descriptions automatically.
- Incorporate reading signals only as derived summaries with provenance.
- Do not ask the user to approve descriptions as a normal workflow.
- Offer explicit correction only when the user notices an error in Concept Lens or agent output.

This keeps Sapientia reading-first: the user reads papers; the AI maintains the concept wiki/graph underneath.

---

## Current Implementation Snapshot — 2026-05-03

Implemented so far:

- `compiled_local_concepts` stores source-level description fields:
  - description text
  - confidence
  - generated/model/prompt metadata
  - status/error/input hash
  - dirty timestamp
- `compiled_local_concepts` stores reader-signal summary fields separately from source-level descriptions.
- Migration exists: `packages/db/migrations/0026_source_level_concept_descriptions.sql`.
- Prompt exists: `concept-source-description-v1`.
- Service exists: `apps/api/src/services/concept-description.ts`.
- Queue exists: `paper-concept-description`.
- Worker exists: `apps/api/src/workers/paper-concept-description.worker.ts`.
- Worker concurrency is `4`; job attempts are capped at `2`.
- Paper compile enqueues concept description generation after local concepts are persisted.
- Concept refine enqueues concept description refresh for marginalia-driven reader-signal updates.
- Concept description worker also triggers concept embeddings and semantic cluster candidate generation after descriptions are refreshed.
- Graph and block Concept Lens APIs include:
  - `sourceLevelDescription`
  - `sourceLevelDescriptionStatus`
  - `readerSignalSummary`
- Concept Lens displays source-level descriptions and muted reader-signal hints.
- Service tests cover description generation, reader-signal persistence, idempotent skip behavior, and missing-output partial failure.
- Paper graph edge inspector now uses source-level descriptions as part of the explanation for why two papers are connected.
- Paper graph API includes source-level descriptions and block evidence for top edge evidence.
- Concept Lens and graph both treat descriptions as AI-maintained context, not as a user-authored wiki page.

Remaining hardening:

- Run backfill on real workspaces after prompt quality stabilizes.
- Add manual/debug script coverage for forced regeneration if needed.
- Add future correction/override fields only when the UI introduces correction actions.
- Tune prompt/evidence batching on longer papers.
- Continue TASK-025 prompt-quality work so descriptions inherit high-signal concept extraction rather than noisy keyphrases.

---

## Scope

### In scope

- Add source-level description fields to paper-local concepts.
- Add a separate reader-signal summary field so user marginalia does not overwrite the paper-grounded meaning.
- Generate descriptions from:
  - concept display/canonical name
  - concept evidence blocks
  - source paper metadata
  - source page / paper compile metadata when useful
- Refresh descriptions when:
  - paper compile creates local concepts
  - concept evidence changes
  - user marginalia changes materially enough to affect the interpretation
  - an explicit user correction/override changes concept meaning later
- Generate reader-signal summaries from:
  - highlights on concept evidence blocks
  - note citations that reference concept evidence blocks
  - later agent replies saved into notes
- Expose descriptions in graph/member payloads.
- Feed descriptions into workspace semantic refresh and paper graph explanation.

### Out of scope

- Semantic clustering itself. That belongs to TASK-020H.
- User-facing concept editing UI as a primary workflow.
- Review queues that ask users to approve generated descriptions.
- Long encyclopedia pages.
- Cross-workspace meanings.
- Using descriptions as a replacement for source paper evidence. Block citations remain the source of truth.

---

## Data Model

Add concrete fields on `compiled_local_concepts`:

- `sourceLevelDescription text`
- `sourceLevelDescriptionGeneratedAt timestamptz`
- `sourceLevelDescriptionModel text`
- `sourceLevelDescriptionPromptVersion text`
- `sourceLevelDescriptionStatus enum/pseudo-enum`
  - `pending`
  - `running`
  - `done`
  - `failed`
- `sourceLevelDescriptionError text`
- `sourceLevelDescriptionInputHash text`
- `sourceLevelDescriptionDirtyAt timestamptz`
- `readerSignalSummary text`
- `readerSignalSummaryGeneratedAt timestamptz`
- `readerSignalSummaryModel text`
- `readerSignalSummaryPromptVersion text`
- `readerSignalSummaryInputHash text`
- `readerSignalSummaryStatus enum/pseudo-enum`
  - `pending`
  - `running`
  - `done`
  - `failed`
- `readerSignalSummaryError text`
- optional later: `userOverrideDescription text`
- optional later: `userOverrideReason text`

Field naming note:

- Product language may say `source-level short description`.
- Code can use `sourceLevelDescription`.
- Avoid naming it `summary`, because summary suggests paper-level compression rather than concept-level meaning.
- Keep `readerSignalSummary` separate from `sourceLevelDescription`; marginalia is a reader interpretation layer, not the paper's own definition.
- Keep explicit user corrections in override fields rather than silently rewriting AI-maintained memory.

Suggested migration:

```sql
alter table compiled_local_concepts
  add column source_level_description text,
  add column source_level_description_generated_at timestamptz,
  add column source_level_description_model text,
  add column source_level_description_prompt_version text,
  add column source_level_description_status text not null default 'pending',
  add column source_level_description_error text,
  add column source_level_description_input_hash text,
  add column source_level_description_dirty_at timestamptz,
  add column reader_signal_summary text,
  add column reader_signal_summary_generated_at timestamptz,
  add column reader_signal_summary_model text,
  add column reader_signal_summary_prompt_version text,
  add column reader_signal_summary_status text not null default 'pending',
  add column reader_signal_summary_error text,
  add column reader_signal_summary_input_hash text;

alter table compiled_local_concepts
  add constraint compiled_local_concepts_source_level_description_status_check
  check (source_level_description_status in ('pending', 'running', 'done', 'failed'));

alter table compiled_local_concepts
  add constraint compiled_local_concepts_reader_signal_summary_status_check
  check (reader_signal_summary_status in ('pending', 'running', 'done', 'failed'));

create index idx_compiled_local_concepts_description_status
  on compiled_local_concepts(workspace_id, paper_id, source_level_description_status);
```

---

## Description Contract

Each description should be:

- 1-2 sentences
- paper-specific
- grounded in evidence blocks
- neutral and non-promotional
- usable for semantic comparison
- short enough for graph inspector display

It should include:

- what the concept refers to in this paper
- its role in the paper when clear
- one differentiating detail if needed

It should avoid:

- generic Wikipedia definitions
- claims not supported by evidence blocks
- expanding beyond this paper
- citing paper conclusions as universal truth

Example shape:

```json
{
  "description": "In this paper, sparse autoencoder features are used as interpretable latent units for analyzing model behavior. The paper treats them as a bridge between low-level activations and human-readable concepts.",
  "evidenceBlockIds": ["blk_a", "blk_b"],
  "confidence": 0.84
}
```

---

## Generation Strategy

### Source-level description generation

Generate descriptions as a post-compile/refine job:

```text
compiled_local_concepts
  + compiled_local_concept_evidence
  + blocks
  + paper metadata
→ concept description job
→ update compiled_local_concepts.sourceLevelDescription
```

Batching strategy:

- process concepts per paper/workspace/user
- include only evidence blocks for each concept, plus 1 neighboring block before/after when available
- group multiple concepts in one LLM call when token budget allows
- cap evidence text per concept to a small amount, but never drop block IDs from metadata
- skip concepts whose `sourceLevelDescriptionInputHash` matches current input unless forced

Recommended prompt id:

- `concept-source-description-v1`

Recommended worker/queue:

- `paper-concept-description`

Recommended job payload:

```ts
type PaperConceptDescriptionJobData = {
  paperId: string
  workspaceId: string
  userId: string
  force?: boolean
  reason?: "paper-compile" | "evidence-changed" | "marginalia-refresh" | "manual"
}
```

Why not do this inside `paper-compile-v1`?

- long-paper compile is already doing extraction/reduce work
- concept descriptions benefit from post-compile evidence normalization
- marginalia may arrive after compile
- keeping this post-process lets descriptions be refreshed without re-running paper compile

### Reader-signal generation

Generate reader-signal summaries after salience refinement:

```text
block_highlights
  + note_block_refs
  + notes.agent_markdown_cache
  + compiled_local_concept_evidence
→ concept reader-signal refresh
→ update compiled_local_concepts.readerSignalSummary
```

The reader-signal summary answers:

> How has the reader interacted with this concept in this paper?

It should not rewrite the paper-grounded definition. It can say things like:

```text
The reader repeatedly marked this concept as important and questioned its evaluation setup. Notes mainly cite blocks around the method definition and ablation discussion.
```

This field powers:

- salience-aware graph ranking
- later correction prompts only when the compiled layer is visibly wrong
- reader-facing "why is this concept showing up here?" explanations
- safer source-level description refresh decisions

### Trigger lifecycle

Trigger after paper compile:

```text
paper-summarize worker
→ compilePaper()
→ enqueue paper-concept-refine
→ enqueue paper-inner-graph-compile
→ enqueue paper-concept-description(reason: "paper-compile")
```

Trigger after marginalia changes:

```text
highlight create/update/delete
note create/update/delete
→ enqueue paper-concept-refine
→ paper-concept-refine worker updates salience + readerSignalSummary dirtiness
→ enqueue paper-concept-description(reason: "marginalia-refresh") only when meaningful
```

Meaningful refresh rules:

- Always update salience immediately.
- Update `readerSignalSummary` when any concept evidence block has a changed highlight/note citation.
- Refresh `sourceLevelDescription` only when one of these is true:
  - a new cited/highlighted block is also added as concept evidence later
  - user explicitly corrects concept name/kind/meaning
  - user manually requests refresh from a debug or correction surface
  - `readerSignalSummary` contains a strong correction/definition signal and the current source description is empty, failed, or stale

Do not refresh source descriptions on every highlight. Highlights are attention signals, not definitions.

### Dirty / idempotency policy

Compute separate input hashes:

- `sourceLevelDescriptionInputHash`: concept name/kind + evidence block ids + evidence snippets + paper title + prompt version.
- `readerSignalSummaryInputHash`: concept id + evidence block ids + highlight colors/timestamps + note citation counts + note markdown cache hash.

Skip work when:

- status is `done`
- current input hash matches stored input hash
- `force !== true`

Mark dirty when:

- concept evidence rows change
- concept display/canonical name/kind changes
- note refs or highlights touch any evidence block
- prompt version changes

Use one BullMQ job per paper/workspace/user with a stable job id:

```text
paper-concept-description-{paperId}-{workspaceId}-{userId}
```

If a job already exists, do not enqueue another one. Let the worker observe the latest database state.

### Concurrency and cost

Recommended first settings:

- worker concurrency: `4`
- concepts per LLM batch: dynamic by token budget, target 8-16 concepts per call
- evidence text per concept: 3-5 evidence snippets, each truncated to 600-900 chars
- max output tokens: 8k-16k depending on provider behavior
- attempts: 2 total, because this is BYOK and should not burn user tokens

### Non-LLM fallback

If no LLM credentials exist:

- leave status as `pending` or add pseudo-status `no-credentials` only if we decide to expand the enum
- graph/member payload can still show concept name + paper title
- do not invent template descriptions from block text unless we can cite it cleanly

---

## Prompt Contract

Add shared prompt:

- `packages/shared/src/prompts/concept-source-description-v1.ts`

Input shape:

```ts
type ConceptSourceDescriptionPromptInput = {
  paper: {
    title: string | null
    authors?: string[] | null
    year?: number | null
  }
  concepts: Array<{
    localConceptId: string
    kind: "concept" | "method" | "task" | "metric" | "dataset" | "person" | "organization"
    displayName: string
    canonicalName: string
    evidenceBlocks: Array<{
      blockId: string
      pageNumber: number | null
      text: string
    }>
    readerSignalSummary?: string | null
  }>
}
```

Output shape:

```ts
type ConceptSourceDescriptionOutput = {
  concepts: Array<{
    localConceptId: string
    description: string
    confidence: number
    usedEvidenceBlockIds: string[]
  }>
}
```

Prompt rules:

- Write only paper-specific meanings.
- Use the phrase "In this paper" only when helpful; do not force every sentence to start the same way.
- Never define the concept from general background knowledge alone.
- If evidence is weak, return a conservative description and low confidence.
- Preserve `localConceptId` exactly.
- `usedEvidenceBlockIds` must be a subset of the provided block ids.
- Do not output markdown.

Validation:

- parse with existing `generateObject` path
- post-validate `localConceptId`
- clamp `confidence` to `[0, 1]`
- discard `usedEvidenceBlockIds` that were not provided
- if description is empty, mark that concept failed but do not fail the whole paper job

---

## API / UI Impact

Paper concept graph payload should include local concept descriptions:

```ts
members: Array<{
  localConceptId: string
  paperId: string
  paperTitle: string | null
  displayName: string
  canonicalName: string
  sourceLevelDescription: string | null
  sourceLevelDescriptionStatus: "pending" | "running" | "done" | "failed"
  readerSignalSummary: string | null
  evidenceBlockIds: string[]
}>
```

Concept Lens should show:

- paper-local concept name
- paper-specific source-level description when available
- evidence block count / jump target
- reader-signal hint only when it helps explain salience
- lightweight correction affordance only when the user spots an error

It should not show:

- description approval tasks
- required review state
- long generated concept pages

Workspace graph inspector / Concept Map can show:

- cluster label
- paper-specific members
- each member's source-level description when available
- reader-signal hint when available, visually secondary
- evidence block count / jump target later

Do not make this a separate wiki page.

Backend route updates:

- `apps/api/src/routes/graph.ts`
  - select `sourceLevelDescription`
  - select `sourceLevelDescriptionStatus`
  - select `readerSignalSummary`
- `apps/api/src/routes/wiki.ts`
  - paper concept graph payload should include the same fields for local nodes
- Keep pending states as `202` for source/wiki endpoints; graph payload can return null descriptions without 404.

Frontend updates:

- `BlockConceptLensPanel` shows:
  - current block concepts
  - paper-local member name
  - source-level description
  - evidence count / jump affordance
  - reader-signal summary as small muted text, if present
  - "Ask about this" / "Hide here" / future "Correct" escape hatch
- `WorkspaceGraphView` inspector can show:
  - paper-local member name
  - paper title
  - source-level description
  - evidence count
  - reader-signal summary as small muted text, if present
- Empty descriptions should not look broken; show "Description forming" only in debug/inspector, not as a blocking state.
- Do not present accept/reject controls for descriptions in the default reading flow.

---

## Implementation Plan

1. Add DB migration + Drizzle schema fields.
2. Add prompt module and export it from `packages/shared/src/prompts/index.ts`.
3. Add queue:
   - `apps/api/src/queues/paper-concept-description.ts`
4. Add service:
   - `apps/api/src/services/concept-description.ts`
5. Add worker:
   - `apps/api/src/workers/paper-concept-description.worker.ts`
6. Register worker in `apps/api/src/worker.ts`.
7. Enqueue after paper compile in `paper-summarize.worker.ts`.
8. Enqueue after concept refine only when marginalia affects concept evidence.
9. Add backfill script:
   - `apps/api/scripts/backfill-concept-descriptions.ts`
10. Add API fields to graph/wiki payloads.
11. Add inspector rendering.
12. Add tests.

Suggested service API:

```ts
export async function compilePaperConceptDescriptions(args: {
  paperId: string
  workspaceId: string
  userId: string
  force?: boolean
}): Promise<{
  paperId: string
  workspaceId: string
  describedConceptCount: number
  skippedConceptCount: number
  failedConceptCount: number
}>
```

Suggested helper functions:

```ts
buildConceptDescriptionInputs()
hashConceptDescriptionInput()
batchConceptDescriptionInputs()
applyConceptDescriptionOutput()
refreshConceptReaderSignalSummaries()
```

Backfill behavior:

```bash
pnpm --filter @sapientia/api tsx apps/api/scripts/backfill-concept-descriptions.ts --workspace <id>
```

Options:

- `--workspace <id>`
- `--paper <id>`
- `--user <id>`
- `--force`
- `--dry-run`

---

## Open Decisions

- Whether to add `no-credentials` to the status enum or keep credential absence as `pending` plus log event.
- Whether `readerSignalSummary` needs a separate table later for version history. First pass keeps it on `compiled_local_concepts`.
- Whether source description refresh should ever incorporate reader signal directly. Default answer: only when explicit correction/retype happens.
- Whether person/organization/dataset descriptions should be generated. First pass can generate all kinds, but graph UI may only display core kinds.

---

## Acceptance Criteria

1. `compiled_local_concepts` can store source-level descriptions and generation metadata.
2. `compiled_local_concepts` can store reader-signal summaries separately from source-level descriptions.
3. A queue/service generates descriptions for existing paper-local concepts.
4. The job can be backfilled for old papers.
5. Paper compile enqueues concept description generation after local concepts are persisted.
6. Marginalia changes update salience immediately and refresh reader signal without blindly rewriting source descriptions.
7. Graph and Concept Lens payloads include member descriptions and reader-signal summaries.
8. Concept Lens displays member descriptions without turning into a summary page or review queue.
9. Missing descriptions degrade gracefully.
10. Tests cover description persistence, API payload shape, idempotency, dirty refresh, and empty/no-credential behavior.

---

## Test Plan

Service tests:

- Builds prompt input from concept evidence blocks.
- Skips up-to-date concepts when input hash matches.
- Updates only concepts returned by the LLM output.
- Marks invalid/empty concept outputs failed without failing the whole paper job.
- Refreshes reader signal when highlights/notes cite evidence blocks.
- Does not refresh source description for highlight-only changes unless forced.

Worker tests:

- Processes a paper/workspace/user job and logs counts.
- Handles missing credentials without throwing permanent noise.
- Dedupes jobs by stable job id.

Route tests:

- Workspace graph members include `sourceLevelDescription`, status, and `readerSignalSummary`.
- Pending descriptions return `null` fields rather than 404.

Prompt tests:

- Prompt registry includes `concept-source-description-v1`.
- Output schema rejects missing `localConceptId`.
- Output schema rejects markdown/object drift.

Backfill tests:

- Dry-run reports eligible concept count.
- Forced run ignores stored input hash.

---

## Risks

- **Generic descriptions**: prompt may drift toward encyclopedia definitions. Mitigate with paper-specific evidence-only prompt and regression fixtures.
- **Token cost**: concept count can be high. Batch per paper and cap evidence text per concept.
- **Staleness**: marginalia can change concept interpretation. Use salience/marginalia update timestamps to decide refresh.
- **Overconfidence**: descriptions are not truth; they are paper-local interpretations. Keep confidence nullable and avoid hiding evidence links.
- **User burden creep**: description review can become a hidden maintenance job. Keep correction explicit and optional.

---

## Relation to TASK-020H

TASK-020H should use these descriptions as semantic inputs:

```text
canonicalName + displayName + sourceLevelDescription + evidence snippets
```

Do not attempt robust semantic clustering before this card exists. Otherwise clustering will compare names more than meanings.
