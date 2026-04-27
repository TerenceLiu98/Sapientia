import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
	vi.restoreAllMocks()
})

describe("openreview-client", () => {
	it("chooses the best title match from OpenReview search", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					notes: [
						{
							id: "note-1",
							content: {
								title: { value: "Different title" },
								authors: { value: ["Wrong Author"] },
							},
						},
						{
							id: "note-2",
							content: {
								title: { value: "Attention Is All You Need" },
								authors: { value: ["Ashish Vaswani"] },
								venue: { value: "ICLR 2025" },
								pdate: { value: Date.UTC(2025, 0, 2) },
							},
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		)

		const { searchByTitle } = await import("./openreview-client")
		const result = await searchByTitle("Attention Is All You Need")

		expect(result).toMatchObject({
			title: "Attention Is All You Need",
			authors: ["Ashish Vaswani"],
			year: 2025,
			venue: "ICLR 2025",
			source: "openreview",
		})
	})
})
