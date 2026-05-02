import { describe, expect, it } from "vitest"
import { buildWorkspaceConceptClusterCandidates } from "./workspace-concept-cluster-candidates"

describe("buildWorkspaceConceptClusterCandidates", () => {
	const baseConcept = {
		paperTitle: "Paper",
		salienceScore: 0,
		kind: "method" as const,
	}

	it("creates candidate pairs for same-kind concepts with similar source-level descriptions", () => {
		const candidates = buildWorkspaceConceptClusterCandidates(
			[
				{
					...baseConcept,
					id: "concept-a",
					paperId: "paper-a",
					canonicalName: "sparse autoencoder features",
					displayName: "SAE Features",
					sourceLevelDescription:
						"Sparse autoencoder features are interpretable latent units used to explain model activations.",
				},
				{
					...baseConcept,
					id: "concept-b",
					paperId: "paper-b",
					canonicalName: "sparse autoencoder latents",
					displayName: "Sparse Autoencoder Latents",
					sourceLevelDescription:
						"Sparse autoencoder latents are interpretable latent units for explaining neural model activations.",
				},
			],
			new Map([
				["concept-a", "cluster-a"],
				["concept-b", "cluster-b"],
			]),
		)

		expect(candidates).toHaveLength(1)
		expect(candidates[0]).toMatchObject({
			sourceLocalConceptId: "concept-a",
			targetLocalConceptId: "concept-b",
			kind: "method",
		})
		expect(candidates[0]?.decisionStatus).toBe("candidate")
		expect(candidates[0]?.similarityScore).toBeGreaterThanOrEqual(0.48)
	})

	it("does not create pairs for different kinds, same paper, or same exact cluster", () => {
		const concepts = [
			{
				...baseConcept,
				id: "concept-a",
				paperId: "paper-a",
				canonicalName: "feature directions",
				displayName: "Feature Directions",
				sourceLevelDescription:
					"Feature directions are interpretable latent units used to explain model activations.",
			},
			{
				...baseConcept,
				id: "same-paper",
				paperId: "paper-a",
				canonicalName: "activation features",
				displayName: "Activation Features",
				sourceLevelDescription:
					"Activation features are interpretable latent units used to explain model activations.",
			},
			{
				...baseConcept,
				id: "same-cluster",
				paperId: "paper-b",
				canonicalName: "feature directions",
				displayName: "Feature Directions",
				sourceLevelDescription:
					"Feature directions are interpretable latent units used to explain model activations.",
			},
			{
				...baseConcept,
				id: "different-kind",
				paperId: "paper-c",
				kind: "task" as const,
				canonicalName: "activation explanation",
				displayName: "Activation Explanation",
				sourceLevelDescription:
					"Activation explanation is a task for explaining neural model activations.",
			},
		]

		const candidates = buildWorkspaceConceptClusterCandidates(
			concepts,
			new Map([
				["concept-a", "cluster-a"],
				["same-paper", "cluster-b"],
				["same-cluster", "cluster-a"],
				["different-kind", "cluster-c"],
			]),
		)

		expect(candidates).toEqual([])
	})
})
