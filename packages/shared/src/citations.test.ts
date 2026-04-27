import { describe, expect, it } from "vitest"
import { extractCitations, formatCitationToken } from "./citations"

describe("extractCitations", () => {
	it("returns [] for non-array input", () => {
		expect(extractCitations(null)).toEqual([])
		expect(extractCitations(undefined)).toEqual([])
		expect(extractCitations("nope")).toEqual([])
		expect(extractCitations({})).toEqual([])
	})

	it("returns [] when no blockCitation nodes are present", () => {
		const doc = [
			{ type: "paragraph", content: [{ type: "text", text: "plain" }] },
			{ type: "heading", content: [{ type: "text", text: "h" }] },
		]
		expect(extractCitations(doc)).toEqual([])
	})

	it("finds a single citation in a paragraph", () => {
		const doc = [
			{
				type: "paragraph",
				content: [
					{ type: "text", text: "see " },
					{ type: "blockCitation", props: { paperId: "p1", blockId: "b1", snapshot: "x" } },
				],
			},
		]
		expect(extractCitations(doc)).toEqual([{ paperId: "p1", blockId: "b1", count: 1 }])
	})

	it("aggregates duplicate citations into a single ref with count", () => {
		const doc = [
			{
				type: "paragraph",
				content: [
					{ type: "blockCitation", props: { paperId: "p1", blockId: "b1", snapshot: "a" } },
					{ type: "text", text: " and " },
					{ type: "blockCitation", props: { paperId: "p1", blockId: "b1", snapshot: "b" } },
				],
			},
		]
		expect(extractCitations(doc)).toEqual([{ paperId: "p1", blockId: "b1", count: 2 }])
	})

	it("returns separate refs for distinct (paperId, blockId) pairs", () => {
		const doc = [
			{
				type: "paragraph",
				content: [
					{ type: "blockCitation", props: { paperId: "p1", blockId: "b1", snapshot: "a" } },
					{ type: "blockCitation", props: { paperId: "p2", blockId: "b1", snapshot: "b" } },
					{ type: "blockCitation", props: { paperId: "p1", blockId: "b2", snapshot: "c" } },
				],
			},
		]
		const refs = extractCitations(doc)
		expect(refs.length).toBe(3)
		expect(refs.find((r) => r.paperId === "p1" && r.blockId === "b1")?.count).toBe(1)
	})

	it("walks nested children (e.g. list inside list)", () => {
		const doc = [
			{
				type: "bulletListItem",
				content: [{ type: "text", text: "outer" }],
				children: [
					{
						type: "bulletListItem",
						content: [
							{ type: "blockCitation", props: { paperId: "p1", blockId: "b1", snapshot: "x" } },
						],
					},
				],
			},
		]
		expect(extractCitations(doc)).toEqual([{ paperId: "p1", blockId: "b1", count: 1 }])
	})

	it("walks nested inline content (e.g. link wrapping a citation)", () => {
		const doc = [
			{
				type: "paragraph",
				content: [
					{
						type: "link",
						content: [
							{ type: "blockCitation", props: { paperId: "p1", blockId: "b1", snapshot: "x" } },
						],
					},
				],
			},
		]
		expect(extractCitations(doc)).toEqual([{ paperId: "p1", blockId: "b1", count: 1 }])
	})

	it("ignores citations missing paperId or blockId", () => {
		const doc = [
			{
				type: "paragraph",
				content: [
					{ type: "blockCitation", props: { paperId: "", blockId: "b1", snapshot: "x" } },
					{ type: "blockCitation", props: { paperId: "p1", blockId: "", snapshot: "y" } },
					{ type: "blockCitation", props: {} },
				],
			},
		]
		expect(extractCitations(doc)).toEqual([])
	})
})

describe("formatCitationToken", () => {
	it("renders the [[block N · paperId#blockId]] form when blockNumber is set", () => {
		expect(formatCitationToken({ paperId: "p1", blockId: "b1", blockNumber: 12 })).toBe(
			"[[block 12 · p1#b1]]",
		)
	})

	it("falls back to the legacy snapshot form when blockNumber is missing", () => {
		expect(formatCitationToken({ paperId: "p1", blockId: "b1", snapshot: "Figure 1" })).toBe(
			"[[p1#b1: Figure 1]]",
		)
	})

	it("escapes ]] inside the snapshot so the closer remains unique", () => {
		expect(
			formatCitationToken({ paperId: "p1", blockId: "b1", snapshot: "see [[a]] inline" }),
		).toBe("[[p1#b1: see [[a] ] inline]]")
	})

	it("emits paperId#blockId without a trailing colon when no payload is provided", () => {
		expect(formatCitationToken({ paperId: "p1", blockId: "b1" })).toBe("[[p1#b1]]")
	})
})
