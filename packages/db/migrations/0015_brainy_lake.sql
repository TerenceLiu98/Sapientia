-- Marginalia anchor model: a note can pin to a structural block, a
-- highlight, an underline, or just a position on the page. Both the
-- block id and the annotation id can co-exist (e.g. a highlight
-- anchored note still remembers which block it landed inside) — the
-- `anchor_kind` column declares which one is the user's primary intent.
ALTER TABLE "notes" ADD COLUMN "anchor_kind" text;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "anchor_annotation_id" uuid;
