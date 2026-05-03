# TASK-023: Reader annotation reset — text-anchored highlight/underline on top of `react-pdf`

**Priority**: High  
**Status**: In Progress (core reset shipped; dark-mode v1 and QA/polish follow-up remain)  
**Estimated effort**: 4-6 working days  
**Depends on**: TASK-008 (PDF viewer baseline), TASK-017 (block-level highlight semantics), TASK-022 (agent summon + `selectionContext`), current `PdfViewer` / `PaperWorkspace` / `ReaderAnnotationLayer` implementation  
**Phase**: 2.5 — Reader interaction and annotation architecture cleanup

---

## Context

Sapientia's reader currently mixes together three different jobs:

1. block-level structural chrome
2. freeform PDF markup drawing
3. selected-text reading interactions

That mix was workable while markup was treated as a custom SVG drawing layer, but it no longer matches the product direction.

The revised product decisions for this card are:

1. **Keep block-level highlights and block chrome.** Structural blocks remain a Sapientia-owned layer.
2. **Replace the current markup-annotation interaction model.** PDF `highlight` and `underline` should become true text-anchored annotations derived from browser/PDF text selection, not free-drawn geometry.
3. **Retire `ink`.** Freehand drawing is no longer needed in the product surface for v0.1.
4. **Keep `react-pdf` as the PDF substrate.** Do not migrate the reader onto `react-pdf-highlighter-plus`.
5. **Prepare for dark-mode PDF readability inside the existing stack.** The reader should stay on `react-pdf`; dark-mode readability should be achieved inside that stack without a wholesale viewer swap.

This card is therefore no longer about splitting interaction ownership between Sapientia and `react-pdf-highlighter-plus`. It is about resetting the reader so:

- `react-pdf` remains the page renderer
- block-level structure remains intact
- token-level PDF annotations become real text markup
- dark-mode PDF rendering has a credible path forward

---

## Core decisions

### 1. Do not adopt `react-pdf-highlighter-plus` as the PDF substrate

After evaluation, this is not the preferred implementation path for the current codebase.

Reasons:

- Sapientia already has a substantial `react-pdf`-based reader with page virtualization, block overlays, note anchoring, internal PDF-link jumps, and citation flashes.
- `react-pdf-highlighter-plus` is built around its own PDF.js viewer ownership model, which conflicts with the current architecture.
- Its published peer dependency line is still centered on `react@18` and `pdfjs-dist@4`, while the app currently runs on React 19 and `react-pdf@10` / `pdfjs-dist@5`.
- The product need is not "swap PDF viewers"; the need is "make `highlight` and `underline` text-anchored."

Decision:

- **No migration to `react-pdf-highlighter-plus` in this task.**
- Its interaction model is a useful reference, but the implementation remains Sapientia-owned.

### 2. Block-level highlighting stays

The existing structural block layer remains valuable and should not be collapsed into token-level annotations.

Keep:

- block bbox chrome
- block-level semantic highlight colors
- block preview / focus / note / citation affordances
- block-based agent summon and jump behavior

Do not reinterpret block-level highlighting as text markup.

### 3. Reader annotations become text markup only

This task narrows reader annotations to:

- `highlight`
- `underline`

And removes:

- `ink`

Conceptually:

- `highlight` means "fill the selected text rects"
- `underline` means "draw a baseline under the selected text rects"

These are both derived from selection rects from the PDF text layer.

### 4. Dark-mode PDF support should stay inside the existing `react-pdf` stack

The practical requirement behind "vector PDF" is future dark-mode readability.

The shipped v1 implementation path is:

- keep `react-pdf`
- keep `renderTextLayer`
- use theme-aware canvas presentation treatment plus matching reading-surface tokens
- keep the option to revisit PDF.js-native recoloring later if it becomes more stable in practice

This should be treated as the current dark-mode rendering path for readable text-heavy PDFs.

Important limitation:

- this improves text and vector readability, but it is not a perfect inversion strategy for figures/images
- scanned PDFs still do not support true text-level markup

---

## Explicitly in scope

- Keep the reader on `react-pdf`
- keep block-level structure and block-level highlights
- replace free-drawn PDF `highlight` / `underline` with text-selection-backed markup
- retire `ink` creation and display from the reader UI
- change the reader annotation data model from geometry primitives to text-rect lists
- render text markup from stored rect arrays in a zoom-stable way
- preserve note / citation / flash behavior for `highlight` and `underline`
- prepare `PdfViewer` to present PDF pages legibly in dark mode without changing the viewer substrate

## Explicitly out of scope

- migrating the whole reader onto `react-pdf-highlighter-plus`
- turning PDFs into SVG-only or DOM-vector rendering
- OCR recovery for scanned PDFs
- cross-paper retrieval or agent changes
- redesigning block-level highlight semantics
- full commercial-PDF-SDK style dark-mode treatment of raster figures

---

## Acceptance Criteria

1. **The PDF reader remains on `react-pdf`.**
   - No migration to a different PDF viewer substrate.
   - Existing page virtualization, page jump, and internal PDF link behavior continue to work.

2. **Block-level highlighting continues to work unchanged.**
   - Structural block chrome remains visible.
   - Block-level highlight colors remain independent from reader annotations.

3. **Reader annotations are text-anchored.**
   - Creating a `highlight` or `underline` starts from a real text selection in the PDF text layer.
   - Stored annotation geometry is derived from selection rects, not from free-drawn rectangles or lines.

4. **`ink` is retired from the UI.**
   - Users can no longer create new ink annotations.
   - Ink controls are removed from the reader surface.
   - Existing ink data does not crash rendering; compatibility behavior is explicit.

5. **`highlight` renders like text markup.**
   - Multi-line selections render as multiple filled bands over text.
   - Zooming or rerendering the page preserves alignment.

6. **`underline` renders like text markup.**
   - Multi-line selections render as per-line underline segments aligned to the selected text rects.
   - Zooming or rerendering the page preserves alignment.

7. **Existing note / citation flows still work for `highlight` and `underline`.**
   - Highlight/underline citations still resolve page and anchor position.
   - Existing selected / flashed / previewed annotation behavior still works.

8. **Dark-mode PDF rendering has an implementation hook.**
   - `PdfViewer` can switch between light and dark PDF presentation inside the existing `react-pdf` render path.
   - The task may ship a practical v1 dark-mode presentation without enabling a polished final treatment for every PDF asset type.

9. **Tests cover the reset.**
   - Text-markup creation from selection
   - highlight/underline rendering from `rects[]`
   - no new ink creation
   - note/citation compatibility
   - dark-mode presentation plumbing

---

## Current implementation status

### Completed in code

- The reader remains on `react-pdf`; no substrate migration was introduced.
- Block-level highlights and block chrome remain intact.
- Reader annotations have been narrowed to text-anchored `highlight` and `underline`.
- Free-draw creation has been removed from the product surface; `ink` is retired from active UI flows.
- Annotation bodies now store `rects[] + quote` and render as text markup instead of geometric primitives.
- Selection-driven creation, existing-annotation selection, delete, restore, and recent-action undo are implemented.
- Legacy annotation data has been migrated/normalized so the active model is the current text-markup shape.
- Dark mode has a shipped v1 path for the reader:
  - global theme settings (`light` / `dark` / `system`)
  - PDF canvas dark presentation inside `PdfViewer`
  - aligned dark reading surfaces across PDF, markdown, notes, tags, and scrollbars

### Remaining follow-up

- Run and document a full manual QA pass across `pdf-only`, `md-only`, and split mode in light/dark/system theme.
- Continue visual tuning of dark-mode PDF presentation, especially for figures, screenshots, and unusual page assets.
- Cleanly separate "completed in v1" from "future ideal direction" in follow-on tasks rather than extending this card indefinitely.

---

## Proposed architecture

### Layer model

The reader should be treated as four distinct layers:

1. **PDF canvas layer**
   - owned by `react-pdf`
   - visual rendering only
   - receives theme-aware dark-mode presentation in the current implementation

2. **Primary PDF text layer**
   - owned by `react-pdf` / PDF.js
   - source of native selection and copied text
   - source of `Range.getClientRects()` for text markup

3. **Passive block chrome layer**
   - Sapientia-owned structural block outlines, labels, hover affordances, preview state
   - independent from text-markup storage

4. **Reader annotation layer**
   - Sapientia-owned overlay rendering stored text markup
   - `highlight` and `underline` only
   - selection popovers, flash states, note actions

### Ownership split

Sapientia continues to own:

- block identity and block overlays
- note anchoring semantics
- annotation persistence
- citation / flash / preview behavior
- cross-pane PDF↔markdown coordination

PDF.js / `react-pdf` continue to own:

- page rendering
- text layer layout
- selection geometry
- the underlying page render path that Sapientia themes for dark-mode readability

---

## Data model revision

### Current model

Today, the reader annotation body is effectively:

- `highlight -> { rect }`
- `underline -> { from, to }`
- `ink -> { points }`

This is not sufficient for real multi-line text markup.

### Revised model

`reader_annotations.kind` should narrow to:

```ts
type ReaderAnnotationKind = "highlight" | "underline"
```

And `body` should move to a text-markup payload:

```ts
type ReaderAnnotationBody = {
  rects: Array<{
    x: number
    y: number
    w: number
    h: number
  }>
  quote: string
}
```

Notes:

- coordinates remain page-relative `0..1`
- `rects[]` preserves multi-line selections
- `quote` stores the selected text for debugging, UX, and future re-anchoring

### Compatibility rule

Because `body` is stored as `jsonb`, the table shape does not need a fundamental redesign, but the app does need:

- type updates in web + db schema
- migration for enum narrowing if/when `ink` is removed from persisted kind values
- explicit compatibility handling for old rows during rollout

Recommended rollout:

1. stop creating new `ink`
2. stop showing `ink` controls
3. keep compatibility rendering for legacy `ink` rows temporarily or archive them with a follow-up migration
4. only then narrow the persisted kind enum fully if desired

---

## Rendering model

### Highlight rendering

For each stored rect:

- render a filled rounded rectangle
- use the existing annotation color with the current selected/unselected opacity rules

This should visually read as a text marker laid behind the glyphs, not as a block bbox fill.

### Underline rendering

For each stored rect:

- compute a y-position near the bottom edge of the rect
- draw a horizontal line spanning that rect

Do not store underline as two arbitrary points anymore.

### Bounding box behavior

A helper should compute the union bounding box of `rects[]` so existing features can continue to work:

- note anchor y-ratio
- flash target computation
- annotation overlap with block bboxes
- selection outline and popover placement

The current "annotation body bounding box" helpers should be updated rather than bypassed.

---

## Dark-mode direction

### Goal

The dark-mode requirement is not "true vector rendering at any cost." The actual requirement is:

- PDF pages should remain readable in dark mode
- text and vector-heavy pages should not force a bright white reading surface forever

### Preferred implementation

Keep the current reader architecture and make the page presentation theme-aware inside the existing `react-pdf` render path:

- light mode: normal PDF canvas presentation
- dark mode: dark canvas presentation plus matching reader-surface tokens

This keeps the current reader architecture and avoids a viewer rewrite just to get a dark-mode foothold.

### Current shipped v1

The current implementation uses:

- a global appearance setting (`light` / `dark` / `system`)
- dark reading-surface tokens shared by PDF and markdown modes
- a canvas presentation treatment in `PdfViewer` for dark-mode readability

This is intentionally pragmatic. It is not yet a perfect PDF-native recoloring system for every asset type.

### What this task should deliver

- wire `PdfViewer` so page presentation can change by theme
- keep the dark-mode hook local to the page render path
- treat the current canvas presentation approach as the shipped v1 unless/until a better PDF-native path is proven stable

### Known limitation

Raster images and complex figures may still need follow-up treatment. That is acceptable for this task.

---

## Implementation plan

### Phase A — Lock the direction and remove obsolete assumptions

Update the task implementation direction across the codebase:

- do not introduce `react-pdf-highlighter-plus`
- keep `react-pdf`
- treat the existing text layer as the source of truth for token-level markup

This also means future code in this card should avoid:

- viewer-level rewrites
- duplicate PDF.js viewer ownership
- new annotation interactions that compete with native text selection unnecessarily

### Phase B — Retire `ink` from the product surface

Files likely affected:

- `apps/web/src/components/reader/FloatingMarkupPalette.tsx`
- `apps/web/src/components/reader/PdfViewer.tsx`
- `apps/web/src/lib/reader-annotations.ts`
- `packages/db/src/schema/reader-annotations.ts`
- `apps/web/src/api/hooks/reader-annotations.ts`

Concrete steps:

1. remove the `ink` tool from the reader UI
2. stop offering freehand creation paths
3. preserve legacy compatibility behavior explicitly during transition

### Phase C — Replace free-drawn highlight/underline creation

The current creation flow in `PdfViewer` is pointer-driven and geometry-first.

Replace it with:

1. detect actionable text selection inside the PDF text layer
2. collect `Range.getClientRects()`
3. normalize those rects into page-relative `0..1` coordinates
4. group rects by page
5. create `highlight` or `underline` from those rects

Recommended first-version scope:

- support single-page selections first
- reject or gracefully defer cross-page selections if needed

### Phase D — Update annotation rendering to rect-list markup

Files likely affected:

- `apps/web/src/components/reader/ReaderAnnotationLayer.tsx`
- `apps/web/src/lib/reader-annotations.ts`

Concrete steps:

1. update shape rendering to iterate over `rects[]`
2. update selection-outline and action-popover anchoring to use union bbox
3. keep ghost, flash, selected, and previewed states working

### Phase E — Preserve note / citation compatibility

Files likely affected:

- `apps/web/src/components/reader/PaperWorkspace.tsx`
- note citation rendering helpers

Concrete steps:

1. update overlap helpers to work from union bbox of `rects[]`
2. keep annotation ordinals stable
3. keep highlight/underline note anchors resolving block overlap

Important rule:

- block overlap remains a derived structural relationship, not something newly stored on the annotation row

### Phase F — Add dark-mode render plumbing

Files likely affected:

- `apps/web/src/components/reader/PdfViewer.tsx`
- theme utilities if needed

Concrete steps:

1. detect reader theme
2. derive the correct dark/light PDF presentation for the current theme
3. apply that presentation inside the existing page render path
4. verify light/dark transitions do not break overlay alignment

---

## File-level direction

### Primary files

- `apps/web/src/components/reader/PdfViewer.tsx`
  - keep `react-pdf`
  - remove ink-oriented creation paths
  - add text-selection-backed annotation creation
  - apply dark-mode PDF presentation in the existing page render path

- `apps/web/src/components/reader/ReaderAnnotationLayer.tsx`
  - change rendering from single geometry primitives to `rects[]`-based markup
  - preserve selection popover, flash, ghost, and preview behavior

- `apps/web/src/lib/reader-annotations.ts`
  - redefine annotation kinds and body types
  - add helpers for union bbox and rect-list normalization

- `packages/db/src/schema/reader-annotations.ts`
  - update persisted kinds/body typing

- `apps/web/src/api/hooks/reader-annotations.ts`
  - keep client typing aligned with the new body shape

- `apps/web/src/components/reader/PaperWorkspace.tsx`
  - keep citation / note anchor / overlap logic working from the new annotation body

### Secondary files

- `apps/web/src/components/reader/FloatingMarkupPalette.tsx`
  - remove `ink`
  - potentially narrow or repurpose controls depending on the final creation UX

- `apps/web/src/components/reader/PdfViewer.test.tsx`
  - update tests away from free-draw highlight assumptions

---

## Risks

1. **PDF text layer variability**
   - text selection depends on the PDF text layer being present and trustworthy
   - scanned/image PDFs still cannot produce true text markup

2. **Selection rect fragmentation**
   - some PDFs produce many small selection rects
   - rendering and bbox computation should tolerate fragmented multi-line selections

3. **Compatibility rollout for `ink`**
   - old persisted rows may still exist
   - enum narrowing and UI narrowing should not happen in one careless step

4. **Note-anchor regressions**
   - note and citation logic currently assumes a simpler geometry model
   - the union-bbox helper must remain stable and reused everywhere

5. **Dark-mode expectations**
   - the current dark-mode PDF path is practical, not perfect, especially for raster-heavy pages
   - do not oversell this task as "perfect dark mode"

6. **Overlay alignment during theme changes**
   - page rerender under different theme-driven PDF presentation modes must not desynchronize overlay sizing or page measurements

---

## Testing strategy

### Unit / component

- `reader-annotations` helpers
  - union bbox from `rects[]`
  - empty rect handling
  - quote/body validation

- `ReaderAnnotationLayer`
  - multi-rect highlight rendering
  - multi-rect underline rendering
  - selection outline based on union bbox

### Integration

- `PdfViewer`
  - create highlight from text selection
  - create underline from text selection
  - no ink creation path exposed
  - dark-mode PDF presentation is applied when theme changes

- `PaperWorkspace`
  - note creation from highlight/underline still resolves block overlap
  - citation flashes still target the correct annotation

### Compatibility

- legacy `ink` rows do not crash the reader during rollout
- old highlight/underline rows are either migrated or explicitly handled

---

## Definition of done

This card is done when:

- Sapientia still uses `react-pdf` as the reader substrate
- block-level highlighting remains intact
- PDF reader annotations are true text-anchored `highlight` / `underline`
- `ink` is no longer part of the user-facing annotation surface
- note and citation behavior still work for reader annotations
- dark-mode PDF rendering has a real implementation path inside the existing `react-pdf` render flow

At that point, the reader will once again have a clean division of responsibility:

- block-level structure stays structural
- text markup behaves like text markup
- dark-mode work can proceed without a viewer rewrite
