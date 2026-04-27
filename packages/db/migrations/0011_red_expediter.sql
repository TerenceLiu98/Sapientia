DROP INDEX "uniq_notes_paper_owner_active";--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "anchor_page" integer;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "anchor_y_ratio" double precision;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "anchor_block_id" text;--> statement-breakpoint
CREATE INDEX "idx_notes_paper_anchor" ON "notes" USING btree ("paper_id","anchor_page","anchor_y_ratio");