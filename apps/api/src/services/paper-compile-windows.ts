import type { Block } from "@sapientia/db"

export type PaperCompileBlock = Pick<
	Block,
	"blockId" | "blockIndex" | "type" | "page" | "text" | "headingLevel"
>

export interface PaperCompileWindow {
	windowId: string
	primaryPage: number
	pageRange: [number, number]
	headingPath: string[]
	primaryBlockIds: string[]
	contextBlockIds: string[]
	blockIds: string[]
	blocks: PaperCompileBlock[]
}

export interface BuildPaperCompileWindowsOptions {
	contextBlocksPerSide?: number
	pagesPerWindow?: number
}

const DEFAULT_CONTEXT_BLOCKS_PER_SIDE = 2
const DEFAULT_PAGES_PER_WINDOW = 2

export function buildPaperCompileWindows(
	blocks: PaperCompileBlock[],
	options: BuildPaperCompileWindowsOptions = {},
): PaperCompileWindow[] {
	if (blocks.length === 0) return []

	const contextBlocksPerSide = options.contextBlocksPerSide ?? DEFAULT_CONTEXT_BLOCKS_PER_SIDE
	const pagesPerWindow = Math.max(1, options.pagesPerWindow ?? DEFAULT_PAGES_PER_WINDOW)
	const sortedBlocks = [...blocks].sort((a, b) => a.blockIndex - b.blockIndex)
	const pages = uniqueNumbers(sortedBlocks.map((block) => normalizePage(block.page)))
	const headingPathByPage = buildHeadingPathByPage(sortedBlocks, pages)

	const windows: PaperCompileWindow[] = []
	for (let pageIndex = 0; pageIndex < pages.length; pageIndex += pagesPerWindow) {
		const windowPages = pages.slice(pageIndex, pageIndex + pagesPerWindow)
		const pageStart = windowPages[0]
		const pageEnd = windowPages[windowPages.length - 1]
		const pageSet = new Set(windowPages)
		const primaryBlocks = sortedBlocks.filter((block) => pageSet.has(normalizePage(block.page)))
		const primaryStartIndex = sortedBlocks.findIndex((block) => block.blockId === primaryBlocks[0]?.blockId)
		const primaryEndIndex = sortedBlocks.findIndex(
			(block) => block.blockId === primaryBlocks[primaryBlocks.length - 1]?.blockId,
		)
		const beforeBlocks =
			primaryStartIndex > 0
				? sortedBlocks.slice(Math.max(0, primaryStartIndex - contextBlocksPerSide), primaryStartIndex)
				: []
		const afterBlocks =
			primaryEndIndex >= 0
				? sortedBlocks.slice(primaryEndIndex + 1, primaryEndIndex + 1 + contextBlocksPerSide)
				: []
		const contextBlocks = [...beforeBlocks, ...afterBlocks]
		const windowBlocks = uniqueBlocks([...beforeBlocks, ...primaryBlocks, ...afterBlocks])

		windows.push({
			windowId:
				pageStart === pageEnd
					? `page-${String(pageStart).padStart(4, "0")}`
					: `pages-${String(pageStart).padStart(4, "0")}-${String(pageEnd).padStart(4, "0")}`,
			primaryPage: pageStart,
			pageRange: [pageStart, pageEnd],
			headingPath: headingPathByPage.get(pageStart) ?? [],
			primaryBlockIds: primaryBlocks.map((block) => block.blockId),
			contextBlockIds: contextBlocks.map((block) => block.blockId),
			blockIds: windowBlocks.map((block) => block.blockId),
			blocks: windowBlocks,
		})
	}

	return windows
}

function buildHeadingPathByPage(blocks: PaperCompileBlock[], pages: number[]) {
	const result = new Map<number, string[]>()
	const headingPath: string[] = []
	let pageCursor = 0

	for (const block of blocks) {
		const page = normalizePage(block.page)
		while (pageCursor < pages.length && pages[pageCursor] < page) {
			result.set(pages[pageCursor], [...headingPath])
			pageCursor += 1
		}

		if (block.type === "heading" && block.text.trim()) {
			const level = block.headingLevel && block.headingLevel > 0 ? block.headingLevel : 1
			headingPath.splice(level - 1)
			headingPath[level - 1] = block.text.trim()
		}

		result.set(page, [...headingPath])
	}

	while (pageCursor < pages.length) {
		result.set(pages[pageCursor], [...headingPath])
		pageCursor += 1
	}

	return result
}

function normalizePage(page: number | null | undefined) {
	return typeof page === "number" && Number.isFinite(page) && page > 0 ? page : 1
}

function uniqueNumbers(values: number[]) {
	return [...new Set(values)].sort((a, b) => a - b)
}

function uniqueBlocks(blocks: PaperCompileBlock[]) {
	const seen = new Set<string>()
	const result: PaperCompileBlock[] = []
	for (const block of blocks) {
		if (seen.has(block.blockId)) continue
		seen.add(block.blockId)
		result.push(block)
	}
	return result
}
