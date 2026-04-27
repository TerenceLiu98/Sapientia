CREATE TABLE "user_credentials" (
	"user_id" text PRIMARY KEY NOT NULL,
	"mineru_token_ciphertext" "bytea",
	"llm_provider" text,
	"llm_api_key_ciphertext" "bytea",
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_credentials" ADD CONSTRAINT "user_credentials_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;