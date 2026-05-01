CREATE TABLE "compiled_local_concepts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"paper_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"canonical_name" text NOT NULL,
	"display_name" text NOT NULL,
	"generated_at" timestamp with time zone,
	"model_name" text,
	"prompt_version" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "compiled_local_concepts_owner_workspace_paper_kind_name_unq" UNIQUE("owner_user_id","workspace_id","paper_id","kind","canonical_name"),
	CONSTRAINT "compiled_local_concepts_status_check" CHECK ("status" IN ('pending', 'running', 'done', 'failed'))
);
--> statement-breakpoint

CREATE TABLE "compiled_local_concept_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"concept_id" uuid NOT NULL,
	"paper_id" uuid NOT NULL,
	"block_id" text NOT NULL,
	"snippet" text,
	"confidence" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compiled_local_concept_evidence_concept_block_unq" UNIQUE("concept_id","paper_id","block_id"),
	CONSTRAINT "compiled_local_concept_evidence_confidence_check" CHECK ("confidence" is null or ("confidence" >= 0 and "confidence" <= 1))
);
--> statement-breakpoint

CREATE TABLE "wiki_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"type" text NOT NULL,
	"canonical_name" text NOT NULL,
	"display_name" text NOT NULL,
	"source_paper_id" uuid,
	"compiled_concept_id" uuid,
	"body" text,
	"generated_at" timestamp with time zone,
	"model_name" text,
	"prompt_version" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "wiki_pages_owner_workspace_type_source_paper_name_unq" UNIQUE("owner_user_id","workspace_id","type","source_paper_id","canonical_name"),
	CONSTRAINT "wiki_pages_status_check" CHECK ("status" IN ('pending', 'running', 'done', 'failed')),
	CONSTRAINT "wiki_pages_source_type_paper_check" CHECK ((("type" = 'source' and "source_paper_id" is not null) or ("type" in ('entity', 'concept'))))
);
--> statement-breakpoint

CREATE TABLE "wiki_page_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"paper_id" uuid NOT NULL,
	"block_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_page_references_page_block_unq" UNIQUE("page_id","paper_id","block_id")
);
--> statement-breakpoint

ALTER TABLE "compiled_local_concepts"
	ADD CONSTRAINT "compiled_local_concepts_workspace_id_workspaces_id_fk"
	FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "compiled_local_concepts"
	ADD CONSTRAINT "compiled_local_concepts_owner_user_id_user_id_fk"
	FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "compiled_local_concepts"
	ADD CONSTRAINT "compiled_local_concepts_paper_id_papers_id_fk"
	FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "compiled_local_concept_evidence"
	ADD CONSTRAINT "compiled_local_concept_evidence_concept_id_compiled_local_concepts_id_fk"
	FOREIGN KEY ("concept_id") REFERENCES "public"."compiled_local_concepts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "compiled_local_concept_evidence"
	ADD CONSTRAINT "compiled_local_concept_evidence_paper_id_papers_id_fk"
	FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "compiled_local_concept_evidence"
	ADD CONSTRAINT "compiled_local_concept_evidence_block_fk"
	FOREIGN KEY ("paper_id","block_id") REFERENCES "public"."blocks"("paper_id","block_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wiki_pages"
	ADD CONSTRAINT "wiki_pages_workspace_id_workspaces_id_fk"
	FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wiki_pages"
	ADD CONSTRAINT "wiki_pages_owner_user_id_user_id_fk"
	FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wiki_pages"
	ADD CONSTRAINT "wiki_pages_source_paper_id_papers_id_fk"
	FOREIGN KEY ("source_paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wiki_pages"
	ADD CONSTRAINT "wiki_pages_compiled_concept_id_compiled_local_concepts_id_fk"
	FOREIGN KEY ("compiled_concept_id") REFERENCES "public"."compiled_local_concepts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wiki_page_references"
	ADD CONSTRAINT "wiki_page_references_page_id_wiki_pages_id_fk"
	FOREIGN KEY ("page_id") REFERENCES "public"."wiki_pages"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wiki_page_references"
	ADD CONSTRAINT "wiki_page_references_paper_id_papers_id_fk"
	FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wiki_page_references"
	ADD CONSTRAINT "wiki_page_references_block_fk"
	FOREIGN KEY ("paper_id","block_id") REFERENCES "public"."blocks"("paper_id","block_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "idx_compiled_local_concepts_workspace_kind" ON "compiled_local_concepts" USING btree ("workspace_id","kind");
--> statement-breakpoint
CREATE INDEX "idx_compiled_local_concepts_paper_kind" ON "compiled_local_concepts" USING btree ("paper_id","kind");
--> statement-breakpoint
CREATE INDEX "idx_compiled_local_concept_evidence_concept" ON "compiled_local_concept_evidence" USING btree ("concept_id");
--> statement-breakpoint
CREATE INDEX "idx_compiled_local_concept_evidence_block" ON "compiled_local_concept_evidence" USING btree ("paper_id","block_id");
--> statement-breakpoint
CREATE INDEX "idx_wiki_pages_workspace_type" ON "wiki_pages" USING btree ("workspace_id","type");
--> statement-breakpoint
CREATE INDEX "idx_wiki_pages_source_paper" ON "wiki_pages" USING btree ("source_paper_id");
--> statement-breakpoint
CREATE INDEX "idx_wiki_pages_compiled_concept" ON "wiki_pages" USING btree ("compiled_concept_id");
--> statement-breakpoint
CREATE INDEX "idx_wiki_page_references_page" ON "wiki_page_references" USING btree ("page_id");
--> statement-breakpoint
CREATE INDEX "idx_wiki_page_references_block" ON "wiki_page_references" USING btree ("paper_id","block_id");
