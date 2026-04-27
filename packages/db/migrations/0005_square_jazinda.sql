CREATE TABLE "blocks" (
	"paper_id" uuid NOT NULL,
	"block_id" text NOT NULL,
	"block_index" integer NOT NULL,
	"type" text NOT NULL,
	"page" integer NOT NULL,
	"bbox" jsonb,
	"text" text DEFAULT '' NOT NULL,
	"heading_level" integer,
	"caption" text,
	"metadata" jsonb,
	"image_object_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_pkey" PRIMARY KEY("paper_id","block_id")
);
--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_blocks_paper_index" ON "blocks" USING btree ("paper_id","block_index");--> statement-breakpoint
CREATE INDEX "idx_blocks_paper_page" ON "blocks" USING btree ("paper_id","page");