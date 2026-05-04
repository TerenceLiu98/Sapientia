import { describe, expect, it } from "vitest"
import { parseContentList } from "../src/services/block-parser"

const fixture = JSON.stringify([
	// Heading-style text (text_level=1)
	{ type: "text", text: "1 Introduction", text_level: 1, page_idx: 0, bbox: [40, 50, 200, 80] },
	{ type: "text", text: "Recent advances...", page_idx: 0, bbox: [40, 100, 500, 200] },
	{
		type: "image",
		img_path: "images/abc.jpg",
		image_caption: ["Figure 1: Architecture"],
		page_idx: 1,
	},
	{
		type: "table",
		table_body: "<table>...</table>",
		table_caption: ["Table 1: Results"],
		page_idx: 2,
	},
	{ type: "list", list_items: ["a", "b", "c"], page_idx: 2 },
	// MinerU "header" = page running header → other
	{ type: "header", text: "PROCEEDINGS OF X", page_idx: 0 },
	// page footnote → other
	{ type: "page_footnote", text: "1 fn", page_idx: 0 },
	// duplicated text triggers de-dup suffix
	{ type: "text", text: "Recent advances...", page_idx: 0 },
])

describe("parseContentList", () => {
	it("maps MinerU types to our taxonomy", () => {
		const blocks = parseContentList(fixture)
		expect(blocks.map((b) => b.type)).toEqual([
			"heading",
			"text",
			"figure",
			"table",
			"list",
			"other",
			"other",
			"text",
		])
	})

	it("normalizes bbox by 1000x1000 (MinerU's abstract canvas)", () => {
		// MinerU treats every page as a 1000x1000 square regardless of the
		// PDF's actual aspect — both x and y values are in 0-1000.
		const blocks = parseContentList(fixture)
		expect(blocks[0].bbox).toEqual({
			x: 40 / 1000,
			y: 50 / 1000,
			w: 160 / 1000,
			h: 30 / 1000,
		})
		expect(blocks[5].bbox).toBeNull() // header had no bbox
	})

	it("ignores pdfPageDims because canvas is always 1000x1000", () => {
		// pageSizesPx is accepted for API compat but has no effect on math.
		const blocks = parseContentList(fixture, {
			pageSizesPx: new Map([[0, { w: 612, h: 792 }]]),
		})
		expect(blocks[0].bbox).toEqual({
			x: 40 / 1000,
			y: 50 / 1000,
			w: 160 / 1000,
			h: 30 / 1000,
		})
	})

	it("recovers correct ratios for centered MinerU bboxes", () => {
		// "Department of Statistics..." centered → ratio center should be ~0.5.
		const wider = JSON.stringify([
			{ type: "text", text: "Department", page_idx: 0, bbox: [292, 234, 702, 265] },
		])
		const blocks = parseContentList(wider, {
			pageSizesPx: new Map([[0, { w: 612, h: 792 }]]),
		})
		const bb = blocks[0].bbox
		expect(bb).not.toBeNull()
		if (!bb) return
		const center = bb.x + bb.w / 2
		expect(center).toBeCloseTo(0.5, 2) // centered on the page within ±1%
	})

	it("stamps imageObjectKey on figure blocks when imageKeys map is provided", () => {
		const blocks = parseContentList(fixture, {
			imageKeys: new Map([["images/abc.jpg", "papers/u1/p1/images/abc.jpg"]]),
		})
		expect(blocks[2].imageObjectKey).toBe("papers/u1/p1/images/abc.jpg")
	})

	it("converts page_idx (0-based) into page (1-based)", () => {
		const blocks = parseContentList(fixture)
		expect(blocks[0].page).toBe(1)
		expect(blocks[3].page).toBe(3)
	})

	it("captures heading_level only on type=heading", () => {
		const blocks = parseContentList(fixture)
		expect(blocks[0].headingLevel).toBe(1)
		expect(blocks[1].headingLevel).toBeNull()
	})

	it("stores caption on figure/table and surfaces it as searchable text", () => {
		const blocks = parseContentList(fixture)
		expect(blocks[2].caption).toBe("Figure 1: Architecture")
		expect(blocks[2].text).toBe("Figure 1: Architecture")
		expect(blocks[3].caption).toBe("Table 1: Results")
		expect((blocks[3].metadata as { tableBody: string }).tableBody).toBe("<table>...</table>")
	})

	it("preserves the original MinerU type in metadata for `other`", () => {
		const blocks = parseContentList(fixture)
		expect((blocks[5].metadata as { originalType: string }).originalType).toBe("header")
		expect((blocks[6].metadata as { originalType: string }).originalType).toBe("page_footnote")
	})

	it("produces 8-char hex block_ids", () => {
		const blocks = parseContentList(fixture)
		for (const b of blocks) {
			expect(b.blockId).toMatch(/^[0-9a-f]{8}(-\d+)?$/)
		}
	})

	it("produces stable ids across re-parse for unchanged content", () => {
		const a = parseContentList(fixture)
		const b = parseContentList(fixture)
		expect(a.map((x) => x.blockId)).toEqual(b.map((x) => x.blockId))
	})

	it("guarantees uniqueness even when content + index collide", () => {
		// Real-world dup case: three identical empty list items in a row.
		const dup = JSON.stringify([
			{ type: "text", text: "x", page_idx: 0 },
			{ type: "text", text: "x", page_idx: 0 },
		])
		const blocks = parseContentList(dup)
		expect(blocks[0].blockId).not.toBe(blocks[1].blockId)
	})

	it("tolerates unknown MinerU types as `other`", () => {
		const weird = JSON.stringify([{ type: "newfangled_thing", text: "?", page_idx: 0 }])
		const blocks = parseContentList(weird)
		expect(blocks[0].type).toBe("other")
		expect((blocks[0].metadata as { originalType: string }).originalType).toBe("newfangled_thing")
	})

	it("strips NUL characters before values are written to Postgres", () => {
		const nul = JSON.stringify([
			{ type: "text", text: "\u0000Agent of Regulatory Authority Alerts", page_idx: 0 },
			{
				type: "table",
				table_body: "<table>\u0000</table>",
				table_caption: ["Table \u00001"],
				table_footnote: ["note\u0000"],
				page_idx: 0,
			},
			{
				type: "list",
				text: "\u0000List",
				list_items: ["a\u0000", { nested: "\u0000b" }],
				page_idx: 0,
			},
		])
		const blocks = parseContentList(nul)

		expect(blocks[0].text).toBe("Agent of Regulatory Authority Alerts")
		expect(blocks[1].caption).toBe("Table 1")
		expect((blocks[1].metadata as { tableBody: string; tableFootnote: string[] }).tableBody).toBe(
			"<table></table>",
		)
		expect(
			(blocks[1].metadata as { tableBody: string; tableFootnote: string[] }).tableFootnote,
		).toEqual(["note"])
		expect(blocks[2].text).toBe("List")
		expect((blocks[2].metadata as { listItems: unknown[] }).listItems).toEqual([
			"a",
			{ nested: "b" },
		])
	})

	it("returns [] for an empty list", () => {
		expect(parseContentList("[]")).toEqual([])
	})
})
