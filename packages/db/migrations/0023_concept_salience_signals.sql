alter table "compiled_local_concepts"
  add column "salience_score" double precision not null default 0,
  add column "highlight_count" integer not null default 0,
  add column "weighted_highlight_score" double precision not null default 0,
  add column "note_citation_count" integer not null default 0,
  add column "last_marginalia_at" timestamp with time zone;
