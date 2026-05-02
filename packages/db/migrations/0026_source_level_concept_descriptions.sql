ALTER TABLE "compiled_local_concepts"
ADD COLUMN "source_level_description" text,
ADD COLUMN "source_level_description_confidence" double precision,
ADD COLUMN "source_level_description_generated_at" timestamp with time zone,
ADD COLUMN "source_level_description_model" text,
ADD COLUMN "source_level_description_prompt_version" text,
ADD COLUMN "source_level_description_status" text DEFAULT 'pending' NOT NULL,
ADD COLUMN "source_level_description_error" text,
ADD COLUMN "source_level_description_input_hash" text,
ADD COLUMN "source_level_description_dirty_at" timestamp with time zone,
ADD COLUMN "reader_signal_summary" text,
ADD COLUMN "reader_signal_summary_generated_at" timestamp with time zone,
ADD COLUMN "reader_signal_summary_model" text,
ADD COLUMN "reader_signal_summary_prompt_version" text,
ADD COLUMN "reader_signal_summary_status" text DEFAULT 'pending' NOT NULL,
ADD COLUMN "reader_signal_summary_error" text,
ADD COLUMN "reader_signal_summary_input_hash" text;

ALTER TABLE "compiled_local_concepts"
ADD CONSTRAINT "compiled_local_concepts_source_level_description_status_check"
CHECK ("compiled_local_concepts"."source_level_description_status" in ('pending', 'running', 'done', 'failed'));

ALTER TABLE "compiled_local_concepts"
ADD CONSTRAINT "compiled_local_concepts_reader_signal_summary_status_check"
CHECK ("compiled_local_concepts"."reader_signal_summary_status" in ('pending', 'running', 'done', 'failed'));

ALTER TABLE "compiled_local_concepts"
ADD CONSTRAINT "compiled_local_concepts_source_level_description_confidence_check"
CHECK ("compiled_local_concepts"."source_level_description_confidence" is null or ("compiled_local_concepts"."source_level_description_confidence" >= 0 and "compiled_local_concepts"."source_level_description_confidence" <= 1));

CREATE INDEX "idx_compiled_local_concepts_description_status"
ON "compiled_local_concepts" ("workspace_id", "paper_id", "source_level_description_status");
