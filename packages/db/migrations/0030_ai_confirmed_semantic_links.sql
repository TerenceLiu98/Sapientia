ALTER TABLE "workspace_concept_cluster_candidates"
	ADD COLUMN IF NOT EXISTS "llm_confidence" double precision;

ALTER TABLE "workspace_concept_cluster_candidates"
	DROP CONSTRAINT IF EXISTS "workspace_concept_cluster_candidates_decision_status_check";

ALTER TABLE "workspace_concept_cluster_candidates"
	ADD CONSTRAINT "workspace_concept_cluster_candidates_decision_status_check"
	CHECK (
		"decision_status" IN (
			'candidate',
			'ai_confirmed',
			'ai_rejected',
			'auto_accepted',
			'needs_review',
			'rejected',
			'user_accepted',
			'user_rejected'
		)
	);

ALTER TABLE "workspace_concept_cluster_candidates"
	ADD CONSTRAINT "workspace_concept_cluster_candidates_llm_confidence_check"
	CHECK (
		"llm_confidence" IS NULL
		OR ("llm_confidence" >= 0 AND "llm_confidence" <= 1)
	);
