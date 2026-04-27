ALTER TABLE "papers" ADD COLUMN "year" integer;--> statement-breakpoint
ALTER TABLE "papers" ADD COLUMN "venue" text;--> statement-breakpoint
ALTER TABLE "papers" ADD COLUMN "display_filename" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "papers" ADD COLUMN "enrichment_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "papers" ADD COLUMN "enrichment_source" text;--> statement-breakpoint
ALTER TABLE "papers" ADD COLUMN "enriched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "papers" ADD COLUMN "metadata_edited_by_user" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "papers" ADD CONSTRAINT "papers_enrichment_status_check" CHECK ("papers"."enrichment_status" in ('pending', 'enriching', 'enriched', 'partial', 'failed', 'skipped'));