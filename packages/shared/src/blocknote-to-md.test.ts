import { describe, expect, it } from "vitest"
import { blocknoteJsonToMarkdown } from "./blocknote-to-md"

describe("blocknoteJsonToMarkdown", () => {
	it("renders a paragraph as plain text", () => {
		const md = blocknoteJsonToMarkdown([
			{ type: "paragraph", content: [{ type: "text", text: "hello" }] },
		])
		expect(md).toBe("hello")
	})

	it("renders heading levels with the right number of #", () => {
		const md = blocknoteJsonToMarkdown([
			{
				type: "heading",
				content: [{ type: "text", text: "h1" }],
				props: { level: 1 },
			},
			{
				type: "heading",
				content: [{ type: "text", text: "h3" }],
				props: { level: 3 },
			},
		])
		expect(md).toContain("# h1")
		expect(md).toContain("### h3")
	})

	it("renders bullet and numbered lists", () => {
		const md = blocknoteJsonToMarkdown([
			{ type: "bulletListItem", content: [{ type: "text", text: "a" }] },
			{ type: "numberedListItem", content: [{ type: "text", text: "b" }] },
		])
		expect(md).toContain("- a")
		expect(md).toContain("1. b")
	})

	it("renders code blocks fenced", () => {
		const md = blocknoteJsonToMarkdown([
			{
				type: "codeBlock",
				content: [{ type: "text", text: "console.log('hi')" }],
				props: { language: "ts" },
			},
		])
		expect(md).toBe("```ts\nconsole.log('hi')\n```")
	})

	it("inlines links with bracket+paren syntax", () => {
		const md = blocknoteJsonToMarkdown([
			{
				type: "paragraph",
				content: [
					{ type: "text", text: "see " },
					{
						type: "link",
						href: "https://example.com",
						content: [{ type: "text", text: "this" }],
					},
				],
			},
		])
		expect(md).toBe("see [this](https://example.com)")
	})

	it("applies bold + italic + code styles", () => {
		const md = blocknoteJsonToMarkdown([
			{
				type: "paragraph",
				content: [
					{ type: "text", text: "a", styles: { bold: true } },
					{ type: "text", text: " " },
					{ type: "text", text: "b", styles: { italic: true } },
					{ type: "text", text: " " },
					{ type: "text", text: "c", styles: { code: true } },
				],
			},
		])
		expect(md).toBe("**a** _b_ `c`")
	})

	it("renders an empty document as an empty string", () => {
		expect(blocknoteJsonToMarkdown([])).toBe("")
	})

	it("serializes inline math as $latex$", () => {
		const md = blocknoteJsonToMarkdown([
			{
				type: "paragraph",
				content: [
					{ type: "text", text: "Energy is " },
					{ type: "math", props: { latex: "E = mc^2" } },
				],
			},
		])
		expect(md).toBe("Energy is $E = mc^2$")
	})

	it("serializes block math as $$ ... $$", () => {
		const md = blocknoteJsonToMarkdown([
			{ type: "mathBlock", props: { latex: "\\sum_{i=1}^n x_i" } },
		])
		expect(md).toBe("$$\n\\sum_{i=1}^n x_i\n$$")
	})

	it("drops empty math blocks (no orphan delimiters)", () => {
		const md = blocknoteJsonToMarkdown([
			{ type: "paragraph", content: [{ type: "text", text: "before" }] },
			{ type: "mathBlock", props: { latex: "" } },
			{ type: "paragraph", content: [{ type: "text", text: "after" }] },
		])
		expect(md).toBe("before\n\nafter")
	})

	it("emits the canonical citation token for blockCitation inline nodes", () => {
		const md = blocknoteJsonToMarkdown([
			{
				type: "paragraph",
				content: [
					{ type: "text", text: "see " },
					{
						type: "blockCitation",
						props: { paperId: "p1", blockId: "b1", snapshot: "Figure 1" },
					},
				],
			},
		])
		expect(md).toBe("see [[p1#b1: Figure 1]]")
	})
})
