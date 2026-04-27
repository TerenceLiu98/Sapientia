ALTER TABLE "block_highlights" DROP COLUMN "char_start";--> statement-breakpoint
ALTER TABLE "block_highlights" DROP COLUMN "char_end";--> statement-breakpoint
ALTER TABLE "block_highlights" DROP COLUMN "selected_text";--> statement-breakpoint
ALTER TABLE "block_highlights" ADD CONSTRAINT "uniq_highlights_block_owner" UNIQUE("paper_id","block_id","user_id","workspace_id");