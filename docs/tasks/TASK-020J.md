# TASK-020J: Concept memory lifecycle and semantic refresh decoupling

**Estimated effort**: 5-8 working days  
**Depends on**: TASK-020B, TASK-020G, TASK-020H, TASK-020I, TASK-022  
**Phase**: 3 — knowledge-compilation lifecycle hardening  
**Status**: ✅ Checkpoint ready

---

## Goal

Introduce a lifecycle boundary between reading-time observations and semantic graph maintenance.

The current implementation lets note changes flow too directly into concept description and workspace semantic refresh:

```text
note save
  -> paper-concept-refine
  -> paper-concept-description
  -> workspace-semantic-refresh
  -> embedding / candidate / LLM judgement
  -> graph may change
```

This is too eager. Notes and highlights are high-frequency reading behavior; embedding and LLM judgement are lower-frequency semantic maintenance. They should be connected through consolidation, not directly coupled.

This task applies the LLM Wiki v2 / agentmemory lifecycle principle to Sapientia:

```text
observation
  -> salience / reader signal
  -> consolidation
  -> stable semantic update only when warranted
  -> graph snapshot
```

---

## Implementation Checkpoint — 2026-05-03

TASK-020J is implemented as a working lifecycle boundary.

Current behavior:

- note/highlight save still enqueues `paper-concept-refine`
- `paper-concept-refine` now updates paper-local salience and reader signals only
- `paper-concept-refine` does **not** enqueue source-description generation
- `paper-concept-refine` does **not** enqueue workspace semantic refresh
- saved notes and highlights are consolidated into `concept_observations`
- AI answers saved into notes are treated as ordinary note content; no separate AI-note status is tracked
- reader-signal refresh clears `readerSignalDirtyAt` after processing
- source-level concept descriptions are still generated after paper compile or explicit description refresh
- source-description completion marks only semantic graph kinds as semantic dirty:
  - `concept`
  - `method`
  - `task`
  - `metric`
- supporting entity kinds are still extracted and described, but do not enter semantic graph dirty tracking:
  - `dataset`
  - `person`
  - `organization`
- embedding refresh clears `semanticDirtyAt` for concepts whose embedding was generated or already up to date
- workspace semantic refresh remains responsible for embeddings, semantic candidates, and LLM judgement

Manual verification on 2026-05-03:

- target paper: `a1b679de-3b2a-4adb-8e59-1773e9c61954`
- after adding notes/highlights, reader observations were created for affected concepts
- `readerSignalDirtyAt` returned to `0`
- ordinary note/highlight activity did not create workspace semantic candidates
- after embedding refresh, workspace `semanticDirtyAt` returned to `0`

Validated checks:

```text
pnpm --filter @sapientia/api exec vitest run \
  src/services/concept-embeddings.test.ts \
  src/services/concept-description.test.ts \
  src/workers/paper-concept-refine.worker.test.ts

pnpm --filter @sapientia/api typecheck
```

Both passed.

---

## Product Principle

Users read papers. They do not maintain a concept wiki or graph.

Notes, highlights, and note-native AI replies are all user reading traces once they are saved into notes. The system should not treat AI-written note text as a separate product object or a separate authority. A saved note is simply part of the user's reading record.

Therefore:

- a note can affect concept importance
- a note can help Concept Lens become more contextual
- a note can eventually inform semantic maintenance after consolidation
- a note should not immediately rewrite concept meaning
- a note should not immediately trigger embedding refresh or LLM judgement
- a note should not make the paper graph visibly flap

The user-facing behavior should feel like:

> I read normally. Sapientia quietly notices what I repeatedly touch, then uses that signal to improve retrieval, lens ordering, and long-term graph memory.

---

## Concept Memory Model

Sapientia should treat every paper-local concept as a memory object with separate layers:

### Source meaning

Stable, paper-grounded meaning.

Owned by:

- parsed paper blocks
- concept evidence blocks
- `sourceLevelDescription`
- source-level description confidence

Default rule:

> Source meaning is generated from paper evidence and is not overwritten by ordinary notes.

### Reader signal

Dynamic reading trace.

Owned by:

- highlights
- notes
- note block citations
- selected-text or block Ask answers that were saved into notes
- repeated access or attention when available

Default rule:

> Reader signal updates salience and Concept Lens ordering, not graph truth.

### Semantic maintenance

Low-frequency, stable knowledge-graph layer.

Owned by:

- source-level descriptions
- stable meaning fingerprints
- embeddings
- semantic candidates
- LLM judgement
- graph snapshots

Default rule:

> Semantic maintenance runs only when stable semantic inputs change, not every time a note is saved.

---

## Implemented Event Flow

### Upload / compile path

```text
paper uploaded
  -> parse blocks
  -> compile paper-local concepts
  -> generate source-level concept descriptions
  -> mark semantic graph concepts dirty
  -> generate embeddings
  -> clear semantic dirty for embedded / up-to-date graph concepts
  -> retrieve semantic candidates
  -> run batched LLM judgement
  -> update stable graph projection
```

This path can produce semantic graph changes because the source substrate changed.

### Reading path

```text
note/highlight saved
  -> update note/highlight tables
  -> update block refs
  -> mark affected concepts reader-signal dirty
  -> debounce paper-level refine
  -> recompute salience and readerSignalSummary
  -> sync concept_observations
  -> clear readerSignalDirtyAt
  -> update Concept Lens
```

This path should not run embedding or LLM judgement by default.

### Scheduled consolidation path

```text
scheduled consolidation
  -> inspect dirty reader signals
  -> update readerSignalSummary
  -> optionally produce meaning augmentation candidates
  -> only if stable semantic fingerprint changes:
       mark semantic dirty
       enqueue semantic refresh
```

The implementation should land the lifecycle boundaries and data model in one coherent pass. Meaning augmentation can remain inactive until prompts are evaluated, but the revision/supersession data model and semantic dirty boundaries should exist from the start.

---

## Engineering Changes Implemented

### 1. Break note-save to semantic-refresh coupling

Note routes enqueue `paper-concept-refine` on note create/update/delete. That part remains.

The default refine behavior is now:

```text
paper-concept-refine
  -> refinePaperConceptSalience
  -> refresh reader signal summary
  -> sync concept observations
  -> clear readerSignalDirtyAt
```

`paper-concept-description` should still run after paper compile and explicit refreshes.

### 2. Split reader signal refresh from source description generation

The service boundary is now split:

`refreshPaperConceptReaderSignals()` is cheap and local:

- read concept evidence
- read highlights
- read note block refs
- update `readerSignalSummary`
- update input hashes
- sync `concept_observations`
- clear `readerSignalDirtyAt`
- no LLM call
- no embedding call

`compilePaperConceptDescriptions()` remains the LLM-backed source-description path. It still invokes reader-signal refresh first so paper compile produces a complete initial concept state, but note/highlight refresh no longer depends on the LLM path.

### 3. Track dirty state explicitly

Fields on `compiled_local_concepts`:

```ts
readerSignalDirtyAt
semanticDirtyAt
semanticFingerprint
confidenceScore
```

Current semantics:

- `readerSignalDirtyAt` changes on note/highlight updates and clears after reader-signal refresh
- `semanticDirtyAt` changes only when graph-eligible source-level concept meaning changes
- `semanticFingerprint` hashes stable semantic inputs
- `confidenceScore` starts from source-description confidence / refine confidence
- `semanticDirtyAt` is only used for `concept`, `method`, `task`, and `metric`

### 4. Add consolidated observation ledger

`concept_observations` now records consolidated reader observations:

```ts
conceptObservations
- workspaceId
- ownerUserId
- paperId
- localConceptId
- sourceType: "highlight" | "note"
- sourceId
- blockIds
- observationText
- signalWeight
- observedAt
- consolidatedAt
```

Existing `notes`, `note_block_refs`, and `block_highlights` remain the source of truth. `concept_observations` is the derived ledger used by consolidation and future memory updates.

### 5. Restrict semantic refresh triggers

`workspace-semantic-refresh` should be triggered by:

- paper compile completed
- source-level concept description completed
- embedding credentials changed
- explicit user/developer refresh
- scheduled semantic maintenance
- concepts with `semanticDirtyAt` set

It should not be triggered by ordinary note save.

Implemented nuance:

- paper compile enqueues source-description / semantic refresh through the compile pipeline
- note/highlight saves stop at paper-level refine
- embedding refresh clears semantic dirty for graph-eligible concepts after successful or already-current embedding state

### 6. Prepare stable graph projection

TASK-020I currently allows dynamic graph derivation. The data model now includes a persisted projection target for later:

```ts
workspacePaperGraphSnapshots
- workspaceId
- ownerUserId
- graphJson
- inputFingerprint
- status
- generatedAt
```

The snapshot table exists in this task, but `/graph` can continue to derive dynamically during the transition. Follow-up implementation can switch the frontend to read persisted snapshots once graph stability and payload shape settle.

---

## Data Semantics

### Salience vs confidence

Do not collapse these into one score.

```text
salienceScore = "does this matter to this reader right now?"
confidenceScore = "does the system trust this concept/meaning/relation?"
```

Salience inputs:

- note citation count
- highlight count and semantic color
- recent marginalia
- repeated block/concept references
- Concept Lens or retrieval access when available

Confidence inputs:

- number of evidence blocks
- source-level description confidence
- LLM judgement confidence
- cross-paper reinforcement
- contradiction/supersession state

### Notes as observations

No separate AI-note status is needed.

Once an AI answer is saved into a note, it is part of the user's note. The observation model only needs:

```ts
sourceType: "highlight" | "note"
```

The consolidated ledger is:

```ts
conceptObservations
- id
- workspaceId
- paperId
- localConceptId
- sourceType
- sourceId
- blockIds
- observationText
- signalWeight
- createdAt
- consolidatedAt
```

Existing `notes`, `note_block_refs`, and `block_highlights` remain the source of truth, but this task should introduce `concept_observations` as the consolidated observation ledger.

### Dirty State Semantics

`readerSignalDirtyAt` and `semanticDirtyAt` intentionally mean different things.

```text
readerSignalDirtyAt
  = "the user's reading traces changed; update salience / Concept Lens ordering"

semanticDirtyAt
  = "stable source-level semantic meaning changed; update embeddings / graph candidates"
```

Ordinary notes and highlights should only affect `readerSignalDirtyAt`.

Source-level concept description completion can affect `semanticDirtyAt`, but only for graph-eligible kinds:

```text
concept | method | task | metric
```

Supporting kinds are still stored and can be shown in paper-local contexts, but they do not create semantic graph work by default:

```text
dataset | person | organization
```

---

## Acceptance Criteria

- [x] Saving a note updates salience / reader signals without triggering workspace semantic refresh.
- [x] Updating or deleting a note uses the same paper-level refine boundary.
- [x] Highlights are consolidated as reader observations.
- [x] Notes are consolidated as reader observations.
- [x] AI replies saved into notes are treated as ordinary note content.
- [x] Paper compile still produces source-level concept descriptions.
- [x] Source-description completion can trigger semantic refresh through semantic dirty state.
- [x] Explicit semantic refresh still works.
- [x] Embedding credential changes still enqueue a forced semantic refresh.
- [x] Reader Concept Lens reflects note/highlight salience after refine.
- [x] Paper graph no longer changes merely because an ordinary note was saved.
- [x] Tests cover paper-concept-refine avoiding source-description / semantic refresh paths.
- [x] Tests cover source description setting semantic dirty for graph-eligible concepts.
- [x] Tests cover embedding refresh clearing semantic dirty.

---

## Non-goals

- User-facing ontology review queue.
- Requiring users to accept/reject concept updates.
- Distinguishing AI-generated note text from user-written note text in the product model.
- Rewriting source-level concept descriptions from ordinary notes.
- Full contradiction resolution UI.
- Full persisted graph snapshot in the first pass, unless dynamic graph instability becomes blocking.

---

## Future Extensions

### Meaning augmentation candidates

If notes repeatedly clarify a concept, scheduled consolidation can produce:

```ts
conceptMeaningRevision
- localConceptId
- previousDescription
- proposedDescription
- sourceObservationIds
- changeType: "clarification" | "extension" | "correction" | "contradiction"
- confidence
- status
```

This should preserve provenance and support supersession instead of overwriting concept meaning.

This is intentionally **not active** in TASK-020J. The table exists so we have a safe future landing zone, but ordinary note saves should not rewrite source-level meaning.

### Retention decay

Adopt a lightweight forgetting curve:

```text
effectiveSalience =
  baseSalience * recencyDecay(lastMarginaliaAt)
  + crossPaperBoost
  + recentAccessBoost
```

Decay should affect salience, not source truth.

### Graph snapshots

When workspaces grow, `/graph` should read a persisted snapshot updated by semantic maintenance, not live-derive all paper-paper edges on every request.

---

## Report Back

Implementation report:

- Trigger paths changed:
  - `paper-concept-refine` no longer enqueues `paper-concept-description`
  - `paper-concept-refine` no longer compiles workspace clusters
  - `paper-concept-description` remains the source-description path and can enqueue semantic refresh
- Note save behavior:
  - still queues paper-level refine
  - does not queue LLM description generation
  - does not queue embeddings
  - does not queue LLM semantic judgement
- Reader signal testing:
  - worker test verifies refine stays local
  - manual DB test confirmed `readerSignalDirtyAt = 0` after adding notes/highlights
- Semantic refresh triggers remaining:
  - paper compile / source description completion
  - explicit refresh scripts/jobs
  - embedding credential changes
  - graph-eligible concepts with `semanticDirtyAt`
- Graph stability:
  - ordinary note/highlight changes no longer create workspace semantic candidates
  - graph updates are tied to semantic maintenance, not reading-time edits
