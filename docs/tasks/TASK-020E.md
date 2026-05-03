# TASK-020E: Retired — do not ship a user-facing wiki page for 020A

**Estimated effort**: —  
**Depends on**: —  
**Phase**: 3 — Zettelkasten Output  
**Status**: Retired / folded into TASK-021 direction

---

## Decision

Do **not** build a user-facing wiki page from `020A`'s paper wiki / source-page artifact.

Reason:

- Sapientia's philosophy is that the user reads the **paper**, not the AI summary.
- In current product logic, the paper wiki produced by `020A` is effectively a compiled summary.
- That summary should remain primarily:
  - an **agent substrate**
  - a **knowledge-compilation intermediate artifact**
  - not a primary user reading surface

So the earlier draft of `020E` as “paper wiki frontend v0.1” should not be implemented.

---

## What changed

The earlier version of this card proposed:

- a paper-scoped wiki route
- a readable source-page UI
- local concept sidebar
- evidence links

That design is now intentionally retired because it would overexpose summary output to the user and risk shifting Sapientia toward “reading the AI summary” instead of reading the paper itself.

---

## New direction

The next user-facing Phase 3 surface should be a **concept graph page**, not a wiki page.

That means:

- `020A` continues to produce:
  - paper wiki / source page
  - local concepts
  - evidence links
- but those artifacts remain backend/agent-facing until later product needs clearly justify selective exposure

And the next frontend-facing card should be:

- [TASK-021.md](TASK-021.md) — concept graph view

---

## Product rule

Use this rule going forward:

> **summary/wiki is for the agent and the knowledge-compilation pipeline; the user-facing surface should foreground concepts and evidence, not the raw AI summary itself.**

This preserves the product philosophy:

- the paper stays central
- AI remains secondary
- knowledge surfaces support reading rather than replace it

---

## Practical consequence

Do not spend implementation time on:

- `/wiki`
- `/wiki/:pageId`
- paper-scoped wiki reading pages
- formal source-page UI

unless the product philosophy is intentionally changed later.

Instead, direct frontend effort toward:

- concept graph view
- concept-first navigation
- evidence-grounded concept exploration

---

## Handoff

If a future card wants to expose any part of the `020A` wiki/source-page layer to users, it should do so only as:

- a supporting explanation surface
- a concept/evidence companion
- a drill-down attached to graph or agent interactions

not as a standalone or primary reading destination.
