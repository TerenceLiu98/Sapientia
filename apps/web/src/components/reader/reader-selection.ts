import type { ReaderTextMarkupBody } from "@/lib/reader-annotations"

export type ReaderSelectionMode = "pdf" | "markdown"

export interface ReaderSelectionAnchorRect {
	left: number
	top: number
	width: number
	height: number
}

export interface ReaderSelectionContext {
	selectedText: string
	blockIds: string[]
	anchorRect: ReaderSelectionAnchorRect
	mode: ReaderSelectionMode
	annotationTarget?: {
		page: number
		body: ReaderTextMarkupBody
	}
}

const MAX_SELECTED_BLOCK_IDS = 8

export function normalizeSelectionText(text: string) {
	return text.replace(/\s+/g, " ").trim()
}

export function normalizeSelectionAnchorRect(
	rect: Pick<DOMRectReadOnly, "left" | "top" | "width" | "height"> | null | undefined,
): ReaderSelectionAnchorRect | null {
	if (!rect) return null
	const { left, top, width, height } = rect
	if (![left, top, width, height].every((value) => Number.isFinite(value))) return null
	if (width <= 0 || height <= 0) return null
	return { left, top, width, height }
}

export function getActionableSelection(selection: Selection | null) {
	const range = getSelectionRange(selection)
	if (!range) return null
	const selectedText = normalizeSelectionText(selection?.toString() ?? "")
	if (!selectedText) return null
	const anchorRect = normalizeSelectionAnchorRect(range.getBoundingClientRect())
	if (!anchorRect) return null
	return { anchorRect, range, selectedText }
}

export function selectionIntersectsElement(selection: Selection | null, element: Element | null) {
	if (!element) return false
	const range = getSelectionRange(selection)
	if (!range) return false
	const ancestor = range.commonAncestorContainer
	if (ancestor && element.contains(ancestor)) return true
	if (typeof range.intersectsNode === "function") {
		try {
			return range.intersectsNode(element)
		} catch {
			return false
		}
	}
	return false
}

export function deriveSelectedBlockIds(selection: Selection | null, root: ParentNode | null) {
	if (!root) return []
	const candidates = Array.from(root.querySelectorAll<HTMLElement>("[data-block-id]"))
	const blockIds: string[] = []
	for (const candidate of candidates) {
		const blockId = candidate.dataset.blockId
		if (!blockId) continue
		if (!selectionIntersectsElement(selection, candidate)) continue
		blockIds.push(blockId)
		if (blockIds.length >= MAX_SELECTED_BLOCK_IDS) break
	}
	return blockIds
}

export function deriveBlockIdsFromSelectionRects(
	range: Range | null,
	root: ParentNode | null,
	maxBlockIds = MAX_SELECTED_BLOCK_IDS,
) {
	if (!range || !root) return []
	const rects = Array.from(range.getClientRects()).filter(
		(rect) => rect.width > 0 && rect.height > 0,
	)
	if (rects.length === 0) return []
	const scores = new Map<string, number>()
	for (const candidate of root.querySelectorAll<HTMLElement>("[data-block-id]")) {
		const blockId = candidate.dataset.blockId
		if (!blockId) continue
		const blockRect = candidate.getBoundingClientRect()
		if (blockRect.width <= 0 || blockRect.height <= 0) continue
		let score = 0
		for (const rect of rects) {
			score += intersectionArea(rect, blockRect)
		}
		if (score > 0) scores.set(blockId, score)
	}
	return [...scores.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, maxBlockIds)
		.map(([blockId]) => blockId)
}

export function clearBrowserSelection() {
	if (typeof window === "undefined") return
	window.getSelection()?.removeAllRanges()
}

function getSelectionRange(selection: Selection | null) {
	if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
	try {
		return selection.getRangeAt(0)
	} catch {
		return null
	}
}

function intersectionArea(
	a: Pick<DOMRectReadOnly, "left" | "top" | "right" | "bottom">,
	b: Pick<DOMRectReadOnly, "left" | "top" | "right" | "bottom">,
) {
	const width = Math.min(a.right, b.right) - Math.max(a.left, b.left)
	if (width <= 0) return 0
	const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
	if (height <= 0) return 0
	return width * height
}
