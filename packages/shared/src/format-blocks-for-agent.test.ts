import { describe, expect, it } from "vitest"
import { formatBlocksForAgent } from "./format-blocks-for-agent"

describe("formatBlocksForAgent", () => {
	it("formats bare blocks without highlight annotation lines", () => {
		expect(
			formatBlocksForAgent({
				blocks: [{ blockId: "b1", type: "text", text: "Alpha paragraph." }],
				highlights: [],
			}),
		).toBe("[Block #b1: text]\nAlpha paragraph.")
	})

	it("groups highlights by color and dedupes identical phrases", () => {
		expect(
			formatBlocksForAgent({
				blocks: [
					{ blockId: "b1", type: "heading", headingLevel: 2, text: "Heading text" },
					{ blockId: "b2", type: "text", text: "Body text" },
				],
				highlights: [
					{ blockId: "b1", color: "important", selectedText: "Heading" },
					{ blockId: "b1", color: "important", selectedText: "Heading" },
					{ blockId: "b1", color: "questioning", selectedText: "text" },
				],
				focusBlockId: "b1",
			}),
		).toBe(
			[
				"<focus>",
				"[Block #b1: H2 heading]",
				'USER MARKED AS IMPORTANT: "Heading"',
				'USER MARKED AS QUESTIONING: "text"',
				"Heading text",
				"</focus>",
				"",
				"[Block #b2: text]",
				"Body text",
			].join("\n"),
		)
	})
})
