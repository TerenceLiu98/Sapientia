# TASK-018: Marginalia v2 — gutter + rail in preview, responsive across viewports

**Estimated effort**: 4–5 working days, split across 6 PRs (Phase A is the gate; B–F can be sequenced or parallelized after A)
**Depends on**: TASK-008 (PdfViewer), TASK-011 (blocks), TASK-012 (NoteEditor), TASK-013 (block citations), TASK-017 (highlights)
**Phase**: 2 — Block-Level Foundation + Marginalia (closes the marginalia surface; Phase 3 begins after)

---

## Context

The right panel today is a separate column attached to the side of the reader workspace. It works, but it reads as **"a list of notes that happens to know about the PDF"** — a sidebar, not a margin. The product thesis is the opposite: notes are commentary that happens beside the sentence that provoked them.

The redesign is captured visually in [`demo/marginalia-responsive.html`](../../demo/marginalia-responsive.html), which itself stands on three earlier explorations ([`marginalia-notes.html`](../../demo/marginalia-notes.html), [`marginalia-slip-lane.html`](../../demo/marginalia-slip-lane.html), the gutter + rail synthesis). The git-tree variant ([`marginalia-git-tree.html`](../../demo/marginalia-git-tree.html)) was explored and **explicitly excluded** — co-citation visualization is not part of v0.1.

The README's hint about TASK-018 was: *"draft only after TASK-012 and TASK-013 are implemented and you've spent 1-2 weeks reading actual papers in the system."* That bar has been met.

### What the redesign solves

1. **Notes stop being "another column."** The slip lane lives inside the PDF preview's right whitespace; the rail (scrollbar + minimap) is the rightmost 44px. The whole right side reads as a single layered surface.
2. **The 13" laptop case stops being broken.** Demo 2 (the wide-mode predecessor) only worked at ≥1280px content width. The responsive design defines a compact mode (~960–1180px), a mobile mode (<760px), a markdown-preview mode, a zoom-floating mode, and a full-screen writing escape hatch — all sharing the same vocabulary (anchor / slip / rail / source color), only the density changes.
3. **Markdown preview gets parity.** Wiki pages and OcrPane-style markdown views can host the same gutter+rail because anchor positions are computed at render time from `getBoundingClientRect`, not stored as pixels.
4. **Long notes get a real surface.** A 720px centered fullscreen mode lets the user write a serious paragraph without violating marginalia at rest — it's an explicit escape hatch, not the default.

### What stays the same

- The `notes` and `block_highlights` data models are unchanged. Anchors are already stored as `{ paperId, blockId, x, y, w, h }` in 0..1 normalized coordinates — that abstraction survives this rewrite intact.
- `formatBlocksForAgent()` and the citation chip schema are untouched.
- The Tiptap/Novel editor is untouched. It just gets new container shells (in-place expand, overlay card, mobile drawer, fullscreen surface).
- Color semantics from TASK-017 (questioning / important / original / pending / background) drive the slip's left edge color in every mode.

### What is excluded from v0.1

- **Co-citation arc visualization** (the git-tree rail variant). Defer to v0.2 if at all.
- **Drag-resizable gutter**. The breakpoint switch is hard, not user-configurable.
- **Multi-note in-place expand**. One slip expanded at a time, in every mode. (This is a marginalia philosophy decision, not a technical limitation.)
- **Annotation-only notes** (highlight without note text). Already handled by TASK-017; nothing new here.

---

## Design source of truth

The visual / interaction spec lives in [`demo/marginalia-responsive.html`](../../demo/marginalia-responsive.html). When code and demo disagree:

- **Layout geometry** (column widths, breakpoints, padding values): demo wins. Read off the CSS.
- **Behavior** (when to expand vs overlay vs drawer, what stays sticky during zoom, etc.): demo wins. Read the inline comments.
- **Tokens** (colors, shadows, radii): the existing `tailwind` theme + `docs/DESIGN_TOKENS.md` win. The demo borrows from these but isn't authoritative.
- **Copy** (Chinese/English microcopy in slip cards): work-in-progress. Use whatever ships in the existing UI; don't import demo strings literally.

---

## Cross-cutting invariants

These hold across **every** phase. Violating them = bug.

1. **Anchor identity is `(paperId, blockId)` + 0..1 bbox**, never pixels. Slip y is computed at render time from the rendered block's bounding rect. Same anchor record renders correctly in PDF view at any zoom, in markdown preview, on mobile, and in fullscreen.
2. **Source tag is the slip's first line.** Format: `highlight n · p.P · blk.B` (PDF) or `§ S · blk-K` (markdown). Reader can identify the anchor from the slip alone, no metadata panel.
3. **Source color is identity, not decoration.** The 3px left edge color comes from the highlight's semantic color (or from a default if the slip is anchored to a block without a highlight). Same color across gutter / drawer / fullscreen surfaces — visual fingerprint that survives layout changes.
4. **One expanded slip at a time.** Per workspace, per session.
5. **Cite ≠ New note.** Notes are created only from PDF/markdown selection toolbars (TASK-012/013/017 paths). The gutter, drawer, and rail are read+edit surfaces, never creation surfaces. This is a hard rule across all phases.
6. **Rail (minimap) is optional UI, not infrastructure.** When the rail is hidden (mobile), nothing else breaks — the rail is a navigation aid, not a data surface.
7. **No new dependencies.** The current stack (React 19, Tailwind v4, react-pdf, Tiptap/Novel, Zustand, TanStack Query) is sufficient. Specifically: do not add `react-resizable-panels`, `framer-motion`, or any slot/portal library beyond what's already vendored.

---

## Acceptance Criteria (per phase)

Phase-level acceptance is listed inside each phase below. Across all phases:

- **Existing tests pass.** `NotesPanel.test.tsx`, `PdfViewer.test.tsx`, `BlocksPanel.test.tsx`, `citation-schema.test.tsx` need positional/layout assertion updates as physical positions change. Data-shape and behavior assertions must stay green.
- **No anchor data migration.** All changes are presentation-layer.
- **No new BullMQ jobs, no new API endpoints.** Pure frontend rework.
- **Each phase is independently shippable.** If we ship A but not B, the compact case degrades gracefully (slips just look cramped, nothing breaks).

---

## Status (2026-04-29)

- **Phase A** — wide-mode gutter+rail in PDF preview · ✅ shipped (`8ff8ba6`)
- **Phase B** — compact breakpoint with overlay-card expand · ✅ shipped (`c1febd2`)
- **Phase C** — mobile drawer · ⏸ **deferred** (mobile is not a v0.1 priority; current `< lg` fallback keeps the absolute-overlay panel from Phase A — usable, just not native-mobile shaped)
- **Phase D** — marginalia in markdown view · ✅ shipped (`909722d`)
- **Phase E** — zoom floating gutter · ⏸ **deferred to a future iteration** (only triggers when PDF zoom pushes the page wider than the container; rare in normal reading. Will be re-opened if real usage shows the gutter occlusion)
- **Phase F** — fullscreen writing escape hatch · ⏸ **deferred to a future iteration** (the wide-mode 520px / compact-mode 430px / mobile drawer-full surfaces cover most note lengths today; we'll revisit once accumulated marginalia shows enough "I had to keep typing past the edge" friction to justify another mode)

Plus collateral fixes shipped under TASK-018: `noteEditorContentCache` invalidation on save (`12d3d01`), Tiptap `horizontalRule` extension dedupe, save-status moved from in-editor text to a single icon in the slip header.

C / E / F can each be re-opened later as their own follow-up — the cross-cutting invariants and the gutterMode hook from Phase B are designed to host them without restructuring.

---

## Phase A — Wide-mode restructure (the gate)

**Goal**: Move the slip lane and rail from a separate sidebar column into the PDF preview's right whitespace. Keep all current anchor math, parallax behavior, and minimap semantics. Only the position changes.

### Visual target

[`demo/marginalia-responsive.html`](../../demo/marginalia-responsive.html) → Section 1 → "① Wide". Geometry:

- PDF column has `padding-right: 308px` (was 0)
- Slip lane: 272px wide, `transform: translateX(-272px)` so it overlaps onto PDF's reserved padding
- Rail: 44px column at the rightmost edge
- Active slip can grow leftward into the PDF whitespace (up to ~520px expanded width)

### Implementation

**Files affected**:

- `apps/web/src/components/reader/PaperWorkspace.tsx` — remove the right sidebar column from `MainNotesSplit`. The new layout is a single workspace surface; slip lane + rail are children of `PdfViewer`'s container, not siblings.
- `apps/web/src/components/reader/PdfViewer.tsx` — its container becomes a 3-column grid: `[ pdf | gutter (overlapping) | rail ]`. PDF text padding-right is reserved for slip lane to occupy.
- `apps/web/src/components/notes/NotesPanel.tsx` — already has the rail+slip-lane logic; refactor to be a child of `PdfViewer`'s right region rather than a sibling. Drop the outer column wrapper. Internal logic (`parallax`, dot positions, expanded slip y) is preserved.
- `apps/web/src/components/layout/AppShell.tsx` — review whether the right rail toggle/region needs adjustment (likely just removed, since the workspace no longer has a separate right column).

**Renaming opportunities** (optional but valuable for future agents):

- `NotesPanel` → `MarginaliaSurface` (or keep the name; it's a panel of marginalia, the new name is just clearer about role)
- The existing "rail" code stays named `rail`; the existing "slip lane" code stays named `slipLane`.

**Behavioral changes**:

- The "collapse / expand sidebar" toggle in TopBar becomes a "show / hide marginalia" toggle. When hidden, slip lane and rail both vanish, PDF reclaims the full width. (When unhidden, the gutter geometry is the new wide-mode layout.)
- Expanded slip's max width: 520px (was different in current code; align to demo).
- Expanded slip grows **leftward** into PDF whitespace. The right edge stays glued to the rail dot — that's the visual anchor.
- Parallax factor stays 0.78. (Don't touch this; it's a feel detail tuned by hand.)
- `lg:` breakpoint for showing the slip lane: ≥1280px content width. Below that we degrade — but Phase A only ships the wide path; degradation is Phase B's job.

### Phase A acceptance

1. **Layout matches demo wide-mode** at viewport ≥1280px: PDF text column on the left, gutter (slip lane) inside PDF's right padding, rail on far right.
2. **All existing notes render** in the new gutter at the same vertical positions they had in the old sidebar (subject to parallax).
3. **Expanded slip grows leftward** into the PDF whitespace, max 520px, with the connector to its rail dot intact.
4. **Toggle behavior**: TopBar control hides/shows the marginalia surface; when hidden, PDF gets the full width.
5. **All anchor math is unchanged** — `NotesPanel.test.tsx` data assertions still pass; only positional assertions updated.
6. **`PdfViewer.test.tsx`** updated for the new container geometry; PDF rendering correctness assertions still pass.
7. **No regression** in highlight creation, note creation, citation flow, scroll-to-anchor — these all still work end-to-end.
8. **Performance**: gutter slip positions update on PDF scroll without jank (no JS hot loop computing `getBoundingClientRect` on every scroll event — use the existing parallax math, which is scroll-driven but cheap).

### Phase A risks

- **Stacking context for expanded slip.** Growing leftward across the PDF means the expanded slip card lives above the PDF in z-order. Selection events on the PDF beneath the expanded slip should not fall through. Verify pointer events.
- **`react-pdf` page width assumption.** The PDF page currently fits to the available width. Reserving 308px on the right means the PDF page becomes narrower at the same window width. Make sure the fit-to-width math accounts for this and doesn't try to render at the old width and overflow.
- **Existing TopBar controls.** The "show notes / show blocks / show OCR" three-way toggle may need to be reorganized. Notes-rail-on/off becomes one boolean; blocks panel and OCR pane stay as alternative views in the main column.
- **AnnotationLayer + gutter co-existence.** `ReaderAnnotationLayer.tsx` paints annotations on the PDF coordinate space; the gutter sits on top. Make sure click/hover on annotations still works (annotations are inside the PDF column; gutter is to the right; should not conflict).

### Phase A is the gate

**Do not start B/C/D/E/F until Phase A is merged and stable for at least one work session.** The downstream phases all assume the new container structure exists.

---

## Phase B — Compact breakpoint (~960–1180px content width)

**Goal**: At viewport widths where the wide gutter would cramp the PDF reading column, compress the gutter and switch the expand interaction from "in-place grow" to "overlay card with backdrop dim."

### Visual target

[`demo/marginalia-responsive.html`](../../demo/marginalia-responsive.html) → Section 1 → "② Compact". Geometry:

- PDF padding-right: 218px (was 308px in wide)
- Slip lane: 196px wide, `translateX(-196px)`
- Rail: 36px (slightly narrower than wide's 44px)
- Slip excerpt clamps to **1 line** (was 3)
- Click → overlay card (~430px wide) with backdrop dim, anchored visually to the rail dot via a dashed connector

### Implementation

**Files affected**:

- `apps/web/src/components/notes/NotesPanel.tsx` — read the container width via `ResizeObserver` (already used in PdfViewer fit-to-width). Branch on width:
  - `≥1280px`: wide mode (Phase A).
  - `960–1280px`: compact mode (this phase).
- New component: `apps/web/src/components/notes/OverlayNoteCard.tsx`. Renders the expanded card on top of the workspace with backdrop. Receives the same props the current expanded slip receives.
- New helper: `useGutterMode()` Zustand store slice or local context that exposes `'wide' | 'compact' | 'mobile'` to all gutter consumers.

**Behavioral changes**:

- In compact mode, the expanded slip is **NOT** in the slip lane — it's a sibling of the lane, positioned absolutely over the PDF, with a backdrop dim. The folded slip in the lane stays visible but at 35% opacity (placeholder).
- Anchor connector is a dashed SVG line from the rail dot to the overlay card's right edge. Curve gently if the y delta is large.
- Closing the overlay (× button or Esc) restores the folded slip to full opacity.

### Phase B acceptance

1. **Container width-based mode switching** works without page reload — resize the window, layout updates.
2. **Compact-mode geometry** matches demo (gutter 196px, slip 1-line, rail 36px).
3. **Overlay expand** works: click folded slip → overlay card appears with backdrop, dashed connector to dot.
4. **Folded placeholder** of the expanded slip stays visible at reduced opacity in the lane.
5. **Esc closes** the overlay; click on backdrop also closes.
6. **No layout shift** when toggling between an expanded and folded state (both should produce the same lane layout, since the placeholder slip stays).

### Phase B open question (resolve during implementation)

- Does compact mode need a "↗ go fullscreen" affordance from inside the overlay? (Phase F adds the fullscreen surface.) Recommendation: yes, ship the icon button in Phase B, wire it to a no-op until Phase F lands.

---

## Phase C — Mobile drawer (<760px) · ⏸ deferred

> **Status**: deferred. Mobile is not a v0.1 priority (per CLAUDE.md product scope). The current behavior below `lg:` is the Phase A absolute-overlay fallback — the gutter still appears, just covering the main pane rather than docking inline. That's serviceable on tablets and not catastrophic on phones; we'll come back when mobile is in scope.
>
> When re-opening: the `useGutterMode` hook from Phase B already returns `'mobile'` below 760px, so the entry point is just branching the render.

**Goal**: At narrow widths, the gutter cannot fit. Replace it with inline anchor pills inside PDF blocks and a bottom drawer that holds the note list. Rail is hidden entirely.

### Visual target

[`demo/marginalia-responsive.html`](../../demo/marginalia-responsive.html) → Section 1 → "③ Mobile". Geometry:

- PDF takes full width (with normal text padding).
- Each block that has notes gets a small inline anchor pill at its right edge: a colored dot + count (e.g. `● 2`). Single-source = solid color, multi-source = conic-gradient pie.
- Bottom drawer with three states: **peek** (~88px, just handle + summary), **half** (~280px, current page's note list), **full** (~entire viewport, editing a single note).
- No rail.

### Implementation

**Files affected**:

- `apps/web/src/components/reader/PdfViewer.tsx` — when `gutterMode === 'mobile'`, attach inline anchor pills to each annotated block's right edge. Use existing block-rendering helpers; pills are positioned via the same 0..1 bbox coordinates.
- New component: `apps/web/src/components/notes/MobileNoteDrawer.tsx`. Three states; uses pure CSS transitions (no `framer-motion`). Drag handle is the standard mobile pattern (touch target ≥44px).
- `useGutterMode()` returns `'mobile'` below 760px content width; `NotesPanel` returns null in that case (the drawer takes over).

**Behavioral changes**:

- Tapping an inline pill: drawer expands to **half** state and scrolls to the relevant note.
- Tapping a slip in the drawer: drawer transitions to **full** state, slip becomes a fullscreen-like editor inside the drawer (not a modal — the drawer just gets bigger).
- Tapping outside drawer (on PDF area): drawer transitions back toward **peek**.
- Drag handle: drag to resize between three discrete states (snap, no continuous resize).

### Phase C acceptance

1. **Below 760px**, gutter is gone, rail is gone, inline anchor pills appear on annotated blocks, drawer appears at bottom in **peek** state.
2. **Inline pill geometry** scales with PDF zoom (pills positioned via 0..1 coordinates, sized in CSS rem so they don't grow with zoom).
3. **Drawer states** all reachable: peek → half → full, both via tap-on-pill and via drag.
4. **Editing in full state** works end-to-end — Tiptap editor receives focus, citations work, save works.
5. **Pull-to-peek**: dragging drawer back below half height collapses to peek; never collapses below peek (always at least the handle is visible).
6. **No rail in mobile**, confirmed in tests.

### Phase C risks

- **Touch event handling on the PDF surface vs the drawer.** The drawer's drag handle needs to capture pointer events; PDF beneath should not receive them during a drag.
- **iOS Safari viewport units.** `100vh` is unreliable. Use `100dvh` for drawer-full state.
- **Inline pill conflict with text selection.** Pills are visually inside blocks, so tapping near them might select text instead. Make pill click target large enough and prevent text selection on the pill itself (`user-select: none`).

---

## Phase D — Markdown preview parity

**Goal**: Markdown views (OcrPane today; future wiki pages) host the same gutter+rail surface as PDF view. The only difference is anchor computation: markdown blocks have flowing layout, so slip positions are computed from `getBoundingClientRect` instead of stored bboxes.

### Visual target

[`demo/marginalia-responsive.html`](../../demo/marginalia-responsive.html) → Section 2 → "Markdown preview". Geometry:

- Same wide layout as Phase A: PDF padding-right replaced by markdown's right padding (~308px for gutter).
- Each markdown block gets a left-edge marker (small dot with `data-block-id` label nearby on hover). Color = highlight color (if any). Replaces the PDF's right-edge anchor pin.
- Rail uses **section markers** (`§1`, `§2`, `§3`) instead of page markers.
- Slip source tag changes format: `§ S · blk-K` (was `highlight n · p.P · blk.B` for PDF).

### Implementation

**Files affected**:

- `apps/web/src/components/reader/OcrPane.tsx` — add the gutter+rail surface as a child, parallel to how Phase A added it to PdfViewer. Container becomes the same 3-column grid.
- `apps/web/src/components/reader/MarkdownBlockMark.tsx` (new) — left-edge dot/label component; one per rendered block.
- `apps/web/src/components/notes/NotesPanel.tsx` — abstract "anchor y" computation behind a `getAnchorY(noteAnchor)` callback. Implementations:
  - PDF: existing math (page index + 0..1 y coordinate × page rendered height).
  - Markdown: `block.getBoundingClientRect().top - container.getBoundingClientRect().top`.
- Slip source tag rendering: branch on view mode — PDF format vs. markdown format.

**Behavioral changes**:

- Switching between PDF view and markdown view (TopBar toggle) keeps the same notes visible at logically equivalent positions.
- Rail in markdown mode shows section markers from the document's heading hierarchy. Use a simple table of contents extraction (h2, h3) to position section labels at the y of each heading.
- `IntersectionObserver` watches each block; only blocks in/near viewport contribute to active dot computation. (In wide mode the rail shows all dots; in compact this could be optimized later.)

### Phase D acceptance

1. **Markdown view has gutter+rail** in wide mode, slips visible at correct positions.
2. **Toggle between PDF and markdown** preserves note state; same notes appear in both views, both visible, anchored to logically equivalent positions.
3. **Section markers** appear on the rail at correct y positions, derived from heading structure.
4. **Block left-edge markers** show on every markdown block; colored variants on blocks that have notes/highlights.
5. **Slip source tag format** uses `§ S · blk-K` in markdown mode, `highlight n · p.P · blk.B` in PDF mode, same data underneath.
6. **Resize / scroll** updates slip positions correctly (verify via `getBoundingClientRect`-based math, not pixel storage).

### Phase D open question

- Should the markdown block's left-edge `blk-XX` label be always visible, or only on hover/focus? Always-visible reinforces the "every block is addressable" mental model but adds visual noise. Recommendation: always-visible at low opacity (~0.5), brightens on block hover. Revisit after week of dogfooding.

---

## Phase E — Zoom floating gutter · ⏸ deferred

> **Status**: deferred to a future iteration. Triggers only when PDF zoom > 100% pushes the page wider than its container (horizontal scroll appears). In normal `fit-to-width` reading the gutter docks correctly via Phase A. Re-open once we either ship a manual zoom control or see real users hitting the failure mode.
>
> When re-opening: the entry point is detecting `pdf_page_width > container_width` (likely via `ResizeObserver` on PdfViewer's inner page element) and toggling the slip-lane to `position: absolute right-44px` with a backdrop blur + an "floating · zoom N%" badge. SVG arc connector from rail dot to slip is **not** required — user explicitly declined it during Phase B.

**Goal**: When the user zooms the PDF beyond 100% so the page is wider than the container, there's no whitespace right of the page for the gutter to dock against. The gutter detaches from the page edge and floats against the viewport's right edge instead.

### Visual target

[`demo/marginalia-responsive.html`](../../demo/marginalia-responsive.html) → Section 3 → "A · PDF zoom = 150%". Geometry:

- PDF page itself overflows (horizontal scroll).
- Gutter docks to viewport's right edge with `position: absolute; right: 44px` (rail still occupies its 44px) plus `backdrop-filter: blur(6px)` for visual separation from the PDF beneath.
- A small "floating · zoom 150%" badge appears at the gutter top (amber color) signaling the detachment.
- Connector arc between rail dot and active slip becomes a curved SVG path (was a straight line in wide mode).

### Implementation

**Files affected**:

- `apps/web/src/components/reader/PdfViewer.tsx` — detect when zoom causes PDF page width > container width. When true, set a `gutter-floating` attribute on the workspace.
- `apps/web/src/components/notes/NotesPanel.tsx` — when `gutterFloating === true`, switch the slip lane from `position: relative` (inside PDF padding) to `position: absolute` (right edge of workspace). Add backdrop blur. Render the floating badge.
- Connector arc: when floating, the connector between rail dot and active slip needs a curved path (because the slip's x position no longer corresponds 1:1 with the PDF anchor). Use a quadratic Bezier; midpoint pulled left by ~80px.

**Behavioral changes**:

- Zoom transition: smoothly transition from docked → floating when zoom crosses 100% threshold (or when page width exceeds container). Avoid layout flash.
- Inside floating mode, slip y positions still come from the PDF anchor's rendered y, projected to viewport coordinates. (Slip stays at the same y as its anchor block, even though the anchor block may have horizontal-scrolled out of view.)
- If the anchor block is horizontally scrolled out of view, the slip is still visible (it's docked to the viewport, not the anchor) — this is desired behavior.

### Phase E acceptance

1. **Zoom > 100% with horizontal overflow** → gutter detaches and floats on viewport right edge with blur backdrop and amber "floating" badge.
2. **Zoom ≤ 100%** → gutter stays docked (Phase A behavior).
3. **Threshold transition** is visually smooth (no flash).
4. **Connector arc** is curved when floating, straight when docked.
5. **Slip y stays anchored to its block's rendered y**, even when the anchor is off-screen horizontally.
6. **Rail behavior unchanged** by zoom — rail dots still represent normalized 0..1 positions in the document.

### Phase E open question

- z-order between the floating gutter and the PDF selection toolbar (TASK-017 toolbar). When the user selects text inside the zoomed PDF, the toolbar appears near the selection. Where does it land relative to the floating gutter? Recommendation: PDF toolbar wins z-order (it's the active interaction); gutter dims to 50% opacity for the duration of selection. Revisit during implementation.

---

## Phase F — Fullscreen writing escape hatch · ⏸ deferred

> **Status**: deferred to a future iteration. The currently shipping surfaces — wide-mode in-place expand at 520px, compact-mode overlay at 430px, mobile drawer-full — cover note lengths up to roughly 3 paragraphs comfortably. Re-open when real usage shows the friction of "I had to keep typing past the edge" enough times to justify another mode.
>
> When re-opening: the entry point is a `↗` icon in the slip header alongside Jump / Close / SaveStatusIcon, plus a new `FullscreenNoteEditor` component (centered 720px card, blurred PDF backdrop, sharp anchor-reference card top-right with the highlight quote, `← back to margin · esc` pill top-left). The Tiptap editor instance must be hoisted (or DOM-portaled) rather than remounted on transition — see Phase F risk #6 in the original plan; otherwise IME/undo state is lost.

**Goal**: When a note grows beyond what fits comfortably in the gutter (~3 paragraphs at the wide expand width), provide an explicit fullscreen surface. The PDF dims/blurs in the background; the anchor block surfaces as a small reference card so the writer never loses track of what they're responding to.

### Visual target

[`demo/marginalia-responsive.html`](../../demo/marginalia-responsive.html) → Section 3 → "B · 全屏写作". Geometry:

- PDF visible behind a `backdrop-filter: blur(2.5px)` + `color-mix(... ink-7 22% transparent)` dim overlay.
- Note surface centered, max-width 720px, top: 70px, bottom: 30px from viewport.
- Top-left: pill `← back to margin · esc`.
- Top-right: anchor reference card (~280px wide), unblurred, showing the source quote with the highlighted phrase emphasized.
- Editor body: 16.5pt serif, line-height 1.7 — comfortable long-form reading width.

### Implementation

**Files affected**:

- New component: `apps/web/src/components/notes/FullscreenNoteEditor.tsx`. Wraps the existing `NoteEditor` (Tiptap) in the centered surface. Includes:
  - Top-left back pill (Esc / button)
  - Top-right anchor reference card (uses the existing block citation rendering as a snippet)
  - Body: full-width Tiptap editor
  - Footer: save status, word count, "back to margin" alternate trigger
- Trigger entry point: `↗` icon button inside any expanded slip (wide mode in-place expand, compact mode overlay, mobile drawer-full state). All three converge on the same fullscreen component.
- `apps/web/src/components/notes/NotesPanel.tsx` (or the workspace level) — manage a `fullscreenNoteId` state. When set, render `FullscreenNoteEditor`; PDF stays mounted underneath but with `pointer-events: none` and the blur overlay applied.

**Behavioral changes**:

- Esc / back pill / save returns to whichever mode the user came from (gutter expand / overlay / drawer).
- Save behavior unchanged — autosave on every Tiptap update, same debouncing.
- Anchor reference card is **read-only** — clicking it does **not** scroll the PDF or change focus. (The user is writing, not reading — keeping focus inside the writing surface is intentional.)

### Phase F acceptance

1. **`↗` button** in expanded slip / overlay / drawer-full opens fullscreen editor.
2. **PDF stays visible** behind blur+dim, reading-anchor block can still be seen (faintly) at its original position.
3. **Anchor reference card** at top-right shows the source passage with highlighted phrase emphasized; stays sharp (not blurred).
4. **Esc / back pill / save** returns to the prior mode; note state persists; PDF un-blurs.
5. **Editor surface** is 720px max width with comfortable typography (16.5pt serif, 1.7 line-height).
6. **No regression**: all existing NoteEditor functionality (citations, highlights, formatting, save) works inside the fullscreen surface.

### Phase F open question

- Anchor reference card draggable? When the writer wants the anchor visible top-left while writing, fixed top-right may obstruct. Recommendation: ship fixed top-right; revisit after dogfooding. (Demo's open question file already flags this.)

---

## Cross-cutting: testing strategy

### Existing tests that need updates

- **`NotesPanel.test.tsx`** — positional assertions for slip y-coordinates need updates after Phase A (gutter is now inside PDF column, math may shift slightly). Data and behavior assertions stay green.
- **`PdfViewer.test.tsx`** — container geometry changes after Phase A; update viewport-width and padding assertions.
- **`BlocksPanel.test.tsx`** — should not be affected directly; left-edge color band semantics from TASK-017 are preserved.
- **`citation-schema.test.tsx`** — should not be affected.

### New test surfaces

- **Mode-switching test** (Phase A/B/C): mount workspace at viewport widths 1400 / 1080 / 600, assert that `gutterMode` is `'wide' / 'compact' / 'mobile'` respectively and the correct surface (gutter / overlay / drawer) is rendered.
- **Resize test** (Phase B): mount at 1400, resize to 1080, assert layout transitions cleanly. Resize back, assert restoration.
- **Markdown anchor math test** (Phase D): mount markdown view with mocked block bounding rects, assert slip y = block top.
- **Floating threshold test** (Phase E): mock PDF page width > container width, assert gutter is in floating mode.
- **Fullscreen open/close test** (Phase F): trigger fullscreen, assert PDF blur is applied; trigger close, assert blur is removed; assert focus returns to the slip in its prior mode.

### What we explicitly do NOT test

- **Visual regression**. We don't have a visual regression suite. Pixel-exact matching with the demo isn't required; behavior + semantic structure is.
- **Cross-browser zoom rendering nuances** in Phase E. Test the threshold logic; trust the browser to render the floating gutter consistently.
- **Animation timings**. Use defaults; don't snapshot transitions.

---

## Cross-cutting: design tokens

If new tokens are needed (e.g., `gutter-width-wide`, `gutter-width-compact`, `slip-shadow-floating`), add them to `docs/DESIGN_TOKENS.md` AND to the Tailwind theme. **Do not** hardcode magic numbers in components.

Likely additions:

- `gutter.width.wide` — 272px
- `gutter.width.compact` — 196px
- `gutter.padding-right.wide` — 308px (PDF padding to leave room for gutter)
- `gutter.padding-right.compact` — 218px
- `rail.width.wide` — 44px
- `rail.width.compact` — 36px
- `slip.expand.max-width` — 520px
- `breakpoint.compact` — 1180px (max content width before we drop to compact)
- `breakpoint.mobile` — 760px (max content width before we drop to mobile)

---

## Risks (cross-cutting)

1. **Test brittleness from positional assertions.** Many existing tests pin slip y to within a few pixels. Phase A will break these. **Mitigation**: rewrite affected assertions to use semantic queries (`getByRole`, `getByText`) before geometric ones; only assert geometry where geometry is the SUT.

2. **AnnotationLayer + gutter overlap.** The annotation paint surface and the gutter both sit on the right side of the PDF. **Mitigation**: gutter is in a separate stacking context with its own DOM subtree; annotations are inside the PDF column. They should not overlap if Phase A's grid is set up correctly. Verify by clicking through annotations near the right edge of PDF.

3. **OcrPane state today.** The markdown view (OcrPane.tsx) is already implemented but the level of integration with notes is unknown to this task card. Phase D may discover that OcrPane needs a precursor refactor. **Mitigation**: budget extra time for Phase D; it may grow to ~1.5 days.

4. **Mobile drag interactions.** The drawer's snap-between-states drag is the most novel interaction in the whole task. **Mitigation**: build it last (Phase C is sequenced after A/B which establish the data and component plumbing). Use a thin custom pointer-events handler; don't pull in a gesture library.

5. **Zoom threshold detection (Phase E)**. `react-pdf`'s zoom is internal; we need a stable signal for "page width > container width." **Mitigation**: use `ResizeObserver` on the PDF page element vs the container element. If react-pdf's API exposes the rendered page width directly, prefer that.

6. **Tiptap re-mount in fullscreen (Phase F).** If the FullscreenNoteEditor literally remounts the Tiptap instance, IME composition state and undo history may be lost. **Mitigation**: hoist the Tiptap editor instance to a higher level (workspace) and pass it down to either the gutter slip or the fullscreen surface. Or: portal the editor's DOM rather than remount.

---

## Open questions (resolve during implementation, defer to NOTES.md if not blocking)

These are lifted from the demo's "open questions" section plus a few discovered during code survey. Each tagged with the phase that should resolve it (or **post** for v0.2 deferral).

- **[B]** Does compact-mode overlay need an intermediate "half-fullscreen" (~600px) state in addition to the 430px overlay and the 720px fullscreen? **Recommendation**: ship two states (overlay + fullscreen) only; revisit if user testing reveals demand.
- **[C]** When mobile drawer is full-state, how is anchor visible to the writer? Sticky breadcrumb at top of drawer-full, showing the anchor block's first sentence? **Recommendation**: yes, ship a 1-line sticky breadcrumb in drawer-full mode.
- **[D]** Block-id labels on markdown blocks: always-visible (low opacity) vs. hover-only? **Recommendation**: always-visible at ~0.5 opacity, brightens on hover. Revisit after dogfooding.
- **[E]** PDF selection toolbar z-order vs. floating gutter. **Recommendation**: toolbar wins, gutter dims to 50% during active selection.
- **[F]** Anchor reference card draggable? **Recommendation**: fixed top-right initially.
- **[Cross]** Window resize across breakpoints: smooth animation vs. hard switch? **Recommendation**: hard switch. Animating between 3-line excerpt and 1-line excerpt causes text reflow during animation; ugly.
- **[Cross]** What happens when the user has BOTH the workspace blocks panel open AND the gutter? Recommendation: blocks panel and gutter are mutually exclusive; the workspace's main column shows one of `pdf | blocks | ocr`, and the gutter+rail attach to whichever is active.

---

## References

- **Design source**: [`demo/marginalia-responsive.html`](../../demo/marginalia-responsive.html)
- **Predecessor demos** (kept for context, not authoritative):
  - [`demo/marginalia-notes.html`](../../demo/marginalia-notes.html) — v1, sidebar-as-marginalia
  - [`demo/marginalia-slip-lane.html`](../../demo/marginalia-slip-lane.html) — v2, gutter+rail wide-mode
  - [`demo/marginalia-git-tree.html`](../../demo/marginalia-git-tree.html) — git-tree variant, **excluded from v0.1**
- **Philosophy**: [`docs/PHILOSOPHY.md`](../PHILOSOPHY.md), PRD §1 (marginalia → Zettelkasten loop)
- **Predecessor task cards**:
  - [TASK-008](TASK-008.md) — react-pdf viewer
  - [TASK-011](TASK-011.md) — block schema
  - [TASK-012](TASK-012.md) — note editor
  - [TASK-013](TASK-013.md) — note → block citations
  - [TASK-017](TASK-017.md) — block highlights
- **Files most affected** (consolidated):
  - `apps/web/src/components/reader/PaperWorkspace.tsx`
  - `apps/web/src/components/reader/PdfViewer.tsx`
  - `apps/web/src/components/reader/OcrPane.tsx`
  - `apps/web/src/components/reader/ReaderAnnotationLayer.tsx`
  - `apps/web/src/components/notes/NotesPanel.tsx`
  - `apps/web/src/components/layout/AppShell.tsx`
  - **New**:
    - `apps/web/src/components/notes/OverlayNoteCard.tsx` (Phase B)
    - `apps/web/src/components/notes/MobileNoteDrawer.tsx` (Phase C)
    - `apps/web/src/components/reader/MarkdownBlockMark.tsx` (Phase D)
    - `apps/web/src/components/notes/FullscreenNoteEditor.tsx` (Phase F)

---

*Drafted 2026-04-29. Implementation begins with Phase A; each subsequent phase opens its own PR after Phase A merges.*
