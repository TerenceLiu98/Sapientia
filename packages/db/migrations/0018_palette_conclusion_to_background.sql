-- TASK-019.1 — built-in note palette aligned with docs/DESIGN_TOKENS.md
-- §2.5: the canonical fifth slot is `background` (neutral), not the
-- never-documented `conclusion` (purple). Existing rows that captured
-- the older built-in get remapped here so the highlight surface
-- continues to render against a known --note-{key}-{bg|text} pair.
-- Custom user-defined keys are preserved as-is.
UPDATE "block_highlights" SET "color" = 'background' WHERE "color" = 'conclusion';
