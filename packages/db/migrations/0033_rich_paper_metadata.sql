ALTER TABLE "papers"
	ADD COLUMN IF NOT EXISTS "abstract" text,
	ADD COLUMN IF NOT EXISTS "citation_count" integer,
	ADD COLUMN IF NOT EXISTS "pages" text,
	ADD COLUMN IF NOT EXISTS "volume" text,
	ADD COLUMN IF NOT EXISTS "issue" text,
	ADD COLUMN IF NOT EXISTS "publisher" text,
	ADD COLUMN IF NOT EXISTS "publication_type" text,
	ADD COLUMN IF NOT EXISTS "url" text,
	ADD COLUMN IF NOT EXISTS "metadata_candidates" jsonb NOT NULL DEFAULT '[]'::jsonb,
	ADD COLUMN IF NOT EXISTS "metadata_provenance" jsonb NOT NULL DEFAULT '{}'::jsonb;
