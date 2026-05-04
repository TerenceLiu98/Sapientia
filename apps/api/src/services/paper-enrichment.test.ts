import { describe, expect, it, vi } from "vitest"

const enrich = vi.fn()

vi.mock("./enrichment/orchestrator", () => ({ enrich }))

describe("paper-enrichment", () => {
	it("retries a failed enrichment with the paper title fallback", async () => {
		enrich
			.mockResolvedValueOnce({ metadata: null, sources: [], status: "failed" })
			.mockResolvedValueOnce({
				metadata: { title: "Measuring Dynamic Media Bias", year: 2022, authors: ["Kim"] },
				sources: ["semantic_scholar"],
				status: "enriched",
			})

		const { enrichPaperFromIdentifiers } = await import("./paper-enrichment")
		const result = await enrichPaperFromIdentifiers({
			paper: {
				title: "kim-et-al-2022-measuring-dynamic-media-bias",
				doi: null,
				arxivId: null,
			},
			identifiers: {
				doi: null,
				arxivId: null,
				candidateTitle: "Proceedings header noise",
				rawHeadText: "",
			},
		})

		expect(enrich).toHaveBeenCalledTimes(2)
		expect(enrich).toHaveBeenNthCalledWith(
			1,
			{
				doi: null,
				arxivId: null,
				candidateTitle: "Proceedings header noise",
				rawHeadText: "",
			},
			{ semanticScholarApiKey: undefined },
		)
		expect(enrich).toHaveBeenNthCalledWith(
			2,
			{
				doi: null,
				arxivId: null,
				candidateTitle: "measuring dynamic media bias",
				rawHeadText: "",
			},
			{ semanticScholarApiKey: undefined },
		)
		expect(result.status).toBe("enriched")
	})

	it("prefers explicit user overrides for a manual retry", async () => {
		enrich.mockReset()
		enrich.mockResolvedValue({
			metadata: { doi: "10.1000/test", title: "Recovered" },
			sources: ["crossref"],
			status: "partial",
		})

		const { enrichPaperFromIdentifiers } = await import("./paper-enrichment")
		await enrichPaperFromIdentifiers({
			paper: {
				title: "Old title",
				doi: null,
				arxivId: null,
			},
			overrideTitle: "New better title",
			overrideDoi: "10.1000/test",
		})

		expect(enrich).toHaveBeenCalledWith(
			{
				doi: "10.1000/test",
				arxivId: null,
				candidateTitle: "New better title",
				rawHeadText: "",
			},
			{ semanticScholarApiKey: undefined },
		)
	})
})
