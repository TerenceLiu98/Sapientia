CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "user_credentials"
ADD COLUMN "embedding_provider" text,
ADD COLUMN "embedding_api_key_ciphertext" bytea,
ADD COLUMN "embedding_base_url" text,
ADD COLUMN "embedding_model" text;

CREATE TABLE "compiled_local_concept_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"local_concept_id" uuid NOT NULL,
	"embedding_provider" text NOT NULL,
	"embedding_model" text NOT NULL,
	"dimensions" integer NOT NULL,
	"input_hash" text NOT NULL,
	"input_text_version" text NOT NULL,
	"embedding" vector NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "compiled_local_concept_embeddings_model_input_unq" UNIQUE("local_concept_id","embedding_provider","embedding_model","input_hash"),
	CONSTRAINT "compiled_local_concept_embeddings_dimensions_check" CHECK ("compiled_local_concept_embeddings"."dimensions" > 0)
);

ALTER TABLE "compiled_local_concept_embeddings"
ADD CONSTRAINT "compiled_local_concept_embeddings_workspace_id_workspaces_id_fk"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "compiled_local_concept_embeddings"
ADD CONSTRAINT "compiled_local_concept_embeddings_owner_user_id_user_id_fk"
FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "compiled_local_concept_embeddings"
ADD CONSTRAINT "compiled_local_concept_embeddings_local_concept_id_fk"
FOREIGN KEY ("local_concept_id") REFERENCES "compiled_local_concepts"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX "idx_compiled_local_concept_embeddings_workspace"
ON "compiled_local_concept_embeddings" ("workspace_id", "owner_user_id", "embedding_provider", "embedding_model");

CREATE INDEX "idx_compiled_local_concept_embeddings_local_concept"
ON "compiled_local_concept_embeddings" ("local_concept_id");
