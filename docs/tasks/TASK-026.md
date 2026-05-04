# TASK-026: Question-framed paper compile prompt polish

**Priority**: High  
**Status**: ✅ Completed  
**Estimated effort**: 0.5-1.5 working days  
**Depends on**: TASK-025, current hierarchical `paper-compile-*` path  
**Phase**: 3 — Knowledge compilation prompt quality

---

## Goal

Polish the existing paper compile prompts without changing the pipeline shape.

The current summary/concept extraction path already works:

```text
blocks
→ paper-compile-window-v1
→ paper-compile-reduce-v1
→ compiled_local_concepts
→ concept-source-description-v1
```

This task keeps that architecture. It improves output quality by making summary and concept extraction answer a fixed research-reading frame:

- **Context**: what academic/practical problem does the paper address?
- **Method**: what techniques, models, data, experiments, or arguments are used?
- **Result**: what are the core findings, and does the evidence support them?
- **Critical**: where are the overclaims, gaps, assumptions, or unresolved weaknesses?
- **Value**: what is reusable or relevant for a researcher: citations, methods, data, ideas, extensions?

Concept taxonomy remains graph/retrieval-oriented:

```text
concept | method | task | metric | dataset
```

The five reading questions are a relevance filter, not a replacement for taxonomy.

---

## Non-goals

- Do not add new DB tables or migrations.
- Do not change persisted concept output shape.
- Do not add `supports` / `role` fields to persisted concepts in this pass.
- Do not introduce claim cards, external topic priors, OpenAlex, or a full eval harness.
- Do not rewrite the compile architecture or add window caching yet.

---

## Required changes

### Prompt changes

Update:

- `paper-compile-v1`
- `paper-compile-window-v1`
- `paper-compile-reduce-v1`
- `concept-source-description-v1`

Rules:

- Final source summary must use exactly:
  - `## Context`
  - `## Method`
  - `## Result`
  - `## Critical`
  - `## Value`
- Window summaries should use the same labels in compact form so reduce can preserve the frame.
- Concepts must still use taxonomy kind:
  - `concept`
  - `method`
  - `task`
  - `metric`
  - `dataset`
- A concept is valid only if it helps answer at least one of Context / Method / Result / Critical / Value.
- Remove `person` and `organization` from active extraction prompts.
- Explicitly say people, authors, institutions, labs, companies, and affiliations belong to metadata, not the concept graph.

### Service changes

Update `paper-compile` service taxonomy to stop normalizing model outputs into `person` / `organization`.

- Remove `person` and `organization` from `conceptKindSchema`.
- Remove aliases that map to `person` / `organization`.
- Make author / institution / affiliation / organization-like aliases normalize to `concept` or be filtered out.
- Add a deterministic generic/person/org stoplist so accidental model outputs are not persisted as concepts.

Keep DB compatibility: existing rows with old kinds can remain readable; this task only prevents new extraction from producing them.

### Token/cost hygiene

Keep this small:

- Use compact window artifact JSON in reduce input.
- Avoid expanding concept candidates with unnecessary prose.
- Keep existing max token limits unless tests show an easy safe reduction.

---

## Acceptance criteria

1. ✅ Prompt registry tests verify the five summary headings and five-kind taxonomy.
2. ✅ `paperCompileResultSchema` no longer accepts `person` / `organization` as final concept kinds.
3. ✅ Author/institution-like concept candidates are not persisted from compile outputs.
4. ✅ Hierarchical reduce still preserves late-paper concepts.
5. ✅ Existing graph/agent paths still typecheck with historical DB vocabulary.

---

## Test plan

Targeted:

```bash
pnpm --filter @sapientia/shared exec vitest run src/prompts/index.test.ts
pnpm --filter @sapientia/api exec vitest run src/services/paper-compile.test.ts
pnpm --filter @sapientia/api typecheck
```

Optional regression:

```bash
pnpm --filter @sapientia/api exec vitest run src/services/concept-description.test.ts src/services/concept-refine.test.ts src/routes/graph.test.ts
pnpm --filter @sapientia/web typecheck
```

---

## Report back

When complete, report:

- prompt files updated
- taxonomy changes made
- tests run
- any remaining old `person` / `organization` compatibility surfaces

## Completion notes

- Updated paper compile single-pass/window/reduce prompts to use the Context / Method / Result / Critical / Value reading frame.
- Reduced active compile concept taxonomy to `concept | method | task | metric | dataset`.
- Kept people, authors, institutions, labs, companies, and affiliations as metadata rather than graph concepts.
- Added backend sanitization so generic, author-like, and organization-like concept candidates are dropped before persistence.
- Kept historical DB compatibility; this task only prevents new compile outputs from creating `person` / `organization` concept kinds.
