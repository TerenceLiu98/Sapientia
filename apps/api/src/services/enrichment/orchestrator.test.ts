import { beforeEach, describe, expect, it, vi } from "vitest"

const lookupByDoi = vi.fn()
const lookupByArxivId = vi.fn()
const lookupById = vi.fn()
const searchByTitle = vi.fn()
const dblpSearchByTitle = vi.fn()
const openreviewSearchByTitle = vi.fn()

vi.mock("./crossref-client", () => ({ lookupByDoi }))
vi.mock("./arxiv-client", () => ({ lookupByArxivId }))
vi.mock("./semantic-scholar-client", () => ({
	lookupById,
	searchByTitle,
}))
vi.mock("./dblp-client", () => ({
	searchByTitle: dblpSearchByTitle,
}))
vi.mock("./openreview-client", () => ({
	searchByTitle: openreviewSearchByTitle,
}))

function metadata(overrides: Record<string, unknown>) {
	return {
		title: null,
		authors: [],
		year: null,
		doi: null,
		arxivId: null,
		venue: null,
		abstract: null,
		citationCount: null,
		pages: null,
		volume: null,
		issue: null,
		publisher: null,
		publicationType: null,
		url: null,
		matchConfidence: 1,
		matchKind: "precise",
		queryKind: "doi",
		source: "crossref",
		...overrides,
	}
}

describe("orchestrator", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("prefers higher-priority sources when fields conflict", async () => {
		lookupByDoi.mockResolvedValue(metadata({
			title: "CrossRef Title",
			authors: ["Cross Ref"],
			year: 2019,
			doi: "10.1/x",
			arxivId: null,
			venue: null,
			source: "crossref",
		}))
		lookupByArxivId.mockResolvedValue(metadata({
			title: "arXiv Title",
			authors: ["Arxiv Author"],
			year: 2020,
			doi: null,
			arxivId: "2401.00001",
			venue: "arXiv",
			publicationType: "preprint",
			queryKind: "arxiv_id",
			source: "arxiv",
		}))
		lookupById.mockRejectedValue(new Error("miss"))
		dblpSearchByTitle.mockResolvedValue(null)
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

	it("keeps medium-confidence title matches as review candidates", async () => {
		lookupByDoi.mockResolvedValue(null)
		lookupByArxivId.mockResolvedValue(null)
		lookupById.mockResolvedValue(null)
		searchByTitle.mockResolvedValue(metadata({
			title: "Near Match",
			authors: ["Ada"],
			year: 2024,
			source: "semantic_scholar",
			matchKind: "fuzzy",
			matchConfidence: 0.8,
			queryKind: "title",
		}))
		dblpSearchByTitle.mockResolvedValue(null)
		openreviewSearchByTitle.mockResolvedValue(null)

		const { enrich } = await import("./orchestrator")
		const result = await enrich({
			doi: null,
			arxivId: null,
			candidateTitle: "Near Match",
			rawHeadText: "text",
		})

		expect(result.status).toBe("partial")
		expect(result.metadata).toBeNull()
		expect(result.candidates).toHaveLength(1)
		expect(result.candidates[0]?.source).toBe("semantic_scholar")
	})
})
