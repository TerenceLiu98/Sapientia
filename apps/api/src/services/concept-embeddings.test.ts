import { describe, expect, it } from "vitest"
import {
	buildConceptEmbeddingInput,
	CONCEPT_EMBEDDING_INPUT_VERSION,
	hashText,
	normalizeEmbeddingBaseUrlForProvider,
} from "./concept-embeddings"

describe("concept embeddings", () => {
	it("builds a stable paper-local concept embedding input", () => {
		const input = buildConceptEmbeddingInput({
			id: "concept-1",
			workspaceId: "workspace-1",
			ownerUserId: "user-1",
			paperId: "paper-1",
			paperTitle: "Sparse Autoencoders for Hypothesis Generation",
			kind: "method",
			canonicalName: "sparse autoencoder",
			displayName: "Sparse Autoencoder",
			sourceLevelDescription:
				"This paper uses sparse autoencoders to discover interpretable latent features.",
		})

		expect(input).toContain("Kind: method")
		expect(input).toContain("Name: Sparse Autoencoder")
		expect(input).toContain("Canonical name: sparse autoencoder")
		expect(input).toContain("Paper-specific meaning:")
		expect(CONCEPT_EMBEDDING_INPUT_VERSION).toBe("concept-embedding-input-v1")
		expect(hashText(input)).toHaveLength(64)
	})

	it("accepts either an API base URL or a full embeddings endpoint URL", () => {
		expect(
			normalizeEmbeddingBaseUrlForProvider({
				provider: "openai-compatible",
				apiKey: "key",
				baseURL: "https://api.siliconflow.cn/v1/embeddings",
				model: "BAAI/bge-m3",
			}),
		).toBe("https://api.siliconflow.cn/v1")
		expect(
			normalizeEmbeddingBaseUrlForProvider({
				provider: "openai-compatible",
				apiKey: "key",
				baseURL: "https://api.siliconflow.cn/v1",
				model: "BAAI/bge-m3",
			}),
		).toBe("https://api.siliconflow.cn/v1")
	})
})
