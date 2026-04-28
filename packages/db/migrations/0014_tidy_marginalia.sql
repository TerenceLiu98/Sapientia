CREATE TABLE "note_annotation_refs" (
	"note_id" uuid NOT NULL,
	"paper_id" uuid NOT NULL,
	"annotation_id" uuid NOT NULL,
	"annotation_kind" text NOT NULL,
	"citation_count" integer DEFAULT 1 NOT NULL,
	"first_cited_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_annotation_refs_pkey" PRIMARY KEY("note_id","paper_id","annotation_id")
);
--> statement-breakpoint
ALTER TABLE "note_annotation_refs" ADD CONSTRAINT "note_annotation_refs_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_annotation_refs" ADD CONSTRAINT "note_annotation_refs_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_note_annotation_refs_annotation" ON "note_annotation_refs" USING btree ("paper_id","annotation_id");--> statement-breakpoint
CREATE INDEX "idx_note_annotation_refs_note" ON "note_annotation_refs" USING btree ("note_id");
