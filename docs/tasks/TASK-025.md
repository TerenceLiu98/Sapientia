# TASK-025: Prompt reliability, taxonomy alignment, and regression evaluation

**Priority**: High  
**Status**: In Progress — first prompt/schema regression guardrails started  
**Estimated effort**: 1.5-3 working days for v1 hardening, then ongoing prompt-eval maintenance  
**Depends on**: TASK-020A, TASK-020D, TASK-022, current BYOK LLM client behavior  
**Phase**: 3 — Knowledge compilation hardening

---

## Goal

Make Sapientia's prompts reliable enough to act as product infrastructure, not ad hoc model instructions.

This task covers **all production prompts**, not only `paper-compile-v1`.

The immediate trigger is that real papers exposed failures in concept extraction and block-reference grounding:

- JSON-mode providers may return schema-shaped JSON without true schema enforcement.
- Models may invent compatible-but-invalid field names or enum values.
- Models may output block references as full headers instead of bare block IDs.
- Concept taxonomy drifts, for example classifying tasks as methods.
- Empty concept/source-reference outputs can silently poison downstream graph jobs.
- Long papers can silently lose late-paper concepts when the compile path truncates parsed blocks.
- Concept extraction can still over-collect technical noun phrases instead of selecting only paper-important, load-bearing concepts.

`TASK-025` exists to turn those failures into a systematic prompt + parser + evaluation layer.

---

## Prompt inventory

Current production prompt templates:

- `paper-compile-v1`
  - single-page / small-input summary/source-page synthesis
  - single-page / small-input paper-local concept extraction
  - retained as an optimization path, not the whole product architecture
- `paper-compile-window-v1`
  - page-aware, block-grounded window map extraction
  - emits window summaries, local concept candidates, and evidence refs
- `paper-compile-reduce-v1`
  - reduces window artifacts into paper-level summary/source page and concept atoms
  - preserves late-paper concepts and evidence
- `wiki-extract-inner-graph-v1`
  - inner-paper concept edge extraction
  - relation type selection
  - edge evidence block references
- `agent-summon-v2`
  - reader-facing Q&A grounded in current paper context and marginalia
- `source-summary-v2`
  - legacy / supporting per-paper context summary prompt
  - still relevant as prior design context and possible fallback/reference

Deprecated or removed prompt lines should not be optimized unless they are reintroduced.

---

## Current implementation checkpoint

Engineering has already moved part of this direction:

- OpenAI-compatible BYOK providers use `response_format: { type: "json_object" }`.
- Anthropic-compatible providers use AI SDK object output where available.
- Zod schemas remain the enforcement boundary after model output.
- `paper-compile-v1` now receives the schema in the system prompt.
- `paper-compile-v1` has alias normalization for common root and concept-field drift.
- `paper-compile-v1` rejects normal parsed papers that return no usable concepts and no usable source-page references.
- `concept-graph` has relation alias normalization and conservative edge filtering.
- Block reference parsing accepts both bare IDs and common header-like variants.

Additional implementation notes from the first `TASK-025` pass:

- `paper-compile-v1` now states the task/metric boundary more explicitly: problems/objectives/capabilities/evaluation targets are usually `task`, while scores/rates/losses/criteria are `metric`.
- `paper-compile` service-side concept kind aliases now cover common JSON-mode drift such as `technique`, `problem`, `score`, `corpus`, `finding`, `author`, `institution`, and `objective`.
- Regression coverage now checks that those aliases normalize into the database vocabulary without changing persisted kind values.
- Regression coverage also checks common block-reference variants such as full block headers, `[blk id]`, `#id`, and bracketed bare ids.

Additional implementation notes from the second `TASK-025` pass:

- `wiki-extract-inner-graph-v1` now explicitly asks for canonical relation direction even when the paper sentence is phrased in reverse.
- `concept-graph` service-side relation aliases now handle reverse phrasing such as `solved by` / `addressed by`.
- `concept-graph` now conservatively corrects reversed `addresses` edges only when the source is a `task` and the target is a `method`.
- Existing regression coverage for display-name endpoints now also covers reversed `addresses` direction normalization.

Additional implementation notes from the third `TASK-025` pass:

- `source-summary-v2` is currently **reference-only / legacy-supporting**. Runtime paper compilation has moved to `paper-compile-v1`; no active service path loads `source-summary-v2` directly.
- `agent-summon-v2` now states that summary/marginalia context is retrieval scaffolding, not final authority.
- `agent-summon-v2` now explicitly treats block-cited paper text as the source of truth and tells the model to omit summary-suggested claims when the provided block context is insufficient.

Product architecture note:

- `TASK-025` should not optimize prompts around an MVP assumption that every paper can be compiled in one LLM call.
- One-pass compile may remain as a small-paper optimization, but prompt reliability for the product requires a hierarchical long-paper path.
- Regression coverage should include papers where load-bearing methods/tasks/metrics appear after the current compile context budget.

Implementation checkpoint for hierarchical compile:

- `apps/api/src/services/paper-compile-windows.ts` builds page-aware windows.
- `paper-compile-window-v1` treats blocks as indivisible grounding units and distinguishes `primaryBlockIds` from `contextBlockIds`.
- `paper-compile-reduce-v1` merges window artifacts into the existing persisted compile shape.
- `paper-compile-reduce-v1` now treats source-page `referenceBlockIds` as summary grounding, not as a dump of every concept evidence block.
- `apps/api/src/services/paper-compile.ts` chooses hierarchical compile for multi-page papers or inputs larger than the single-pass context budget.
- default compile windows cover 2 primary pages with 2 context blocks on each side.
- per-paper window map concurrency is currently `4`.
- persisted `papers.summaryPromptVersion` / source page prompt version is now `paper-compile-hierarchical-v1`.
- `paper-compile` no longer hides missing source-page references by adding all concept evidence blocks to `wiki_page_references`; concept evidence stays in its own evidence table.
- `paper_summarize_job_completed` logs now include `compileStrategy` and `windowCount` to make prompt/runtime regressions easier to diagnose on uploaded papers.

This task should finish the hardening and make the rules explicit across prompts.

---

## Design principles

### 1. Prompts describe the contract; services enforce it

Prompts should make the desired shape obvious, but the service layer remains authoritative.

That means every structured prompt should have:

- a clear output contract
- examples of valid and invalid values
- a strict Zod schema
- tolerant normalization for common model drift
- a final sanitizer before persistence

### 2. JSON mode is not structured output

For OpenAI-compatible providers, assume `json_object` only guarantees syntactic JSON, not schema correctness.

Therefore:

- embed the JSON schema in the system prompt
- keep concise natural-language rules in the task prompt
- validate with Zod
- normalize only safe aliases
- reject outputs that lose core information

### 3. Prompt taxonomy must match database taxonomy

The concept kind vocabulary is:

- `concept`
- `method`
- `task`
- `metric`
- `dataset`
- `person`
- `organization`

Prompt language, schema enums, route filters, graph visibility, and docs must stay aligned.

Graph-visible core kinds remain:

- `concept`
- `method`
- `task`
- `metric`

Supporting kinds remain stored but not default-primary graph nodes:

- `dataset`
- `person`
- `organization`

### 4. Evidence discipline is product behavior

Block IDs are not decoration. They are how Sapientia preserves the reader's trust.

Every prompt that makes paper-specific structured claims should specify:

- which fields require evidence
- whether evidence uses bare block IDs or rendered `[blk id]` citations
- whether empty evidence is allowed
- how many evidence IDs are useful versus excessive

### 5. Empty output is usually a failure, not a valid artifact

For a normal parsed research paper:

- `paper-compile-v1` should not produce empty `concepts`
- `paper-compile-v1` should not produce empty `referenceBlockIds`
- `wiki-extract-inner-graph-v1` may produce zero edges only when the concept set is too small or relation evidence is weak
- `agent-summon-v2` may decline to answer when context is insufficient

---

## Prompt-specific work

### `paper-compile-v1`

Primary goals:

- improve concept quality and importance filtering
- reduce empty concept outputs
- reduce invalid taxonomy choices
- preserve valid block references
- avoid overfitting to a single provider

Required improvements:

- sharpen concept kind definitions:
  - `concept`: theoretical/technical idea, mechanism, or phenomenon
  - `method`: model, algorithm, architecture, procedure, intervention, or training/evaluation technique
  - `task`: problem formulation or objective, such as classification, inference, detection, ranking, generation, evaluation target
  - `metric`: named measurement, score, rate, accuracy, loss, benchmark score, or evaluation criterion
  - `dataset`: named corpus, benchmark, dataset, or data source
  - `person`: paper authors or clearly author-level named people only
  - `organization`: author affiliations/institutions only
- explicitly warn that generic task words may still be valid `task` concepts when they name the paper's central problem.
- explicitly warn that zero-shot / few-shot / classification / inference are usually `task` unless the paper presents them as a concrete method.
- include a compact positive/negative taxonomy example section.
- make the bare block ID rule visible near both `referenceBlockIds` and `evidenceBlockIds`.
- use a practical soft target of 12-35 concepts for normal papers, but do not hard-cap concept count.
- preserve source-page summary as agent-facing, not user-facing.

Important concept extraction upgrade:

Sapientia should not extract every scientific keyphrase. It should extract **load-bearing reading atoms**.

A concept is load-bearing only if removing it would make at least one of these harder to understand:

- the paper's central claim or contribution
- the problem/task being addressed
- the proposed or evaluated method
- the evaluation setup, dataset, or metric
- the main finding, caveat, or limitation
- a recurring mechanism/assumption that connects multiple parts of the paper

Use an internal importance rubric:

- `core`: required to understand the paper's contribution, method, evaluation, or main claim
- `supporting`: not the main contribution, but necessary context for understanding evidence, baselines, datasets, metrics, or limitations
- `incidental`: related-work-only mentions, generic tools/phrases, one-off noun phrases, section labels, or terms whose removal would not affect understanding

Only output `core` and `supporting`. Never output `incidental`.

Section-aware rules:

- Concepts in title, abstract, introduction, method, experiments, results, and conclusion carry more weight.
- Concepts only mentioned in related work are usually incidental unless the paper directly uses, compares against, or extends them.
- Implementation details are included only when they affect the method, evidence, or conclusion.
- Datasets/metrics/tasks are included only when they participate in the paper's actual evaluation or central comparison.

This rubric should be mirrored in `paper-compile-window-v1` and enforced most strongly in `paper-compile-reduce-v1`.

Service-side hardening:

- keep alias normalization conservative.
- normalize common invalid kinds only when semantically safe.
- preserve balanced parenthetical canonical names, for example `parameter-efficient fine-tuning (peft)`.
- reject output only after normalization and sanitization.
- include raw/usable counts in failure messages.

### `wiki-extract-inner-graph-v1`

Primary goals:

- make inner-paper graph sparse, meaningful, and evidence-grounded.
- reduce vague `related_to` overuse.
- ensure relation direction is consistent.

Required improvements:

- clarify relation direction examples:
  - `method -> task` for `addresses`
  - `method -> concept` for `uses`
  - `task/method -> metric` for `measured_by`
  - `newer method -> older method` for `improves_on`
- require bare block IDs in `evidenceBlockIds`.
- tell the model to return zero edges when no strong relation exists.
- discourage dataset/person/organization nodes unless a future graph surface opts into them.
- keep max edge count conservative.

Service-side hardening:

- keep endpoint matching by canonical name and display name.
- keep relation alias normalization.
- keep edge evidence validation against real paper block IDs.
- avoid persisting self-edges and duplicate edges.

### `agent-summon-v2`

Primary goals:

- preserve Sapientia's philosophy: the user reads the paper; the agent helps them think.
- keep answers grounded in block citations.
- use compiled concepts/graph when available without turning the response into a summary dump.

Required improvements:

- add a stronger rule that AI-generated summary/context is retrieval scaffolding, not final authority.
- distinguish:
  - answerable from provided paper context
  - answerable only from selected block
  - answerable only with external knowledge
- prefer concise, evidence-backed answers over generic study-guide responses.
- when concepts/graph context is included later, cite source blocks rather than citing graph structure.

Service-side hardening:

- ensure agent context construction does not pass stale empty concept artifacts as if they were meaningful.
- ensure unavailable compiled context degrades gracefully.

### `source-summary-v2`

Primary goals:

- keep this prompt as reference-only / legacy-supporting unless a future runtime path reintroduces it.
- if still active, align citation and summary rules with `paper-compile-v1`.

Required improvements if retained:

- clarify that block citations are required for paper-specific claims.
- align length and scope with downstream agent usage.
- avoid duplicating `paper-compile-v1` unless there is a real runtime need.

---

## Regression evaluation set

Create a small prompt regression set from real papers that have already exposed edge cases.

Suggested seed papers:

- `8992d427-4e74-4c16-ab91-7d869f0ab6b5`
  - good compile overall
  - exposed canonical-name drift around `TinyRM`
- `ce13836c-d23d-47e2-8d23-281e233ad49f`
  - exposed empty concept/source-reference output
- `9109c2b0-4678-417b-8d66-aec97c25c1d8`
  - exposed block-reference formatting mismatch
- `19770c91-3c81-433f-be80-0184d990034f`
  - good compile sample for concept/edge sanity
- `21f71478-168b-4ada-91eb-ef7667313ceb`
  - exposed taxonomy ambiguity around task vs method and canonical parentheticals

Regression checks should cover:

- JSON parses successfully
- root fields exist
- concept count is non-zero for normal parsed papers
- extracted concepts are important enough to be `core` or `supporting`, not incidental technical noun phrases
- related-work-only concepts are filtered unless directly used/extended/compared by the paper
- datasets/metrics/tasks are kept only when they are part of the paper's evaluation or central comparison
- source reference count is non-zero for normal parsed papers
- long papers do not lose concepts that appear outside the first context window
- section/window extraction preserves evidence from late sections
- all concept kinds are valid after normalization
- all persisted block references map to real blocks
- graph edges only connect existing graph-visible concepts
- relation types are valid after normalization
- canonical names are stable enough for edge matching

---

## Acceptance criteria

- `TASK-025` documents the prompt system as a shared reliability layer.
- `paper-compile-v1` taxonomy and importance rules are updated and aligned with DB kinds.
- `paper-compile-window-v1` and `paper-compile-reduce-v1` apply the same load-bearing concept rubric, with reduce acting as the final paper-level importance filter.
- `paper-compile-window-v1` and `paper-compile-reduce-v1` exist and preserve block-grounded evidence across multi-page papers.
- `wiki-extract-inner-graph-v1` relation rules are updated and aligned with persisted edge types.
- Prompt/system wording distinguishes JSON mode from true schema enforcement.
- Service-side normalization handles common safe model drift without hiding real failures.
- Empty compile artifacts fail loudly for normal parsed papers.
- Regression tests cover at least the known failure classes:
  - invalid concept kind
  - full block-header references instead of bare IDs
  - empty concepts/reference IDs
  - long-paper truncation / late concept loss
  - incidental noun phrase over-extraction
  - related-work-only concept leakage
  - parenthetical canonical-name preservation
  - task vs method taxonomy drift where feasible
- Docs reflect that prompt optimization applies to all production prompts, not just concept extraction.

---

## Out of scope

- replacing BYOK provider architecture
- requiring one specific model vendor
- building an offline prompt-eval dashboard
- changing the user-facing concept graph UI
- cross-paper concept clustering quality work beyond prompt inputs needed for `020D`

---

## Implementation order

1. Update `paper-compile-v1`, `paper-compile-window-v1`, and `paper-compile-reduce-v1` with the load-bearing concept rubric.
2. Update prompt wording for `wiki-extract-inner-graph-v1`.
3. Fix canonical-name edge cases in service code.
4. Add prompt/schema regression tests for known drift cases, including concept importance precision.
5. Re-run compile on the known problematic papers.
6. Decide whether `source-summary-v2` is active, reference-only, or retired.
7. Revisit `agent-summon-v2` once concept/graph context is actually passed into the agent.

---

## Report back

When closing this task, report:

- which prompts changed
- which service normalizers changed
- which real-paper regressions were tested
- whether any prompt should be version-bumped
- whether any deprecated prompt should be removed from the registry
