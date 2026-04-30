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
