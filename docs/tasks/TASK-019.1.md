# TASK-019.1: Color-token compliance audit + remediation

**Estimated effort**: 0.5-1 working day  
**Depends on**: `docs/DESIGN_TOKENS.md`, `apps/web/src/index.css`, existing reader / notes UI  
**Phase**: Cross-cutting design-system cleanup

---

## Context

Sapientia already has a documented color system in [`docs/DESIGN_TOKENS.md`](../DESIGN_TOKENS.md), but the current implementation only partially follows it. The base neutral/accent palette is mostly aligned, yet semantic usage has drifted:

1. **Dark theme contract is undocumented in code but documented in the spec.** The design tokens define both `:root` and `[data-theme="dark"]`, but the app stylesheet currently only ships the light-theme semantic set.
2. **The built-in note semantic palette diverged from the spec.** The design doc defines five built-ins: `questioning`, `important`, `original`, `pending`, `background`. The implementation currently ships `questioning`, `important`, `original`, `pending`, `conclusion`.
3. **Hard-coded colors still exist in component code.** Several components use raw hex / rgb / oklch / ad-hoc color mixes instead of semantic tokens or token-backed runtime vars.

This card is about restoring **token compliance**, not redesigning the product. If the current visuals are acceptable, the fix is still worth doing because it reduces drift, enables dark mode, and keeps future UI work from re-introducing arbitrary colors.

---

## Audit summary

### What is already aligned

- Neutral primitive scale in [`apps/web/src/index.css`](../../apps/web/src/index.css) broadly matches the documented warm-gray OKLCH palette.
- Accent primitive scale also broadly matches the documented teal accent palette.
- Core semantic light-theme tokens like `--color-bg-primary`, `--color-text-primary`, `--color-border-default`, and status colors exist and are already in use.

### What is not aligned

1. **No dark theme implementation**
   - `docs/DESIGN_TOKENS.md` defines `[data-theme="dark"]`.
   - `apps/web/src/index.css` does not currently define those overrides.

2. **Semantic note palette mismatch**
   - Spec: `questioning`, `important`, `original`, `pending`, `background`
   - Current code: `questioning`, `important`, `original`, `pending`, `conclusion`
   - Current `pending` hue is blue/purple-leaning instead of the accent teal specified in the doc.

3. **Hard-coded component colors**
   - Raw annotation palette values in [`apps/web/src/lib/reader-annotations.ts`](../../apps/web/src/lib/reader-annotations.ts)
   - Raw editor text colors in [`apps/web/src/components/notes/NoteEditor.tsx`](../../apps/web/src/components/notes/NoteEditor.tsx)
   - Hard-coded preview button styling in [`apps/web/src/components/reader/SelectedBlockPreview.tsx`](../../apps/web/src/components/reader/SelectedBlockPreview.tsx)
   - Hard-coded parse-error banner styling in [`apps/web/src/components/reader/PaperWorkspace.tsx`](../../apps/web/src/components/reader/PaperWorkspace.tsx)
   - Raw fallback citation colors in [`apps/web/src/components/notes/citation-schema.tsx`](../../apps/web/src/components/notes/citation-schema.tsx)

4. **Primitive/ad-hoc color usage where semantic tokens should be preferred**
   - Direct `accent-*` utility use in CTA buttons and badges
   - `color-mix(..., white)` formulas embedded in components instead of tokenized semantic variants

---

## Goal

Bring the implemented color system back into compliance with [`docs/DESIGN_TOKENS.md`](../DESIGN_TOKENS.md) so that:

- all shipped theme colors trace back to documented tokens,
- dark mode has a real semantic token layer,
- built-in semantic note colors match the source of truth,
- component code stops introducing new arbitrary colors.

---

## Acceptance Criteria

1. **Dark-theme semantic tokens exist in code**
   - [`apps/web/src/index.css`](../../apps/web/src/index.css) defines `[data-theme="dark"]` overrides corresponding to the documented token set.

2. **Built-in note semantic palette matches the design doc**
   - Built-ins are exactly: `questioning`, `important`, `original`, `pending`, `background`
   - `conclusion` is removed from the built-in default palette unless the design doc is explicitly updated first.

3. **Note semantic token values match the documented hues closely**
   - `pending` uses the accent-teal family, not a blue/purple family.
   - `background` resolves to neutral, not a decorative hue.

4. **No raw hex / rgb / ad-hoc OKLCH literals remain in component color styling where a token should exist**
   - Exceptions are allowed only for:
     - token declarations in the stylesheet
     - user-authored custom palette entries persisted at runtime
     - documented one-off visualization colors that are first added back to the token source of truth

5. **Annotation palette becomes token-backed**
   - Reader annotation colors are sourced from named tokens or a token-backed semantic palette rather than inline hex constants.

6. **Error, warning, and highlight surfaces prefer semantic tokens**
   - Components no longer embed one-off status surfaces when equivalent status tokens exist.

7. **A repo-wide check for obvious hard-coded colors in app components passes**
   - No remaining raw `#hex`, `rgb(...)`, or arbitrary `oklch(...)` color literals in `apps/web/src/**` except sanctioned token declarations or explicit runtime user colors.

---

## Proposed implementation order

1. **Token layer first**
   - Add missing `[data-theme="dark"]` semantic tokens to `index.css`
   - Add any missing semantic aliases required by current UI surfaces

2. **Palette correction second**
   - Align `--note-*` tokens with the documented five-color palette
   - Update [`apps/web/src/lib/highlight-palette.ts`](../../apps/web/src/lib/highlight-palette.ts) to use the same canonical built-ins

3. **Component cleanup third**
   - Replace hard-coded colors with semantic token utilities or CSS vars
   - Where multiple components share the same visual role, introduce a reusable semantic token instead of repeating `color-mix(...)`

4. **Audit pass last**
   - Re-run a grep pass over `apps/web/src` for raw colors
   - Verify light and dark mode still read clearly in the reader, notes, and library views

---

## Do not

- Do not redesign the palette from scratch in this card.
- Do not add new decorative hues without first updating [`docs/DESIGN_TOKENS.md`](../DESIGN_TOKENS.md).
- Do not keep `conclusion` as a silent sixth built-in unless product/design has explicitly changed the documented palette.
- Do not solve token drift by weakening the doc; the implementation should converge toward the documented source of truth unless there is a deliberate design decision to revise the doc first.

---

## Files likely affected

- [`docs/DESIGN_TOKENS.md`](../DESIGN_TOKENS.md) only if the source of truth itself is intentionally revised
- [`apps/web/src/index.css`](../../apps/web/src/index.css)
- [`apps/web/src/lib/highlight-palette.ts`](../../apps/web/src/lib/highlight-palette.ts)
- [`apps/web/src/lib/reader-annotations.ts`](../../apps/web/src/lib/reader-annotations.ts)
- [`apps/web/src/components/notes/NoteEditor.tsx`](../../apps/web/src/components/notes/NoteEditor.tsx)
- [`apps/web/src/components/notes/citation-schema.tsx`](../../apps/web/src/components/notes/citation-schema.tsx)
- [`apps/web/src/components/reader/PaperWorkspace.tsx`](../../apps/web/src/components/reader/PaperWorkspace.tsx)
- [`apps/web/src/components/reader/SelectedBlockPreview.tsx`](../../apps/web/src/components/reader/SelectedBlockPreview.tsx)
- [`apps/web/src/components/reader/OcrPane.tsx`](../../apps/web/src/components/reader/OcrPane.tsx)
- other UI files surfaced by the hard-coded-color grep

---

## Verification

- Visual spot check in light mode: library, sign-in, reader, note editor, gutter/rail surfaces, OCR pane, popovers.
- Visual spot check in dark mode after token implementation.
- Grep check for raw colors in app components:

```bash
rg -n "#[0-9A-Fa-f]{3,8}|rgb\\(|oklch\\(" apps/web/src --glob '!**/*.test.*'
```

Review remaining matches manually; token declarations in `index.css` are expected, component-level matches should be justified or removed.

---

## Report Back

When this card is completed, report:

1. Which tokens were added or changed
2. Whether the built-in note palette changed data assumptions or migrations
3. Which remaining raw colors, if any, are intentionally exempt and why
4. Whether dark mode is now fully token-backed or only partially enabled
