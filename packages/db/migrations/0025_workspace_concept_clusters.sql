CREATE TABLE "workspace_concept_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"canonical_name" text NOT NULL,
	"display_name" text NOT NULL,
	"short_description" text,
	"member_count" integer DEFAULT 0 NOT NULL,
	"paper_count" integer DEFAULT 0 NOT NULL,
	"salience_score" double precision DEFAULT 0 NOT NULL,
	"confidence" double precision,
	"status" text DEFAULT 'done' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "workspace_concept_clusters_owner_workspace_kind_name_unq" UNIQUE("owner_user_id","workspace_id","kind","canonical_name"),
	CONSTRAINT "workspace_concept_clusters_status_check" CHECK ("status" in ('pending', 'running', 'done', 'failed')),
	CONSTRAINT "workspace_concept_clusters_confidence_check" CHECK ("confidence" is null or ("confidence" >= 0 and "confidence" <= 1))
);
--> statement-breakpoint

CREATE TABLE "workspace_concept_cluster_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cluster_id" uuid NOT NULL,
	"local_concept_id" uuid NOT NULL,
	"paper_id" uuid NOT NULL,
	"match_method" text DEFAULT 'canonical_name' NOT NULL,
	"similarity_score" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_concept_cluster_members_local_concept_unq" UNIQUE("local_concept_id"),
	CONSTRAINT "workspace_concept_cluster_members_cluster_local_unq" UNIQUE("cluster_id","local_concept_id"),
	CONSTRAINT "workspace_concept_cluster_members_similarity_check" CHECK ("similarity_score" is null or ("similarity_score" >= 0 and "similarity_score" <= 1))
);
--> statement-breakpoint

ALTER TABLE "workspace_concept_clusters"
	ADD CONSTRAINT "workspace_concept_clusters_workspace_id_workspaces_id_fk"
	FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_concept_clusters"
	ADD CONSTRAINT "workspace_concept_clusters_owner_user_id_user_id_fk"
	FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_concept_cluster_members"
	ADD CONSTRAINT "workspace_concept_cluster_members_cluster_id_workspace_concept_clusters_id_fk"
	FOREIGN KEY ("cluster_id") REFERENCES "public"."workspace_concept_clusters"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_concept_cluster_members"
	ADD CONSTRAINT "workspace_concept_cluster_members_local_concept_id_compiled_local_concepts_id_fk"
	FOREIGN KEY ("local_concept_id") REFERENCES "public"."compiled_local_concepts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_concept_cluster_members"
	ADD CONSTRAINT "workspace_concept_cluster_members_paper_id_papers_id_fk"
	FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "idx_workspace_concept_clusters_workspace_kind" ON "workspace_concept_clusters" USING btree ("workspace_id","kind");
--> statement-breakpoint
CREATE INDEX "idx_workspace_concept_clusters_workspace_salience" ON "workspace_concept_clusters" USING btree ("workspace_id","salience_score");
--> statement-breakpoint
CREATE INDEX "idx_workspace_concept_cluster_members_cluster" ON "workspace_concept_cluster_members" USING btree ("cluster_id");
--> statement-breakpoint
CREATE INDEX "idx_workspace_concept_cluster_members_paper" ON "workspace_concept_cluster_members" USING btree ("paper_id");
