import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config", () => ({
	config: {
		SEMANTIC_SCHOLAR_API_KEY: "key",
		CROSSREF_POLITE_EMAIL: undefined,
	},
}))

afterEach(() => {
	vi.restoreAllMocks()
})

describe("semantic-scholar-client", () => {
	it("normalizes a direct ID lookup result", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					title: "Transformer Paper",
					authors: [{ name: "Alice" }],
					year: 2023,
					venue: "ICML",
					abstract: "Abstract",
					citationCount: 42,
					externalIds: { DOI: "10.1/x", ArXiv: "2301.00001" },
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		)

		const { lookupById } = await import("./semantic-scholar-client")
		const result = await lookupById({ doi: "10.1/x" })

		expect(result).toMatchObject({
			title: "Transformer Paper",
			authors: ["Alice"],
			year: 2023,
			doi: "10.1/x",
			arxivId: "2301.00001",
			venue: "ICML",
			citationCount: 42,
			source: "semantic_scholar",
		})
	})

	it("returns the best fuzzy title match", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					data: [
						{ title: "Unrelated", authors: [], year: 2021 },
						{
							title: "Attention Is All You Need",
							authors: [{ name: "Ashish Vaswani" }],
							year: 2017,
							venue: "NeurIPS",
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		)

		const { searchByTitle } = await import("./semantic-scholar-client")
		const result = await searchByTitle("Attention Is All You Need")

		expect(result?.title).toBe("Attention Is All You Need")
		expect(result?.source).toBe("semantic_scholar")
	})
})
