import { describe, expect, it } from "vitest"
import { formatBlocksForAgent } from "./format-blocks-for-agent"

describe("formatBlocksForAgent", () => {
	it("formats bare blocks without highlight annotation lines", () => {
		expect(
			formatBlocksForAgent({
				blocks: [{ blockId: "b1", type: "text", text: "Alpha paragraph." }],
				highlights: [],
			}),
		).toBe(["[Block #b1: text]", "```", "Alpha paragraph.", "```"].join("\n"))
	})

	it("annotates a single highlight with one USER MARKED line", () => {
		expect(
			formatBlocksForAgent({
				blocks: [{ blockId: "b1", type: "text", text: "Solid theory of LLMs." }],
				highlights: [{ blockId: "b1", color: "questioning", selectedText: "Solid theory" }],
			}),
		).toBe(
			[
				"[Block #b1: text]",
				'USER MARKED AS QUESTIONING: "Solid theory"',
				"```",
				"Solid theory of LLMs.",
				"```",
			].join("\n"),
		)
	})

	it("labels heading blocks with their level", () => {
		expect(
			formatBlocksForAgent({
				blocks: [
					{ blockId: "h1", type: "heading", headingLevel: 1, text: "Top heading" },
					{ blockId: "h2", type: "heading", headingLevel: 2, text: "Sub heading" },
					{ blockId: "p", type: "text", text: "Body" },
				],
				highlights: [],
			}),
		).toContain("[Block #h1: H1 heading]")
		expect(
			formatBlocksForAgent({
				blocks: [{ blockId: "h2", type: "heading", headingLevel: 2, text: "Sub heading" }],
				highlights: [],
			}),
		).toContain("[Block #h2: H2 heading]")
	})

	it("trims phrase whitespace and drops empty selections", () => {
		expect(
			formatBlocksForAgent({
				blocks: [{ blockId: "b1", type: "text", text: "Some body" }],
				highlights: [
					{ blockId: "b1", color: "important", selectedText: "  body  " },
					{ blockId: "b1", color: "important", selectedText: "   " },
				],
			}),
		).toBe(
			["[Block #b1: text]", 'USER MARKED AS IMPORTANT: "body"', "```", "Some body", "```"].join(
				"\n",
			),
		)
	})

	it("wraps block text in a safe markdown fence and escapes control-token-like tags", () => {
		expect(
			formatBlocksForAgent({
				blocks: [
					{
						blockId: "b1",
						type: "text",
						text: "Choose <think> or <short>.\n\n```json\n{\"x\": true}\n```",
					},
				],
				highlights: [
					{ blockId: "b1", color: "important", selectedText: "<assistant> cue" },
				],
			}),
		).toBe(
			[
				"[Block #b1: text]",
				'USER MARKED AS IMPORTANT: "〈assistant〉 cue"',
				"````",
				"Choose 〈think〉 or 〈short〉.",
				"",
				"```json",
				'{"x": true}',
				"```",
				"````",
			].join("\n"),
		)
	})

	it("matches a stable snapshot for a real-world-ish fixture", () => {
		// Snapshot guard: changing the agent context layout is a breaking
		// contract for the agent task. If you intentionally evolve the
		// format, update this snapshot — but do so deliberately, not
		// reflexively.
		const out = formatBlocksForAgent({
			blocks: [
				{ blockId: "h1", type: "heading", headingLevel: 1, text: "Sapientia: A reading tool" },
				{
					blockId: "p1",
					type: "text",
					text: "Researchers want to read papers without an AI doing it for them.",
				},
				{
					blockId: "p2",
					type: "text",
					text: "Highlights record semantic intent, not just visual marks.",
				},
				{ blockId: "fig1", type: "figure", text: "Figure 1: System overview" },
			],
			highlights: [
				{ blockId: "h1", color: "important", selectedText: "Sapientia" },
				{ blockId: "p2", color: "questioning", selectedText: "semantic intent" },
				{ blockId: "p2", color: "original", selectedText: "not just visual marks" },
				{ blockId: "fig1", color: "pending", selectedText: "Figure 1: System overview" },
			],
			focusBlockId: "p2",
		})
		expect(out).toMatchInlineSnapshot(`
			"[Block #h1: H1 heading]
			USER MARKED AS IMPORTANT: "Sapientia"
			\`\`\`
			Sapientia: A reading tool
			\`\`\`

			[Block #p1: text]
			\`\`\`
			Researchers want to read papers without an AI doing it for them.
			\`\`\`

			<focus>
			[Block #p2: text]
			USER MARKED AS QUESTIONING: "semantic intent"
			USER MARKED AS ORIGINAL: "not just visual marks"
			\`\`\`
			Highlights record semantic intent, not just visual marks.
			\`\`\`
			</focus>

			[Block #fig1: figure]
			USER MARKED AS PENDING: "Figure 1: System overview"
			\`\`\`
			Figure 1: System overview
			\`\`\`"
		`)
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
				"```",
				"Heading text",
				"```",
				"</focus>",
				"",
				"[Block #b2: text]",
				"```",
				"Body text",
				"```",
			].join("\n"),
		)
	})
})
