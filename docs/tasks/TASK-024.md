# TASK-024: Markdown rendering audit and unification plan

**Priority**: Medium  
**Status**: In Progress (Track 1 + Track 2 v1 shipped; optional cleanup and future-scope decisions remain)  
**Estimated effort**: 2-4 working days for v1 unification, separate follow-up if MDX is adopted later  
**Depends on**: TASK-018 (markdown-view parity), TASK-023 (reader dark-mode surface reset), current `BlocksPanel` / `AgentMessage` / note serialization pipeline  
**Phase**: 2.6 — Markdown rendering architecture and design-token alignment

---

## Context

Sapientia currently uses the word "markdown" to describe several different things:

1. the paper-side `md-only` reading mode
2. assistant/agent message rendering
3. lossy note serialization for search + LLM context

These are not the same system today.

The codebase currently has:

- a **structured block renderer** for paper content in `BlocksPanel`
- a **string markdown renderer** for assistant output in `AgentMessage`
- a **markdown serializer**, but not a markdown renderer, for notes

This task exists to document that split, identify where the current rendering surfaces drift from design-token rules, and choose the right next step before introducing a new markdown/MDX abstraction by habit.

---

## Phase checkpoint

### Shipped in this task so far

- `AgentMessage` now renders through a shared `MarkdownProse` layer.
- Shared markdown prose supports:
  - GFM
  - citation chips
  - inline math
  - display math via KaTeX
- `md-only` now has:
  - named `--color-reader-md-*` surface tokens
  - a first-pass `reader-md__*` prose contract for parsed paper blocks
- `DESIGN_TOKENS.md` now documents both:
  - shared markdown prose rules
  - reader markdown prose rules

### Still open

- finish any remaining low-priority `md-only` pane chrome cleanup that still deserves tokenization
- decide whether to close this card at the current v1 checkpoint and spin any future MDX/authored-content exploration into a separate task

---

## Current state

### 1. Paper `md-only` mode is not a generic markdown renderer

The paper-side markdown view is driven by parsed `Block[]` records from the API, not by a markdown string.

Current implementation:

- `apps/web/src/api/hooks/blocks.ts` fetches structured paper blocks
- `apps/web/src/components/reader/BlocksPanel.tsx` renders them by block type
- KaTeX is rendered inline for math
- figures/tables/code/list/heading/text are rendered with bespoke React branches

Important consequence:

- this surface is better understood as a **flowing block renderer** or **structured reading renderer**, not a markdown engine

This distinction matters because replacing it with a generic markdown parser would lose:

- stable `blockId` ownership
- rail/marginalia anchor positioning
- block-level highlight semantics
- PDF↔markdown cross-pane coordination

### 2. Agent messages are rendered with `react-markdown`

Assistant output is currently the only true markdown-to-React rendering path in the web app.

Current implementation:

- dependency: `react-markdown`
- plugin: `remark-gfm`
- custom remark transform for block citations
- shared prose component mapping via `MarkdownProse`
- KaTeX-backed inline/display math support in the shared prose path

Files:

- `apps/web/package.json`
- `apps/web/src/components/agent/AgentMessage.tsx`

Important consequence:

- the app now has a reusable markdown prose layer, but it still has only one real production consumer today

### 3. Notes use markdown as a derived storage/search format

Notes are not rendered from markdown in the UI. Their canonical content is editor JSON.

Current implementation:

- notes store canonical JSON in object storage
- a lossy markdown sibling is derived on save
- that markdown is used for:
  - `md_object_key`
  - `agent_markdown_cache`
  - `search_text`

Files:

- `packages/shared/src/blocknote-to-md.ts`
- `apps/api/src/services/note.ts`
- `packages/db/src/schema/notes.ts`

Important consequence:

- changing UI markdown rendering libraries does not automatically simplify note storage/rendering, because notes are not currently driven by markdown-first UI

---

## Findings

### Finding 1 — Sapientia does not have one markdown system

There are three different concerns that happen to touch markdown:

1. **paper block rendering**
2. **assistant markdown prose**
3. **note serialization**

Any future refactor should preserve this separation instead of forcing them into one abstraction prematurely.

### Finding 2 — The biggest design-token drift is not color primitives, but missing prose-level tokens

Color usage has improved significantly after TASK-023, but markdown/prose rendering still lacks a shared semantic layer.

Two main drifts remain:

1. **`BlocksPanel` uses many inline `color-mix(...)` surfaces**
   - header surface
   - page badge
   - equation/code surface
   - figure/table fallback frame
   - block-local reading wells

   These are visually coherent, but they are still component-local formulas rather than named surface tokens.

2. **`AgentMessage` hardcodes typography/layout decisions inline**
   - heading sizes
   - list spacing
   - inline code sizing
   - code block sizing
   - table spacing
   - blockquote border/spacing

   These are not yet represented as a reusable prose vocabulary.

This means the app is tokenized at the **color/theme layer**, but not yet at the **markdown/prose component layer**.

### Finding 3 — `md-only` should not be replaced by a generic markdown renderer

Even though the UI label is "Markdown", that surface is actually deeply integrated with:

- `blockId`
- page grouping
- selection tracking
- rail layout
- note anchors
- marginalia
- block-level highlight/toolbar behavior

Replacing it with a string-based markdown renderer would likely be a regression in reader architecture.

### Finding 4 — `react-markdown` is currently a better fit than MDX for untrusted assistant output

The current assistant content is model-generated markdown, not authored MDX documents.

That means the current stack has advantages:

- simple string input
- safe markdown-first model
- direct support for `remark-gfm`
- easy custom citation rewriting

MDX would add a compile/evaluate layer and a broader content model than this surface currently needs.

---

## Design-token mismatches to address

### Reader / paper-side mismatches

- `BlocksPanel` still uses repeated local `color-mix(...)` formulas instead of named reader-surface tokens
- equation/code/fallback wells do not yet map to a documented prose or reading-surface vocabulary
- header chrome inside `md-only` is visually aligned, but still expressed as local composition rather than reusable tokens

### Agent markdown mismatches

- only one production consumer currently uses the shared prose layer
- citation chip styling is reusable now, but still should be treated as part of the prose contract rather than just a carry-over note style
- the shared prose layer still needs either a second real consumer or an explicit decision to remain single-consumer for now

### Rule-level mismatch with `DESIGN_TOKENS.md`

`DESIGN_TOKENS.md` says values should trace back to named tokens, but many markdown-like surfaces still depend on:

- component-local arbitrary spacing
- component-local font sizing
- component-local surface formulas

This is acceptable as an implementation phase, but not ideal as a stable rendering architecture.

---

## Two-track decision

This task should be handled as two separate tracks, because the product
surfaces solve different problems:

1. **`md-only` reader track**
2. **agent message track**

They should not be forced into one renderer choice.

---

## Track 1 — `md-only` reader

### What it is today

The `md-only` reader is a structured block renderer, not a markdown-string renderer.

It is built from:

- parsed `Block[]`
- page grouping
- block identity
- note/marginalia anchoring
- PDF↔markdown coordination

Primary file:

- `apps/web/src/components/reader/BlocksPanel.tsx`

Current implementation status:

- token cleanup has started for recurring `md-only` reader surfaces
- repeated local surface formulas are being consolidated behind
  `--color-reader-md-*` tokens
- a first-pass reader prose contract now exists for:
  - headings
  - body paragraphs
  - lists
  - code blocks
  - equation wells
  - figure captions
  - fallback blocks
- block/rail/selection architecture remains unchanged

### What should change

This surface should be improved as a **reader renderer**, not migrated to a generic markdown parser.

Recommended changes:

1. extract repeated reader-surface treatments into named tokens
2. standardize prose rhythm for:
   - headings
   - body text
   - code blocks
   - equation wells
   - figure/table fallback surfaces
3. keep block-level identity and rail math exactly as they are
4. continue treating KaTeX/math rendering as a first-class reader concern

### Should `md-only` adopt MDX?

**No.**

Reasoning:

- the surface is structure-first, not markdown-string-first
- it depends on `blockId` and layout semantics that generic markdown/MDX does not provide out of the box
- migrating to MDX would add complexity while weakening reader-specific affordances

### `md-only` recommendation

- **Keep the custom block renderer**
- **Do not migrate this surface to MDX**
- **Invest in token cleanup and prose consistency instead**

---

## Track 2 — Agent message

### What it is today

Agent output is a true markdown rendering surface.

It is built from:

- markdown string input
- `react-markdown`
- `remark-gfm`
- custom block-citation rewriting
- shared prose components
- KaTeX-backed math rendering for inline and display expressions

Primary file:

- `apps/web/src/components/agent/AgentMessage.tsx`

Current implementation status:

- `AgentMessage` now renders through `MarkdownProse`
- citation rewriting lives in a reusable remark helper
- markdown component mapping lives in shared prose components
- inline math and display math are supported in the shared prose path

Primary supporting files:

- `apps/web/src/components/markdown/MarkdownProse.tsx`
- `apps/web/src/components/markdown/markdown-components.tsx`
- `apps/web/src/components/markdown/remark-block-citations.ts`
- `apps/web/src/components/markdown/markdown-math.tsx`

### What should change

This surface should move toward a shared prose rendering layer.

Recommended changes:

1. extract the component map into shared markdown/prose components
2. define a reusable prose vocabulary for:
   - headings
   - paragraphs
   - lists
   - inline code
   - code blocks
   - tables
   - blockquotes
   - links
   - citation chips
   - inline math
   - display math
3. align those surfaces with design-token rules instead of leaving them inline in `AgentMessage`
4. reuse that prose layer in the next real markdown consumer instead of keeping it `AgentMessage`-only

### Should agent messages adopt MDX?

**Not right now.**

Reasoning:

- the input is model-generated markdown, not authored MDX documents
- `react-markdown` is simpler and better matched to untrusted markdown text
- MDX introduces compile/evaluate concerns and a broader content model than this surface needs today

### Agent message recommendation

- **Keep `react-markdown` for now**
- **Refactor the rendering into a shared prose layer**
- **Only revisit MDX if agent content becomes authored, component-rich, or document-like in a stronger sense**

### Remaining Track 2 follow-up

- document the prose contract more explicitly in `DESIGN_TOKENS.md`
- identify the next real markdown consumer for `MarkdownProse`
- avoid inventing an artificial second consumer just to justify the abstraction

---

## MDX evaluation

### Question

Should Sapientia replace the current markdown rendering approach with `@mdx-js/react`?

### Short answer

**Not as a blanket replacement.**

### Important technical clarification

`@mdx-js/react` is not a direct substitute for `react-markdown`.

It is primarily:

- a component provider/context layer for MDX content
- meant to work alongside an MDX compile/evaluate step such as `@mdx-js/mdx`

That makes it well-suited for authored MDX documents, but not automatically the best choice for every markdown string in the product.

Official references:

- `@mdx-js/react`: https://mdxjs.com/packages/react/
- `@mdx-js/mdx`: https://mdxjs.com/packages/mdx/
- MDX usage docs: https://mdxjs.com/docs/using-mdx/

### Potential gains if MDX is adopted in the right place

1. **Shared component vocabulary**
   - headings, code blocks, tables, admonitions, citations, and embedded components can be standardized cleanly

2. **Better fit for authored knowledge surfaces**
   - future wiki/help/docs pages
   - curated internal knowledge documents
   - hand-authored narrative pages with embedded React components

3. **Composable citation-aware content**
   - block chips, note chips, custom callouts, and future academic widgets can become first-class MDX components

### Likely costs / losses

1. **Not a good replacement for `BlocksPanel`**
   - `BlocksPanel` is structure-first, not markdown-string-first
   - migrating it to MDX would likely lose or complicate block ownership semantics

2. **More machinery for assistant messages**
   - assistant output is currently plain markdown
   - MDX introduces compile/evaluate concerns and a broader executable-content model
   - for LLM output, that is usually more complexity than value

3. **More infrastructure than current needs**
   - provider setup
   - compilation/evaluation path
   - stronger content validation/security boundaries

### Recommendation

- **`md-only`: do not replace `BlocksPanel` with MDX**
- **agent message: do not replace `react-markdown` with MDX as the immediate next step**
- **consider MDX later for authored content surfaces** such as wiki pages, system docs, or long-form internal pages

---

## Recommended direction

### Phase A — Document the split explicitly

Make the architecture explicit in code/docs:

- paper reading renderer = structured block renderer
- agent output renderer = markdown prose renderer
- notes = JSON canonical, markdown derived

This prevents future refactors from trying to unify unrelated concerns too early.

### Phase B — Introduce a shared prose rendering layer for agent output

Without changing libraries yet, extract a reusable prose system for markdown-like surfaces.

Suggested shape:

- `MarkdownProse`
- `ProseComponents`
- `CitationAwareMarkdown`

That shared layer should own:

- heading scale
- paragraph rhythm
- code and pre styling
- list spacing
- table chrome
- blockquote treatment
- link styling
- citation chip mapping

Primary first consumer:

- `apps/web/src/components/agent/AgentMessage.tsx`

Current status:

- shipped
- shared prose now covers citation chips and KaTeX math in addition to standard markdown prose

### Phase C — Tokenize `md-only` reader surfaces better

For `BlocksPanel`, avoid a parser rewrite. Instead:

- promote repeated `color-mix(...)` reader surfaces into named tokens
- document equation/code/figure fallback surfaces as part of the reader paper system
- consolidate recurring reader prose treatment behind `reader-md__*` classes
- keep the block renderer architecture intact

Current status:

- shipped in first-pass form
- follow-up is cleanup/polish rather than architectural uncertainty

### Phase D — Revisit MDX only for authored content

MDX becomes attractive when Sapientia introduces one or more of:

- wiki page rendering
- internal documentation surfaces
- authored long-form entity/concept pages
- embedded React components inside text documents

That should be a separate task, not bundled into this one.

---

## Acceptance Criteria

1. The current markdown-related rendering/storage surfaces are documented accurately.
2. The team can clearly distinguish between:
   - structured paper block rendering
   - markdown prose rendering
   - markdown serialization
3. A concrete list of design-token mismatches is captured for follow-up implementation.
4. The task records a recommendation against replacing `BlocksPanel` with MDX.
5. The task records a recommendation against replacing agent-message markdown with MDX in the immediate term.
6. The task records when MDX would actually be a good fit.
7. A follow-up implementation path is defined separately for:
   - `md-only` reader cleanup
   - agent-message prose unification

---

## Implementation follow-up candidates

### Candidate A — Shared prose system for agent messages

Potential files:

- `apps/web/src/components/markdown/MarkdownProse.tsx`
- `apps/web/src/components/markdown/markdown-components.tsx`
- `apps/web/src/components/agent/AgentMessage.tsx`

Goal:

- centralize markdown component mapping
- align prose rendering with design tokens
- preserve citation + math rendering in one reusable markdown path

### Candidate B — `md-only` reader surface token cleanup

Potential files:

- `apps/web/src/components/reader/BlocksPanel.tsx`
- `apps/web/src/index.css`
- `docs/DESIGN_TOKENS.md`

Goal:

- replace repeated local reader surface formulas with named tokens

### Candidate C — MDX feasibility for authored pages

Potential future files:

- future wiki page renderer
- future docs/help page renderer
- theme/provider glue if needed

Goal:

- adopt MDX where authored documents benefit from embedded components and shared component maps

---

## Risks

1. **False unification**
   - treating all markdown-related flows as the same system will create regressions

2. **Over-adopting MDX**
   - adopting MDX for LLM output or reader blocks may add complexity without product benefit

3. **Token drift continues if prose rules stay local**
   - even with good global color tokens, markdown/prose surfaces can still diverge if component maps remain inline

4. **Reader regression risk**
   - any attempt to make `BlocksPanel` string-driven would likely weaken block anchor semantics and marginalia positioning

---

## Testing strategy

This task itself is research/documentation-heavy. Follow-up implementation should test:

### Shared prose layer

- headings/lists/code/tables render consistently across consumers
- citation chip mapping still works
- inline and display math render correctly
- link sanitization behavior remains correct

### Reader token cleanup

- `md-only` still preserves block positioning and selection behavior
- visual parity with current dark/light reading surfaces

### Any future MDX adoption

- compile/evaluate path is explicit
- authored-content component mapping is deterministic
- untrusted model output is not accidentally upgraded into executable MDX

---

## Definition of done

This card is done when:

- the markdown/rendering landscape in Sapientia is documented clearly
- design-token drift points are captured concretely
- the project has an explicit recommendation for what should stay on `react-markdown`, what should stay custom, and where MDX would actually help
- a follow-up implementation path exists that improves consistency without forcing an unnecessary renderer migration
