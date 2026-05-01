CREATE TABLE "compiled_local_concept_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"paper_id" uuid NOT NULL,
	"source_concept_id" uuid NOT NULL,
	"target_concept_id" uuid NOT NULL,
	"relation_type" text NOT NULL,
	"confidence" double precision,
	"generated_at" timestamp with time zone,
	"model_name" text,
	"prompt_version" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "compiled_local_concept_edges_owner_workspace_paper_rel_unq" UNIQUE("owner_user_id","workspace_id","paper_id","source_concept_id","target_concept_id","relation_type"),
	CONSTRAINT "compiled_local_concept_edges_status_check" CHECK ("status" IN ('pending', 'running', 'done', 'failed')),
	CONSTRAINT "compiled_local_concept_edges_source_target_check" CHECK ("source_concept_id" <> "target_concept_id")
);
--> statement-breakpoint

CREATE TABLE "compiled_local_concept_edge_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edge_id" uuid NOT NULL,
	"paper_id" uuid NOT NULL,
	"block_id" text NOT NULL,
	"snippet" text,
	"confidence" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compiled_local_concept_edge_evidence_edge_block_unq" UNIQUE("edge_id","paper_id","block_id"),
	CONSTRAINT "compiled_local_concept_edge_evidence_confidence_check" CHECK ("confidence" is null or ("confidence" >= 0 and "confidence" <= 1))
);
--> statement-breakpoint

ALTER TABLE "compiled_local_concept_edges"
	ADD CONSTRAINT "compiled_local_concept_edges_workspace_id_workspaces_id_fk"
	FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "compiled_local_concept_edges"
	ADD CONSTRAINT "compiled_local_concept_edges_owner_user_id_user_id_fk"
	FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "compiled_local_concept_edges"
	ADD CONSTRAINT "compiled_local_concept_edges_paper_id_papers_id_fk"
	FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "compiled_local_concept_edges"
	ADD CONSTRAINT "compiled_local_concept_edges_source_concept_id_compiled_local_concepts_id_fk"
	FOREIGN KEY ("source_concept_id") REFERENCES "public"."compiled_local_concepts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "compiled_local_concept_edges"
	ADD CONSTRAINT "compiled_local_concept_edges_target_concept_id_compiled_local_concepts_id_fk"
	FOREIGN KEY ("target_concept_id") REFERENCES "public"."compiled_local_concepts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "compiled_local_concept_edge_evidence"
	ADD CONSTRAINT "compiled_local_concept_edge_evidence_edge_id_compiled_local_concept_edges_id_fk"
	FOREIGN KEY ("edge_id") REFERENCES "public"."compiled_local_concept_edges"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "compiled_local_concept_edge_evidence"
	ADD CONSTRAINT "compiled_local_concept_edge_evidence_paper_id_papers_id_fk"
	FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "compiled_local_concept_edge_evidence"
	ADD CONSTRAINT "compiled_local_concept_edge_evidence_block_fk"
	FOREIGN KEY ("paper_id","block_id") REFERENCES "public"."blocks"("paper_id","block_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "idx_compiled_local_concept_edges_paper" ON "compiled_local_concept_edges" USING btree ("paper_id");
--> statement-breakpoint
CREATE INDEX "idx_compiled_local_concept_edges_source" ON "compiled_local_concept_edges" USING btree ("source_concept_id");
--> statement-breakpoint
CREATE INDEX "idx_compiled_local_concept_edges_target" ON "compiled_local_concept_edges" USING btree ("target_concept_id");
--> statement-breakpoint
CREATE INDEX "idx_compiled_local_concept_edge_evidence_edge" ON "compiled_local_concept_edge_evidence" USING btree ("edge_id");
--> statement-breakpoint
CREATE INDEX "idx_compiled_local_concept_edge_evidence_block" ON "compiled_local_concept_edge_evidence" USING btree ("paper_id","block_id");
