import { beforeEach, describe, expect, it, vi } from "vitest"
import { EnrichmentApiError } from "./types"

describe("dblp-client", () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	it("normalizes a dblp publication hit", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					result: {
						hits: {
							hit: [
								{
									info: {
										title: "Attention Is All You Need",
										venue: "NeurIPS",
										year: "2017",
										ee: "https://doi.org/10.5555/3295222.3295349",
										authors: {
											author: ["Ashish Vaswani", "Noam Shazeer"],
										},
									},
								},
							],
						},
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		)

		const { searchByTitle } = await import("./dblp-client")
		const result = await searchByTitle("Attention Is All You Need")

		expect(result).toMatchObject({
			title: "Attention Is All You Need",
			venue: "NeurIPS",
			year: 2017,
			doi: "10.5555/3295222.3295349",
			authors: ["Ashish Vaswani", "Noam Shazeer"],
			source: "dblp",
		})
	})

	it("returns null when the best title match is too weak", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					result: {
						hits: {
							hit: [
								{
									info: {
										title: "A Completely Different Paper",
										venue: "ICML",
										year: "2024",
									},
								},
							],
						},
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		)

		const { searchByTitle } = await import("./dblp-client")
		const result = await searchByTitle("Attention Is All You Need")
		expect(result).toBeNull()
	})

	it("raises a rate-limited error on 429", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 429 }))

		const { searchByTitle } = await import("./dblp-client")
		await expect(searchByTitle("test")).rejects.toEqual(
			expect.objectContaining<Partial<EnrichmentApiError>>({
				source: "dblp",
				reason: "rate_limited",
			}),
		)
	})
})
