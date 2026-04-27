CREATE TABLE "block_highlights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paper_id" uuid NOT NULL,
	"block_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"char_start" integer,
	"char_end" integer,
	"selected_text" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "block_highlights" ADD CONSTRAINT "block_highlights_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_highlights" ADD CONSTRAINT "block_highlights_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_highlights" ADD CONSTRAINT "block_highlights_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_highlights_paper_user" ON "block_highlights" USING btree ("paper_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_highlights_block" ON "block_highlights" USING btree ("paper_id","block_id");--> statement-breakpoint
CREATE INDEX "idx_highlights_workspace_color" ON "block_highlights" USING btree ("workspace_id","color");