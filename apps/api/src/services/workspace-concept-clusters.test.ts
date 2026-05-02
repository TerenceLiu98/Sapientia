import { describe, expect, it } from "vitest"
import { buildWorkspaceConceptClusterDrafts } from "./workspace-concept-clusters"

describe("buildWorkspaceConceptClusterDrafts", () => {
	it("clusters local concepts by normalized kind and canonical name", () => {
		const updatedAt = new Date("2026-05-01T12:00:00.000Z")
		const clusters = buildWorkspaceConceptClusterDrafts([
			{
				id: "local-1",
				paperId: "paper-1",
				kind: "concept",
				canonicalName: "Sparse Autoencoder Features",
				displayName: "Sparse Autoencoder Features",
				salienceScore: 2,
				updatedAt,
			},
			{
				id: "local-2",
				paperId: "paper-2",
				kind: "concept",
				canonicalName: "sparse-autoencoder features",
				displayName: "SAE Features",
				salienceScore: 5,
				updatedAt,
			},
			{
				id: "local-3",
				paperId: "paper-3",
				kind: "method",
				canonicalName: "Sparse Autoencoder Features",
				displayName: "Sparse Autoencoder Features",
				salienceScore: 7,
				updatedAt,
			},
		])

		expect(clusters).toHaveLength(2)
		expect(clusters[0]).toMatchObject({
			kind: "concept",
			canonicalName: "sparse autoencoder features",
			displayName: "SAE Features",
			memberCount: 2,
			paperCount: 2,
			salienceScore: 7,
		})
		expect(clusters[0]?.members.map((member) => member.localConceptId).sort()).toEqual([
			"local-1",
			"local-2",
		])
		expect(clusters[1]).toMatchObject({
			kind: "method",
			memberCount: 1,
			paperCount: 1,
		})
	})
})
