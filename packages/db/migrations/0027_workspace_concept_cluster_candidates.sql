CREATE TABLE "workspace_concept_cluster_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"source_local_concept_id" uuid NOT NULL,
	"target_local_concept_id" uuid NOT NULL,
	"source_cluster_id" uuid,
	"target_cluster_id" uuid,
	"kind" text NOT NULL,
	"match_method" text DEFAULT 'lexical_source_description' NOT NULL,
	"similarity_score" double precision NOT NULL,
	"llm_decision" text,
	"decision_status" text DEFAULT 'candidate' NOT NULL,
	"rationale" text,
	"model_name" text,
	"prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "workspace_concept_cluster_candidates_pair_unq" UNIQUE("workspace_id","owner_user_id","source_local_concept_id","target_local_concept_id"),
	CONSTRAINT "workspace_concept_cluster_candidates_similarity_check" CHECK ("workspace_concept_cluster_candidates"."similarity_score" >= 0 and "workspace_concept_cluster_candidates"."similarity_score" <= 1),
	CONSTRAINT "workspace_concept_cluster_candidates_decision_status_check" CHECK ("workspace_concept_cluster_candidates"."decision_status" in ('candidate', 'auto_accepted', 'needs_review', 'rejected', 'user_accepted', 'user_rejected')),
	CONSTRAINT "workspace_concept_cluster_candidates_llm_decision_check" CHECK ("workspace_concept_cluster_candidates"."llm_decision" is null or "workspace_concept_cluster_candidates"."llm_decision" in ('same', 'related', 'different', 'uncertain'))
);

ALTER TABLE "workspace_concept_cluster_candidates"
ADD CONSTRAINT "workspace_concept_cluster_candidates_workspace_id_workspaces_id_fk"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "workspace_concept_cluster_candidates"
ADD CONSTRAINT "workspace_concept_cluster_candidates_owner_user_id_user_id_fk"
FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "workspace_concept_cluster_candidates"
ADD CONSTRAINT "workspace_concept_cluster_candidates_source_local_concept_id_fk"
FOREIGN KEY ("source_local_concept_id") REFERENCES "compiled_local_concepts"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "workspace_concept_cluster_candidates"
ADD CONSTRAINT "workspace_concept_cluster_candidates_target_local_concept_id_fk"
FOREIGN KEY ("target_local_concept_id") REFERENCES "compiled_local_concepts"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "workspace_concept_cluster_candidates"
ADD CONSTRAINT "workspace_concept_cluster_candidates_source_cluster_id_fk"
FOREIGN KEY ("source_cluster_id") REFERENCES "workspace_concept_clusters"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "workspace_concept_cluster_candidates"
ADD CONSTRAINT "workspace_concept_cluster_candidates_target_cluster_id_fk"
FOREIGN KEY ("target_cluster_id") REFERENCES "workspace_concept_clusters"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX "idx_workspace_concept_cluster_candidates_workspace"
ON "workspace_concept_cluster_candidates" ("workspace_id", "kind", "decision_status");

CREATE INDEX "idx_workspace_concept_cluster_candidates_source_cluster"
ON "workspace_concept_cluster_candidates" ("source_cluster_id");

CREATE INDEX "idx_workspace_concept_cluster_candidates_target_cluster"
ON "workspace_concept_cluster_candidates" ("target_cluster_id");
