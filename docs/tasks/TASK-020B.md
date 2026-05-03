# TASK-020B: Marginalia alignment + salience refinement

**Estimated effort**: 1.5-2.5 working days  
**Depends on**: TASK-020A, TASK-017 (highlights), TASK-013 (note → block citations), note storage pipeline  
**Phase**: 3 — Zettelkasten Output (user-shaped refinement layer)
**Status**: In Progress (`020B v1` shipped: salience signals, source-page reference refresh, and agent-context integration; annotation-specific and dialogue-specific signals remain)

---

## Goal

Let user reading behavior reshape which concepts are foregrounded, without letting marginalia redefine ontology.

This card answers:

> Which concepts in this paper matter to this reader?

It can also help answer:

> How does this reader understand this concept in this paper?

It does **not** answer:

> What concepts exist in the paper at all?

That remains the job of `020A`.

## Current implementation checkpoint

`020B v1` is now real, not hypothetical:

- `block_highlights` and `note_block_refs` are mapped onto `compiled_local_concepts`
- concept-level raw counts and `salienceScore` are persisted
- source-page `referenceBlockIds` are refreshed from the refined concept layer
- agent context now prefers the `020A` source page and appends top salient concepts when available

Still deferred from the broader `020B/020C` vision:

- `note_annotation_refs`
- reader-annotation-specific weighting
- AI-reply-note-derived signals
- source-page body rewriting / explanatory refresh

---

## Scope

### In scope

- attach highlights to best-matching compiled concepts
- attach note→block citations to concepts
- update salience / priority / evidence strength
- collect comment/marginalia summaries that may refine a concept's source-level meaning
- refresh page emphasis and references when marginalia materially changes

### Recommended v1 scope

Ship `020B` in two layers:

1. **First pass**
   - use `block_highlights`
   - use `note_block_refs`
   - compute concept-level raw counts + salience
   - refresh source-page reference ordering from the refined concept layer
   - let agent context prefer source-page summaries plus top salient concepts when available

2. **Later extension if needed**
   - add `note_annotation_refs`
   - add reader-annotation-specific weighting

This keeps the first implementation grounded in the most stable marginalia signals and avoids coupling `020B` too tightly to the newer text-markup path on day one.

### Explicitly NOT in scope

- concept extraction from scratch
- cross-paper fusion
- AI reply note signals
- arbitrary page rewriting

---

## Design rule

Marginalia is a **user salience signal**, not a concept-definition signal.

So this card may:

- reorder emphasis
- strengthen evidence
- mark concepts as user-important or user-questioned
- propose refinements to `sourceLevelMeaning` when comments clarify local interpretation

But it must not:

- invent a brand-new concept universe solely from highlights
- delete concept structure because the user never touched it
- silently merge/split concepts without an explicit later review path

Refining `sourceLevelMeaning` is allowed because it does not change whether the concept exists. It changes the local explanation used for retrieval, agent context, and future cross-paper clustering.

---

## Suggested signal model

Examples of signals this card can persist:

- highlight count
- weighted highlight colors
- cited-in-note count
- note-backed evidence count
- comment-derived local meaning summary
- last user interaction timestamp

These can roll into a single `salienceScore`, but keep raw counts when possible.

---

## Worker / trigger flow

```
1. Detect marginalia changes for a paper.
2. Load existing compiled concepts/pages from 020A.
3. Map highlight/note/citation signals onto the concept layer.
4. Recompute salience / emphasis.
5. Refresh affected page references and, if needed, body emphasis.
```

This should be selective and incremental, not a full rebuild every time.

---

## Acceptance Criteria

1. Changing highlights/notes/citations can trigger a refinement pass.
2. Existing concepts receive salience updates based on marginalia.
3. Pages can visibly change emphasis without losing grounding.
4. Concepts with no user reinforcement remain valid but quieter.
5. The refinement pass is idempotent when marginalia has not changed.
6. Tests cover:
   - trigger on marginalia change
   - no-op when nothing changed
   - concept salience update shape
   - reference refresh integrity

---

## Risks

1. **Overweighting local details**
   - a single heavily highlighted sentence can dominate a page
2. **Mapping ambiguity**
   - a highlight may plausibly map to multiple concepts
3. **False ontology drift**
   - if refinement becomes too strong, the page stops reflecting the paper and starts reflecting noise

---

## Handoff to TASK-020C

After this card, the system should know:

- what the paper contains
- what the user cared about while reading it

`020C` then adds the weaker but still useful signal from dialogue.
