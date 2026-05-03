# TASK-020C: Dialogue-informed refinement

**Estimated effort**: 1-2 working days  
**Depends on**: TASK-020A, TASK-020B, TASK-022  
**Phase**: 3 — Zettelkasten Output (weak-signal refinement from note-native AI replies)
**Status**: Drafted

---

## Goal

Use note-native AI interactions as a lightweight signal for unresolved, repeatedly queried, or interpretively important concepts.

This card answers:

> Which concepts is the user still wrestling with?

It can also capture:

> Did the dialogue clarify the source-level meaning of this concept in this paper?

It should refine emphasis, not rewrite canonical truth.

---

## Scope

### In scope

- persist lightweight AI-reply-note-derived concept signals
- track repeated concept follow-up / uncertainty / unresolved interest
- derive short, privacy-safe local meaning refinements when an AI reply note clarifies a concept
- optionally refresh page emphasis or explanatory focus

### Explicitly NOT in scope

- persistent full conversation memory
- arbitrary agent writeback into wiki bodies
- agent authority to redefine canonical concept structure

---

## Design rule

AI replies in notes are a **weak refinement signal**.

Paper content still defines:

- what exists
- what a concept is
- where its evidence lives

Marginalia and AI reply notes can only change:

- salience
- explanation priority
- unresolved-question markers
- source-level meaning summaries used for retrieval/clustering

---

## Suggested persisted signals

Possible examples:

- `followUpCount`
- `questionedAt`
- `uncertaintyScore`
- `needsBetterExplanation`
- `localMeaningClarification`

These should be concept-level or page-level summaries, not raw chat transcripts.

---

## Trigger flow

```
1. Derive lightweight concept signals from note-native AI interactions.
2. Attach them to existing compiled concepts/pages.
3. Reweight salience or explanatory focus.
4. Update source-level meaning summaries only when the dialogue clearly clarifies local interpretation.
5. Optionally refresh body emphasis if change passes a threshold.
```

This should run conservatively, not on every token stream.

---

## Acceptance Criteria

1. AI reply notes can influence concept/page emphasis through a lightweight derived signal.
2. No raw prompt/response body is written into the knowledge layer.
3. Canonical concept structure remains source-grounded.
4. Privacy contract remains unchanged from TASK-022.
5. Source-level meaning refinement stores a compact derived summary, not raw transcript text.
6. Tests cover:
   - signal derivation shape
   - no direct ontology overwrite
   - no raw transcript persistence in the compiled layer
   - local meaning clarification shape

---

## Risks

1. **Chat noise**
   - exploratory questions may not correspond to stable knowledge value
2. **Privacy drift**
   - storing too much chat detail would violate the spirit of the system
3. **Authority confusion**
   - the agent may sound confident, but that should not let it overwrite grounded concepts

---

## Handoff to TASK-020D

After this card, the system should know not only what exists and what the user marked, but also what the user keeps returning to in dialogue.
