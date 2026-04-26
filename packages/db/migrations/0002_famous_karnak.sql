CREATE TABLE "papers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"doi" text,
	"arxiv_id" text,
	"title" text NOT NULL,
	"authors" jsonb,
	"file_size_bytes" bigint NOT NULL,
	"pdf_object_key" text NOT NULL,
	"blocks_object_key" text,
	"parse_status" text DEFAULT 'pending' NOT NULL,
	"parse_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "papers_owner_content_hash_unq" UNIQUE("owner_user_id","content_hash"),
	CONSTRAINT "papers_parse_status_check" CHECK ("papers"."parse_status" in ('pending', 'parsing', 'done', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "workspace_papers" (
	"workspace_id" uuid NOT NULL,
	"paper_id" uuid NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_papers_pkey" PRIMARY KEY("workspace_id","paper_id")
);
--> statement-breakpoint
ALTER TABLE "papers" ADD CONSTRAINT "papers_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_papers" ADD CONSTRAINT "workspace_papers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_papers" ADD CONSTRAINT "workspace_papers_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_papers" ADD CONSTRAINT "workspace_papers_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_papers_owner_user_id" ON "papers" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "idx_papers_content_hash" ON "papers" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "idx_workspace_papers_workspace_id" ON "workspace_papers" USING btree ("workspace_id");