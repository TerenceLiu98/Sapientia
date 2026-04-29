ALTER TABLE "papers" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "papers" ADD COLUMN "summary_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "papers" ADD COLUMN "summary_generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "papers" ADD COLUMN "summary_model" text;--> statement-breakpoint
ALTER TABLE "papers" ADD COLUMN "summary_prompt_version" text;--> statement-breakpoint
ALTER TABLE "papers" ADD COLUMN "summary_error" text;--> statement-breakpoint
ALTER TABLE "papers" ADD CONSTRAINT "papers_summary_status_check" CHECK ("papers"."summary_status" in ('pending', 'running', 'done', 'failed', 'no-credentials'));