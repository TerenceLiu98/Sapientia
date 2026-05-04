ALTER TABLE "user_credentials"
	ADD COLUMN IF NOT EXISTS "semantic_scholar_api_key_ciphertext" bytea;
