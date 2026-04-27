// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { computeBlockRanges } from "./highlight-utils"

// Build a fixture DOM with `[data-block-id]` blocks each wrapping a single
// `[data-block-text]` span. We then make a real DOM Range / Selection
// across the desired character offsets and feed it to the function.
function makeBlocks(blocks: Array<{ id: string; text: string }>): HTMLElement {
	const root = document.createElement("div")
	for (const b of blocks) {
		const wrap = document.createElement("div")
		wrap.dataset.blockId = b.id
		const span = document.createElement("span")
		span.dataset.blockText = "true"
		span.textContent = b.text
		wrap.appendChild(span)
		root.appendChild(wrap)
	}
	document.body.appendChild(root)
	return root
}

function selectAcross(args: {
	startEl: HTMLElement
	startOffset: number
	endEl: HTMLElement
	endOffset: number
}) {
	const sel = window.getSelection()
	if (!sel) throw new Error("no selection api")
	sel.removeAllRanges()
	const range = document.createRange()
	const startNode = args.startEl.querySelector<HTMLElement>("[data-block-text]")?.firstChild
	const endNode = args.endEl.querySelector<HTMLElement>("[data-block-text]")?.firstChild
	if (!startNode || !endNode) throw new Error("missing text nodes")
	range.setStart(startNode, args.startOffset)
	range.setEnd(endNode, args.endOffset)
	sel.addRange(range)
	return sel
}

describe("computeBlockRanges", () => {
	beforeEach(() => {
		document.body.innerHTML = ""
	})
	afterEach(() => {
		document.body.innerHTML = ""
		window.getSelection()?.removeAllRanges()
	})

	it("returns [] for a null / collapsed selection", () => {
		expect(computeBlockRanges(null)).toEqual([])
		makeBlocks([{ id: "a", text: "Hello world" }])
		// No selection at all
		expect(computeBlockRanges(window.getSelection())).toEqual([])
	})

	it("captures a same-block selection at correct char offsets", () => {
		const root = makeBlocks([{ id: "a", text: "Hello world!" }])
		const block = root.firstElementChild as HTMLElement
		const sel = selectAcross({ startEl: block, startOffset: 6, endEl: block, endOffset: 11 })
		const hits = computeBlockRanges(sel)
		expect(hits).toEqual([{ blockId: "a", charStart: 6, charEnd: 11, selectedText: "world" }])
	})

	it("snaps to block boundaries when the selection spans two blocks", () => {
		const root = makeBlocks([
			{ id: "a", text: "Hello world!" },
			{ id: "b", text: "Second block here." },
		])
		const blockA = root.firstElementChild as HTMLElement
		const blockB = root.lastElementChild as HTMLElement
		// Start mid-A ("world"), end mid-B ("Second block")
		const sel = selectAcross({
			startEl: blockA,
			startOffset: 6,
			endEl: blockB,
			endOffset: 12,
		})
		const hits = computeBlockRanges(sel)
		expect(hits).toEqual([
			{ blockId: "a", charStart: 6, charEnd: 12, selectedText: "world!" },
			{ blockId: "b", charStart: 0, charEnd: 12, selectedText: "Second block" },
		])
	})

	it("ignores blocks the selection doesn't intersect", () => {
		const root = makeBlocks([
			{ id: "a", text: "Hello" },
			{ id: "b", text: "world" },
			{ id: "c", text: "ignored" },
		])
		const blockA = root.firstElementChild as HTMLElement
		const blockB = blockA.nextElementSibling as HTMLElement
		const sel = selectAcross({ startEl: blockA, startOffset: 0, endEl: blockB, endOffset: 5 })
		const hits = computeBlockRanges(sel)
		expect(hits.map((h) => h.blockId)).toEqual(["a", "b"])
	})

	it("returns [] when the selected text in the only block resolves to length 0", () => {
		const root = makeBlocks([{ id: "a", text: "abc" }])
		const block = root.firstElementChild as HTMLElement
		const sel = selectAcross({ startEl: block, startOffset: 1, endEl: block, endOffset: 1 })
		expect(computeBlockRanges(sel)).toEqual([])
	})
})
