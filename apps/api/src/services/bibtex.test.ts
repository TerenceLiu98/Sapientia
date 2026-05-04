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
			pages: "5998-6008",
			volume: null,
			issue: null,
			publisher: null,
			publicationType: "conference",
			url: "https://example.com",
			abstract: null,
		})

		expect(bib).toContain("@inproceedings{vaswani2017attention")
		expect(bib).toContain("title = {Attention Is All You Need}")
		expect(bib).toContain("author = {Vaswani, Ashish and Noam Shazeer}")
		expect(bib).toContain("doi = {10.1000/test}")
		expect(bib).toContain("pages = {5998-6008}")
	})

	it("serializes multiple papers with a header and stable duplicate suffixes", () => {
		const bib = papersToBibtex([
			{
				id: "paper-1",
				title: "Novel Things",
				authors: ["Alice Smith"],
				year: 2024,
				doi: null,
				arxivId: null,
				venue: null,
				pages: null,
				volume: null,
				issue: null,
				publisher: null,
				publicationType: null,
				url: null,
				abstract: null,
			},
			{
				id: "paper-2",
				title: "Novel Things",
				authors: ["Alice Smith"],
				year: 2024,
				doi: null,
				arxivId: null,
				venue: null,
				pages: null,
				volume: null,
				issue: null,
				publisher: null,
				publicationType: null,
				url: null,
				abstract: null,
			},
		])

		expect(bib).toContain("% BibTeX export from Sapientia")
		expect(bib).toContain("@article{smith2024novela")
		expect(bib).toContain("@article{smith2024novelb")
	})

	it("preserves latex math spans while escaping regular text", () => {
		const bib = paperToBibtex({
			id: "paper-1",
			title: "Scaling $x_i$ & generalization",
			authors: ["Alice Smith"],
			year: 2024,
			doi: null,
			arxivId: null,
			venue: null,
			pages: null,
			volume: null,
			issue: null,
			publisher: null,
			publicationType: null,
			url: null,
			abstract: null,
		})

		expect(bib).toContain("title = {Scaling $x_i$ \\& generalization}")
	})
})
