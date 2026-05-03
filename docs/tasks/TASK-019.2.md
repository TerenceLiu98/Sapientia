# TASK-019.2: Spacing / motion / radius token alignment — sequencing plan

**Estimated effort**: 1-2 working days  
**Depends on**: [`docs/DESIGN_TOKENS.md`](../DESIGN_TOKENS.md), TASK-019.1 color-token cleanup, current reader / editor UI  
**Phase**: Cross-cutting design-system cleanup

---

## Context

After color-token drift, the next major source of inconsistency is not hue but **shape and rhythm**:

- spacing is still mostly expressed as scattered utility values (`px-4`, `py-8`, `gap-3`, `p-6`)
- motion is still mostly ad-hoc (`duration-200`, `duration-220`, custom cubic-bezier values)
- radius is partly standardized (`rounded-md`, `rounded-lg`) but key overlays still use larger or arbitrary values (`rounded-2xl`, `rounded-[18px]`)

These three concerns should **not** be cleaned up in random file order. They affect interaction feel more than static appearance, and the reader workspace contains multiple overlapping surface types (folded slips, expanded slips, overlay cards, previews, toolbars, popovers). If we start from low-level page spacing or individual buttons, we risk baking the wrong primitives into the most visible surfaces.

This card exists to define the **modification order** before implementation work begins.

---

## Problem framing

Spacing, motion, and radius are not equally risky across the UI:

1. **Overlay and floating surfaces are the highest-risk drift points**
   - note slips
   - overlay cards
   - selected-block previews
   - editor bubbles
   - annotation popovers

   These are the places where users most clearly feel whether the product is "one system" or a pile of independent widgets.

2. **Page containers and forms are lower risk**
   - they are easier to normalize later
   - they affect readability and density, but not the product's signature interaction model

3. **Reader/editor internals are the broadest surface area**
   - many small paddings, gaps, chips, toolbars, and labels
   - if tackled first, they create churn without establishing the right primitives

So the correct order is not "top to bottom by file tree"; it is "highest interaction leverage first, highest fan-out second, broad cleanup last."

---

## Goal

Define the safest and highest-leverage sequence for aligning implementation with the spacing / motion / radius sections of [`docs/DESIGN_TOKENS.md`](../DESIGN_TOKENS.md), so that follow-up implementation can proceed with minimal churn.

This card does **not** itself change the implementation. It defines the order, scope, and reasoning.

---

## Recommended implementation order

### Phase A — Establish runtime primitives in `index.css`

**Why first**: components cannot converge if the token layer for spacing / motion / radius is still only aspirational in the doc.

Add or reconcile the core token families in [`apps/web/src/index.css`](../../apps/web/src/index.css):

- spacing scale that current components can actually consume
- semantic spacing aliases where already justified
- radius scale (`sm/md/lg/xl/full`) with current app intent
- motion duration + easing tokens
- any shared shadow/elevation aliases needed by floating surfaces

This phase should avoid component-by-component cleanup except what is required to prove the token names are viable.

**Primary output**:
- token names exist in CSS
- token meanings are stable enough to drive the next phases

---

### Phase B — Normalize overlay and floating surfaces

**Why second**: these surfaces define Sapientia's perceived design maturity. If they are inconsistent, the rest of the app will still feel inconsistent even after global cleanup.

First-wave components:

- [`apps/web/src/components/reader/NotesPanel.tsx`](../../apps/web/src/components/reader/NotesPanel.tsx)
- [`apps/web/src/components/reader/OverlayNoteCard.tsx`](../../apps/web/src/components/reader/OverlayNoteCard.tsx)
- [`apps/web/src/components/reader/SelectedBlockPreview.tsx`](../../apps/web/src/components/reader/SelectedBlockPreview.tsx)
- [`apps/web/src/components/reader/FloatingMarkupPalette.tsx`](../../apps/web/src/components/reader/FloatingMarkupPalette.tsx)
- [`apps/web/src/components/reader/ReaderAnnotationLayer.tsx`](../../apps/web/src/components/reader/ReaderAnnotationLayer.tsx)
- [`apps/web/src/components/reader/BlockCitationsPopover.tsx`](../../apps/web/src/components/reader/BlockCitationsPopover.tsx)

What to standardize here:

- radius of cards, pills, popovers, and floating chrome
- interior spacing of headers, control rows, and tag rows
- transition timing for open/close / hover / enter states
- elevation levels for stacked floating surfaces

**Reasoning**:
- these components currently contain the densest concentration of arbitrary radii and custom motion values
- they are visually adjacent in the reader, so mismatch is obvious
- they will establish the "canonical" floating-surface language for the rest of the app

---

### Phase C — Normalize editor chrome and menus

**Why third**: once overlay surfaces are stable, editor-adjacent chrome can inherit the same visual language instead of inventing its own.

Second-wave components:

- [`apps/web/src/components/notes/NoteEditor.tsx`](../../apps/web/src/components/notes/NoteEditor.tsx)
- [`apps/web/src/components/notes/citation-schema.tsx`](../../apps/web/src/components/notes/citation-schema.tsx)
- [`apps/web/src/components/ui/dropdown-menu.tsx`](../../apps/web/src/components/ui/dropdown-menu.tsx)

Focus areas:

- slash menu padding, row density, icon cell spacing
- selection bubble radius / padding / button grouping
- dropdown item spacing and hover motion
- chip / inline-control corner rules

**Reasoning**:
- the editor already has multiple overlay-like surfaces
- if this phase runs before Phase B, the editor may diverge from the reader's floating-surface conventions

---

### Phase D — Normalize modal / form / page container spacing

**Why fourth**: these are important, but they are less identity-defining than the reader overlays and easier to sweep once primitives are proven.

Third-wave components:

- [`apps/web/src/components/library/EditMetadataModal.tsx`](../../apps/web/src/components/library/EditMetadataModal.tsx)
- auth forms and shells
- settings form
- library / notes / index route containers

Focus areas:

- page-level outer padding
- form field stack spacing
- modal header/body/footer spacing
- input and button height/radius consistency

**Reasoning**:
- this phase benefits from button/input/container tokens validated elsewhere
- it has broad fan-out, but lower interaction risk than the reader/editor surfaces

---

### Phase E — Reader pane internals and broad utility cleanup

**Why fifth**: this is the largest surface area and should come after the main interaction shells are stable.

Fourth-wave components:

- [`apps/web/src/components/reader/BlocksPanel.tsx`](../../apps/web/src/components/reader/BlocksPanel.tsx)
- [`apps/web/src/components/reader/OcrPane.tsx`](../../apps/web/src/components/reader/OcrPane.tsx)
- [`apps/web/src/components/reader/PdfViewer.tsx`](../../apps/web/src/components/reader/PdfViewer.tsx)
- layout chrome such as nav / topbar / right panel

Focus areas:

- repeated row/chip paddings
- toolbar control spacing
- heading margin rhythm
- small-radius utility usage
- local animation values that can fall back to shared duration/easing tokens

**Reasoning**:
- this phase contains many small values but few foundational decisions
- doing it earlier would create lots of edits before the overlay language is settled

---

### Phase F — Final audit and exception review

**Why last**: once the system is mostly aligned, the remaining arbitrary values are easier to classify as either bugs or legitimate exceptions.

Audit goals:

- list remaining `rounded-[...]`, `duration-*`, `ease-[...]`, arbitrary padding, and custom transition-property values
- confirm whether each is:
  - migrated to token-backed utility usage
  - intentionally exempt
  - evidence that a missing token should be added

---

## Priority map by concern

### Radius

Fix first in:

1. folded / expanded note slips
2. overlay note card
3. selected-block preview
4. editor bubble / slash menu
5. modal and form surfaces

### Motion

Fix first in:

1. slips and overlay cards
2. preview overlays
3. editor bubble / dropdown surfaces
4. pane chrome transitions
5. remaining hover-state cleanups

### Spacing

Fix first in:

1. floating-surface internal padding and control grouping
2. editor menus / bubbles
3. modal and form stack spacing
4. page container padding
5. reader pane rows and inline chips

---

## Acceptance Criteria

1. A follow-up implementer can start with Phase A and proceed through F without needing to re-decide overall sequencing.
2. The order clearly distinguishes:
   - token foundation work
   - high-leverage floating-surface work
   - broad page/form cleanup
   - final sweep work
3. The sequencing explicitly prioritizes reader/editor overlay surfaces before lower-risk page-level cleanup.
4. The task card names the concrete component clusters that belong to each phase.

---

## Do not

- Do not start by sweeping all `rounded-*` or `px-*` classes repo-wide.
- Do not standardize page spacing first and postpone reader overlays; that yields the most churn for the least perceived improvement.
- Do not introduce new motion curves locally inside major reader surfaces before shared motion tokens are established.
- Do not treat spacing, motion, and radius as three independent passes; for floating surfaces they need to be normalized together.

---

## Suggested follow-up cards or PR slices

1. **PR 1** — token foundation in `index.css`
2. **PR 2** — reader floating surfaces (`NotesPanel`, `OverlayNoteCard`, `SelectedBlockPreview`)
3. **PR 3** — editor chrome + shared menu surfaces
4. **PR 4** — modal/form/page spacing cleanup
5. **PR 5** — reader pane internals + final audit

This split keeps each PR understandable and lowers the risk of design regressions hidden inside giant className churn.

---

## Report Back

When this sequencing card is acted on, report:

1. Which phase was started first and why
2. Whether any component had to be moved to an earlier or later phase
3. Whether missing tokens were discovered during implementation
4. Which arbitrary values remain as sanctioned exceptions
