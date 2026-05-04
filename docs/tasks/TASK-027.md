# TASK-027: Concept Lens v2 — reader-first concept substrate

**Estimated effort**: 5-7 working days  
**Depends on**: TASK-020, TASK-021, TASK-022, TASK-025, TASK-026  
**Phase**: 3 — Zettelkasten Output  
**Status**: checkpoint shipped — unified Lens API + reader capsule/sheet landed; description override remains follow-up

---

## Summary

Concept Lens v2 makes the AI-maintained concept substrate visible inside the reader, where the user's work already happens. It is not a wiki editor, graph editor, or ontology review queue.

The core user loop is:

1. read a passage
2. highlight or write a marginal note
3. see concepts, related papers, and note-born signals in context
4. influence the substrate by writing more notes, not by manually editing the graph

`/graph` remains a read-only Paper Map observation point. Source wiki pages remain agent-facing memory and audit substrate.

---

## Implementation Checkpoint — 2026-05-04

Shipped in this checkpoint:

- `apps/api/src/services/concept-lens.ts` is the canonical Lens projection service.
- Legacy block endpoint now delegates to the Lens service:
  - `GET /api/v1/workspaces/:workspaceId/papers/:paperId/blocks/:blockId/concepts`
- Unified Lens endpoint exists:
  - `GET /api/v1/workspaces/:workspaceId/papers/:paperId/lens`
  - supports `blockId`, `noteId`, `annotationId`, or `conceptId`
  - rejects unanchored requests with `400`
- Lens payload includes:
  - context metadata
  - grounded concepts
  - AI-confirmed semantic candidates
  - stable Paper Map related papers
  - freshness summary
  - `feedbackActions: []`
- Reader marginalia now shows a compact `Concept Lens` capsule.
- Capsule detail counters were intentionally removed; users only see the entry point.
- Capsule dot becomes deep teal when the current context has grounded concepts; otherwise it stays translucent.
- Expanded Lens sheet is right-aligned to the note lane and opens leftward.
- Expanded Lens content is intentionally simple:
  - `In this passage`
  - `Across papers`
  - `From your notes`
- Removed duplicate `Why it matters here`; description lives inside `In this passage`.
- Removed internal mechanics from Lens UI:
  - no similarity/embedding scores
  - no edge kind copy
  - no LLM decision/confidence copy
  - no relationship-strength copy
- Left sidebar `Notes` entry was removed; notes remain reader-local marginalia.
- `/graph` remains a 3D read-only Paper Map, with a lightweight legend only.
- LLM JSON parse EOF is treated as transient and gets a smaller/retry path instead of permanent failure.

Completed:

- Unified Lens backend/API shape.
- Reader-local Concept Lens capsule and sheet.
- Note/block anchored Lens context.
- Stable Paper Map related-paper projection in Lens.
- Note-born provenance in Lens payload and UI.
- Removal of standalone user-facing note/sidebar entry from primary navigation.
- Removal of wiki/debug/graph mechanics from the reader UI.
- Prompt taxonomy alignment away from `person` / `organization`.
- JSON EOF retry behavior for object generation.

Remaining follow-ups:

- Paper-local concept description override editing from the capsule.
- Dedicated DB fixture tests for `concept-lens` service, especially note and annotation anchors.
- More regression fixtures for bridge concepts (`Mamba`, `Transformer`, `diffusion`) and isolated term questions.
- End-to-end refresh verification: note edit → note concept extraction → Lens update → stable Paper Map update.
- Optional `Open neighborhood` jump from Lens to `/graph`, only if dogfooding shows it helps.

---

## Product Rules

- Users do not maintain wiki pages, graph edges, or ontology.
- Concept Lens is the primary Phase 3 user surface.
- Every visible concept must be evidence-first: paper block evidence, or note evidence anchored to a block/annotation.
- Concept Lens UI should not expose graph/debug mechanics such as embedding scores, LLM decisions, confidence numbers, or edge kinds.
- User notes can create bridge concepts such as `Mamba`, `Transformer`, or `diffusion` when the note states a comparison, replacement, analogy, limitation, extension, or research-value axis.
- Isolated name-drops do not enter the graph; the agent inserts an editable note question instead.
- Correction remains indirect in this round: users clarify by writing notes. `feedbackActions` exists in API shape but renders no UI.

---

## Backend Scope

### Concept Lens Service

- Add `concept-lens` service as the canonical reader-facing projection over compiled concepts.
- Keep legacy-compatible block endpoint:
  - `GET /api/v1/workspaces/:workspaceId/papers/:paperId/blocks/:blockId/concepts`
- Add unified endpoint:
  - `GET /api/v1/workspaces/:workspaceId/papers/:paperId/lens`
  - supports one anchored query: `blockId`, `noteId`, `annotationId`, or `conceptId`
  - rejects unanchored requests for now

### Lens Response

Return:

- context: paper, block, note, annotation, or concept anchor metadata
- grounded concepts: paper-native and note-born concepts
- evidence snippets: block, annotation-derived block, and note observations; keep available in payload even when UI hides low-level mechanics
- related concepts: AI-confirmed semantic candidates
- related papers: stable Paper Map edge evidence
- freshness: concept, description, semantic, and graph status
- `feedbackActions: []` reserved for later correction UI

### Reliability

- Concept kinds used by user-visible Lens: `concept`, `method`, `task`, `metric`, `dataset`.
- Stop generating new `person` / `organization` concepts.
- Paper compile JSON EOF should be transient and retried/repaired, not treated as permanent paper failure.
- Retry knowledge remains available for parse-done/summary-done papers with 0 concepts or 0 links.

---

## Background Workflow

- Note concept heartbeat stays at 15 minutes.
- Due-note scan should prioritize paper-linked notes whose paper parse and summary are done.
- Note extraction success triggers, in order:
  - concept observation/evidence upsert
  - concept refine
  - description dirty
  - workspace cluster refresh
  - semantic refresh
  - inner paper graph compile
  - stable Paper Map refresh

The graph remains a read-only projection; note/highlight behavior is the user's input channel.

---

## Frontend Scope

### Reader Concept Lens

- Keep the compact marginalia chip as the entry point.
- Expanded panel is a small right-aligned sheet that opens leftward and does not steal the reader.
- Sections:
  - `In this passage`
  - `Across papers`
  - `From your notes`
- Do not show summary counts inside the compact capsule.
- Do not expose internal graph/LLM mechanics inside the sheet.

### Evidence-First Cards

- Concept cards show kind, name, source-level description, and reader signal summary when available.
- Related paper cards show paper title and an evidence jump only.
- Note-related concept cards show concept names only.
- Evidence links jump back to reader blocks.

### Non-Goals

- No wiki sidebar revival.
- No left-sidebar Notes workspace as a primary user entry.
- No graph debug panel in reader.
- No graph edit/review controls.
- No rename/retype/merge/split UI.

---

## Test Plan

### Backend

- Block lens returns grounded concepts, semantic candidates, related papers, and freshness.
- Unified Lens API supports `blockId`, `noteId`, `annotationId`, and `conceptId`.
- Unanchored Lens API returns 400.
- Note-born concepts surface with reader-note provenance.
- Stable Paper Map evidence is used for related papers.
- JSON EOF in object generation is transient and can be retried/repaired.

### Frontend

- Reader panel renders compact chip and expanded sheet.
- Concept cards show reader-note provenance.
- Related paper cards show paper titles and jump links without internal relationship diagnostics.
- Empty/loading/error states stay compact.
- `/graph` continues rendering the 3D Paper Map.

### Regression

- API: wiki/lens, note concept extraction, paper retry, graph refresh.
- Web: reader Concept Lens panel, Paper Map.
- API/Web/Shared typecheck.

---

## Implementation Notes

- First implementation creates `apps/api/src/services/concept-lens.ts`.
- Existing block Lens endpoint is backed by the new service for compatibility.
- `usePaperConceptLens()` is added for note/annotation/concept anchors.
- Block Lens UI now shows related papers from stable Paper Map evidence.
- Follow-up: add paper-local concept description override editing from the capsule without exposing ontology maintenance.
