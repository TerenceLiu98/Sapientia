import { describe, expect, it } from "vitest"
import { paperToBibtex, papersToBibtex } from "./bibtex"

describe("bibtex", () => {
	it("serializes a paper into BibTeX", () => {
		const bib = paperToBibtex({
			id: "paper-1",
			title: "Attention Is All You Need",
			authors: ["Vaswani, Ashish", "Noam Shazeer"],
			year: 2017,
			doi: "10.1000/test",
			arxivId: "1706.03762",
			venue: "NeurIPS",
		})

		expect(bib).toContain("@article{vaswani2017attention")
		expect(bib).toContain("title = {Attention Is All You Need}")
		expect(bib).toContain("author = {Vaswani, Ashish and Noam Shazeer}")
		expect(bib).toContain("doi = {10.1000/test}")
	})

	it("serializes multiple papers with a header", () => {
		const bib = papersToBibtex([
			{
				id: "paper-1",
				title: "One",
				authors: ["Alice Smith"],
				year: 2024,
				doi: null,
				arxivId: null,
				venue: null,
			},
		])

		expect(bib).toContain("% BibTeX export from Sapientia")
		expect(bib).toContain("@article{smith2024")
	})
})
