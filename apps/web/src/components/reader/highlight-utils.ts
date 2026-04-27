// Selection → block + character ranges.
//
// Given a browser DOM Selection, figure out which `[data-block-id]` element(s)
// it intersects and the character offsets of the selection inside each
// block's `[data-block-text]` span. Each hit becomes one persisted
// highlight row.
//
// We require a single-span text wrapper (`[data-block-text]`) per block so
// character offsets are stable. TASK-017 mounts that wrapper inside the
// PDF viewer's block-aware overlay layer, which becomes the canonical
// selection source for persisted highlights.

export interface BlockRangeHit {
	blockId: string
	charStart: number
	charEnd: number
	selectedText: string
}

export function computeBlockRanges(selection: Selection | null): BlockRangeHit[] {
	if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return []

	const range = selection.getRangeAt(0)

	// `commonAncestorContainer` may be a text node; reach up to its element.
	const ancestor =
		range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
			? (range.commonAncestorContainer as Element)
			: range.commonAncestorContainer.parentElement
	if (!ancestor) return []

	// If the selection sits entirely inside a single block, the ancestor is
	// likely the block's text span (`[data-block-text]`) itself, which has
	// no `[data-block-id]` descendants. Walk up to the nearest block-bearing
	// ancestor in that case so we find the containing block.
	const blockEls = collectBlocksWithin(ancestor)
	if (blockEls.length === 0) {
		const enclosing = ancestor.closest<HTMLElement>("[data-block-id]")
		if (enclosing) blockEls.push(enclosing)
	}

	const hits: BlockRangeHit[] = []
	for (const blockEl of blockEls) {
		// `intersectsNode` is the cheap pre-filter; expensive offset math
		// happens only on actual hits.
		if (!range.intersectsNode(blockEl)) continue
		const hit = computeRangeWithinBlock(blockEl, range)
		if (hit) hits.push(hit)
	}
	return hits
}

function collectBlocksWithin(root: Element): HTMLElement[] {
	const out: HTMLElement[] = []
	if (root instanceof HTMLElement && root.dataset.blockId) out.push(root)
	for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-block-id]"))) {
		out.push(el)
	}
	return out
}

function computeRangeWithinBlock(blockEl: HTMLElement, range: Range): BlockRangeHit | null {
	const blockId = blockEl.dataset.blockId
	if (!blockId) return null
	const textSpan = blockEl.querySelector<HTMLElement>("[data-block-text]")
	if (!textSpan) return null

	const blockText = textSpan.textContent ?? ""
	if (blockText.length === 0) return null

	// To get char offsets we make a fresh range from textSpan-start up to
	// the selection's start/end and read its serialized length. This works
	// even when the selection extends past this block on either side: we
	// compare the original range against the block's own range below and
	// snap to [0, blockText.length].
	let charStart: number
	let charEnd: number
	try {
		const startProbe = document.createRange()
		startProbe.selectNodeContents(textSpan)
		startProbe.setEnd(range.startContainer, range.startOffset)
		charStart = clamp(startProbe.toString().length, 0, blockText.length)

		const endProbe = document.createRange()
		endProbe.selectNodeContents(textSpan)
		endProbe.setEnd(range.endContainer, range.endOffset)
		charEnd = clamp(endProbe.toString().length, 0, blockText.length)
	} catch {
		// `setEnd` throws if the boundary point isn't a descendant of the
		// span. That happens when the selection sits entirely outside this
		// block's text — e.g. it starts in a previous block and ends inside
		// this one. The boundary-point comparison below recovers the right
		// answer.
		charStart = -1
		charEnd = -1
	}

	const blockRange = document.createRange()
	blockRange.selectNode(blockEl)

	// Selection started before this block → snap charStart to 0.
	const cmpStart = range.compareBoundaryPoints(Range.START_TO_START, blockRange)
	if (cmpStart < 0 || charStart < 0) charStart = 0

	// Selection ended after this block → snap charEnd to end of block text.
	const cmpEnd = range.compareBoundaryPoints(Range.END_TO_END, blockRange)
	if (cmpEnd > 0 || charEnd < 0) charEnd = blockText.length

	// Reverse / collapsed selections inside this block: nothing to highlight.
	if (charEnd <= charStart) return null

	return {
		blockId,
		charStart,
		charEnd,
		selectedText: blockText.slice(charStart, charEnd),
	}
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, n))
}
