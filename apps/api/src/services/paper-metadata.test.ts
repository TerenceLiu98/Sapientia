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
				},
				status: "enriched",
				sources: ["crossref"],
			},
		)

		expect(update.title).toBe("User Title")
		expect(update.authors).toEqual(["User Author"])
		expect(update.year).toBe(2024)
		expect(update.doi).toBe("10.1/x")
		expect(update.venue).toBe("ICLR")
	})
})
