import { describe, expect, it } from "vitest"
import { buildPaperCompileWindows, type PaperCompileBlock } from "./paper-compile-windows"

describe("paper compile windows", () => {
	it("builds two-page windows without splitting blocks", () => {
		const blocks: PaperCompileBlock[] = [
			{
				blockId: "h1",
				blockIndex: 0,
				type: "heading",
				page: 1,
				text: "Introduction",
				headingLevel: 1,
			},
			{
				blockId: "p1",
				blockIndex: 1,
				type: "text",
				page: 1,
				text: "Page one body.",
				headingLevel: null,
			},
			{
				blockId: "h2",
				blockIndex: 2,
				type: "heading",
				page: 2,
				text: "Method",
				headingLevel: 1,
			},
			{
				blockId: "p2",
				blockIndex: 3,
				type: "text",
				page: 2,
				text: "Page two body.",
				headingLevel: null,
			},
			{
				blockId: "p3",
				blockIndex: 4,
				type: "text",
				page: 3,
				text: "Page three body.",
				headingLevel: null,
			},
		]

		const windows = buildPaperCompileWindows(blocks, { contextBlocksPerSide: 1 })

		expect(windows).toHaveLength(2)
		expect(windows[0]).toMatchObject({
			windowId: "pages-0001-0002",
			primaryPage: 1,
			pageRange: [1, 2],
			headingPath: ["Introduction"],
			primaryBlockIds: ["h1", "p1", "h2", "p2"],
			contextBlockIds: ["p3"],
			blockIds: ["h1", "p1", "h2", "p2", "p3"],
		})
		expect(windows[1]).toMatchObject({
			windowId: "page-0003",
			primaryPage: 3,
			pageRange: [3, 3],
			headingPath: ["Method"],
			primaryBlockIds: ["p3"],
			contextBlockIds: ["p2"],
			blockIds: ["p2", "p3"],
		})
	})
})
