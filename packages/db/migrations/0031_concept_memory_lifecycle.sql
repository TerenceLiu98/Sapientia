ALTER TABLE "compiled_local_concepts"
	ADD COLUMN IF NOT EXISTS "reader_signal_dirty_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "reader_meaning_hint" text,
	ADD COLUMN IF NOT EXISTS "reader_meaning_hint_confidence" double precision,
	ADD COLUMN IF NOT EXISTS "reader_meaning_hint_generated_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "reader_meaning_hint_input_hash" text,
	ADD COLUMN IF NOT EXISTS "semantic_fingerprint" text,
	ADD COLUMN IF NOT EXISTS "semantic_dirty_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "confidence_score" double precision;

CREATE INDEX IF NOT EXISTS "idx_compiled_local_concepts_reader_signal_dirty"
ON "compiled_local_concepts" ("workspace_id", "paper_id", "reader_signal_dirty_at");

CREATE INDEX IF NOT EXISTS "idx_compiled_local_concepts_semantic_dirty"
ON "compiled_local_concepts" ("workspace_id", "semantic_dirty_at");

ALTER TABLE "compiled_local_concepts"
	ADD CONSTRAINT "compiled_local_concepts_reader_meaning_hint_confidence_check"
	CHECK (
		"reader_meaning_hint_confidence" IS NULL
		OR ("reader_meaning_hint_confidence" >= 0 AND "reader_meaning_hint_confidence" <= 1)
	);

ALTER TABLE "compiled_local_concepts"
	ADD CONSTRAINT "compiled_local_concepts_confidence_score_check"
	CHECK (
		"confidence_score" IS NULL
		OR ("confidence_score" >= 0 AND "confidence_score" <= 1)
	);

CREATE TABLE IF NOT EXISTS "concept_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
	"owner_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
	"paper_id" uuid NOT NULL REFERENCES "papers"("id") ON DELETE cascade,
	"local_concept_id" uuid NOT NULL REFERENCES "compiled_local_concepts"("id") ON DELETE cascade,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"block_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"observation_text" text,
	"signal_weight" double precision DEFAULT 0 NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consolidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "concept_observations_source_type_check"
		CHECK ("source_type" IN ('highlight', 'note')),
	CONSTRAINT "concept_observations_signal_weight_check"
		CHECK ("signal_weight" >= 0),
	CONSTRAINT "concept_observations_source_unq"
		UNIQUE ("workspace_id", "owner_user_id", "local_concept_id", "source_type", "source_id")
);

CREATE INDEX IF NOT EXISTS "idx_concept_observations_concept"
ON "concept_observations" ("local_concept_id", "deleted_at");

CREATE INDEX IF NOT EXISTS "idx_concept_observations_workspace_type"
ON "concept_observations" ("workspace_id", "source_type", "observed_at");

CREATE TABLE IF NOT EXISTS "concept_meaning_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
	"owner_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
	"local_concept_id" uuid NOT NULL REFERENCES "compiled_local_concepts"("id") ON DELETE cascade,
	"previous_description" text,
	"proposed_description" text NOT NULL,
	"source_observation_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"change_type" text NOT NULL,
	"confidence" double precision NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	"rationale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concept_meaning_revisions_change_type_check"
		CHECK ("change_type" IN ('clarification', 'extension', 'correction', 'contradiction')),
	CONSTRAINT "concept_meaning_revisions_status_check"
		CHECK ("status" IN ('candidate', 'accepted', 'superseded', 'rejected')),
	CONSTRAINT "concept_meaning_revisions_confidence_check"
		CHECK ("confidence" >= 0 AND "confidence" <= 1)
);

CREATE INDEX IF NOT EXISTS "idx_concept_meaning_revisions_concept_status"
ON "concept_meaning_revisions" ("local_concept_id", "status");

CREATE INDEX IF NOT EXISTS "idx_concept_meaning_revisions_workspace_status"
ON "concept_meaning_revisions" ("workspace_id", "status", "created_at");

CREATE TABLE IF NOT EXISTS "workspace_paper_graph_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
	"owner_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
	"graph_json" jsonb NOT NULL,
	"input_fingerprint" text NOT NULL,
	"status" text DEFAULT 'forming' NOT NULL,
	"error" text,
	"generated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_paper_graph_snapshots_workspace_owner_unq"
		UNIQUE ("workspace_id", "owner_user_id"),
	CONSTRAINT "workspace_paper_graph_snapshots_status_check"
		CHECK ("status" IN ('forming', 'stable', 'stale', 'refreshing', 'failed'))
);

CREATE INDEX IF NOT EXISTS "idx_workspace_paper_graph_snapshots_status"
ON "workspace_paper_graph_snapshots" ("workspace_id", "status");

CREATE TABLE IF NOT EXISTS "workspace_paper_graph_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
	"owner_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
	"source_paper_id" uuid NOT NULL REFERENCES "papers"("id") ON DELETE cascade,
	"target_paper_id" uuid NOT NULL REFERENCES "papers"("id") ON DELETE cascade,
	"edge_kind" text NOT NULL,
	"weight" double precision NOT NULL,
	"confidence" double precision,
	"evidence_count" double precision DEFAULT 0 NOT NULL,
	"top_evidence_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_confirmed_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_paper_graph_edges_pair_unq"
		UNIQUE ("workspace_id", "owner_user_id", "source_paper_id", "target_paper_id"),
	CONSTRAINT "workspace_paper_graph_edges_weight_check"
		CHECK ("weight" >= 0 AND "weight" <= 1),
	CONSTRAINT "workspace_paper_graph_edges_confidence_check"
		CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)),
	CONSTRAINT "workspace_paper_graph_edges_status_check"
		CHECK ("status" IN ('active', 'stale', 'superseded'))
);

CREATE INDEX IF NOT EXISTS "idx_workspace_paper_graph_edges_workspace_status"
ON "workspace_paper_graph_edges" ("workspace_id", "status");
