import { describe, expect, it } from "vitest"
import { applyEnrichedMetadataToPaper, mergeMetadataEditedFlags } from "./paper-metadata"

describe("paper-metadata", () => {
	it("marks fields edited by the user", () => {
		const flags = mergeMetadataEditedFlags(
			{ title: true },
			{ authors: ["A"], year: 2024 },
		)
		expect(flags).toEqual({ title: true, authors: true, year: true })
	})

	it("does not overwrite user-protected fields during enrichment", () => {
		const update = applyEnrichedMetadataToPaper(
			{
				id: "paper-1",
				title: "User Title",
				authors: ["User Author"],
				year: 2020,
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
				metadataCandidates: [],
				metadataProvenance: {},
				metadataEditedByUser: { title: true, authors: true },
			},
			{
				metadata: {
					title: "API Title",
					authors: ["API Author"],
					year: 2024,
					doi: "10.1/x",
					arxivId: "2401.00001",
					venue: "ICLR",
					abstract: "API abstract",
					citationCount: 12,
					pages: "1-10",
					volume: "1",
					issue: "2",
					publisher: "Publisher",
					publicationType: "conference",
					url: "https://example.com",
				},
				status: "enriched",
				sources: ["crossref"],
				candidates: [],
				provenance: {
					pages: {
						source: "crossref",
						queryKind: "doi",
						matchKind: "precise",
						confidence: 1,
						updatedAt: "2026-05-04T00:00:00.000Z",
					},
				},
			},
		)

		expect(update.title).toBe("User Title")
		expect(update.authors).toEqual(["User Author"])
		expect(update.year).toBe(2024)
		expect(update.doi).toBe("10.1/x")
		expect(update.venue).toBe("ICLR")
		expect(update.pages).toBe("1-10")
		expect(update.metadataProvenance).toHaveProperty("pages")
	})
})
