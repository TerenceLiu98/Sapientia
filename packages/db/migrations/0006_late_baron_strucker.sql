CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"paper_id" uuid,
	"title" text DEFAULT 'Untitled' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"json_object_key" text NOT NULL,
	"md_object_key" text NOT NULL,
	"agent_markdown_cache" text DEFAULT '' NOT NULL,
	"search_text" "tsvector",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_notes_workspace" ON "notes" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_notes_paper" ON "notes" USING btree ("paper_id");--> statement-breakpoint
CREATE INDEX "idx_notes_owner" ON "notes" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "idx_notes_search" ON "notes" USING gin ("search_text");