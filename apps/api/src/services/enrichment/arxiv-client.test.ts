import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
	vi.restoreAllMocks()
})

describe("arxiv-client", () => {
	it("parses atom XML into normalized metadata", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				[
					"<feed>",
					"<entry>",
					"<title> Sample Paper </title>",
					"<summary> Summary text </summary>",
					"<published>2024-01-02T00:00:00Z</published>",
					"<author><name>Alice Smith</name></author>",
					"<author><name>Bob Jones</name></author>",
					"<arxiv:journal_ref xmlns:arxiv='http://arxiv.org/schemas/atom'>ICLR 2024</arxiv:journal_ref>",
					"<arxiv:doi xmlns:arxiv='http://arxiv.org/schemas/atom'>10.5555/test.</arxiv:doi>",
					"</entry>",
					"</feed>",
				].join(""),
				{ status: 200, headers: { "content-type": "application/atom+xml" } },
			),
		)

		const { lookupByArxivId } = await import("./arxiv-client")
		const result = await lookupByArxivId("2401.12345")

		expect(result).toMatchObject({
			title: "Sample Paper",
			authors: ["Alice Smith", "Bob Jones"],
			year: 2024,
			doi: "10.5555/test",
			arxivId: "2401.12345",
			venue: "ICLR 2024",
			source: "arxiv",
		})
	})
})
