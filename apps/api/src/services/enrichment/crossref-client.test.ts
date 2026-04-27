import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config", () => ({
	config: {
		CROSSREF_POLITE_EMAIL: "test@example.com",
		SEMANTIC_SCHOLAR_API_KEY: undefined,
	},
}))

afterEach(() => {
	vi.restoreAllMocks()
})

describe("crossref-client", () => {
	it("normalizes CrossRef metadata from a DOI lookup", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					status: "ok",
					message: {
						title: ["Attention Is All You Need"],
						author: [
							{ given: "Ashish", family: "Vaswani" },
							{ name: "Noam Shazeer" },
						],
						issued: { "date-parts": [[2017, 6, 12]] },
						DOI: "10.1000/test",
						"container-title": ["NeurIPS"],
						abstract: "<jats:p>abstract</jats:p>",
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		)

		const { lookupByDoi } = await import("./crossref-client")
		const result = await lookupByDoi("10.1000/test")

		expect(result).toMatchObject({
			title: "Attention Is All You Need",
			authors: ["Ashish Vaswani", "Noam Shazeer"],
			year: 2017,
			doi: "10.1000/test",
			venue: "NeurIPS",
			source: "crossref",
		})
	})
})
