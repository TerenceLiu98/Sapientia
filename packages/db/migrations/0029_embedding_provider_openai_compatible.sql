UPDATE "user_credentials"
SET "embedding_provider" = 'openai-compatible'
WHERE "embedding_provider" = 'openai';

UPDATE "compiled_local_concept_embeddings"
SET "embedding_provider" = 'openai-compatible'
WHERE "embedding_provider" = 'openai';
