import { describe, expect, it, vi } from "vitest"

const lookupByDoi = vi.fn()
const lookupByArxivId = vi.fn()
const lookupById = vi.fn()
const searchByTitle = vi.fn()
const openreviewSearchByTitle = vi.fn()

vi.mock("./crossref-client", () => ({ lookupByDoi }))
vi.mock("./arxiv-client", () => ({ lookupByArxivId }))
vi.mock("./semantic-scholar-client", () => ({
	lookupById,
	searchByTitle,
}))
vi.mock("./openreview-client", () => ({
	searchByTitle: openreviewSearchByTitle,
}))

describe("orchestrator", () => {
	it("prefers higher-priority sources when fields conflict", async () => {
		lookupByDoi.mockResolvedValue({
			title: "CrossRef Title",
			authors: ["Cross Ref"],
			year: 2019,
			doi: "10.1/x",
			arxivId: null,
			venue: null,
			abstract: null,
			citationCount: null,
			source: "crossref",
		})
		lookupByArxivId.mockResolvedValue({
			title: "arXiv Title",
			authors: ["Arxiv Author"],
			year: 2020,
			doi: null,
			arxivId: "2401.00001",
			venue: "arXiv",
			abstract: null,
			citationCount: null,
			source: "arxiv",
		})
		lookupById.mockRejectedValue(new Error("miss"))
		openreviewSearchByTitle.mockResolvedValue(null)

		const { enrich } = await import("./orchestrator")
		const result = await enrich({
			doi: "10.1/x",
			arxivId: "2401.00001",
			candidateTitle: "Title",
			rawHeadText: "text",
		})

		expect(result.status).toBe("enriched")
		expect(result.metadata).toMatchObject({
			title: "CrossRef Title",
			authors: ["Cross Ref"],
			year: 2019,
			arxivId: "2401.00001",
			venue: "arXiv",
		})
	})
})
