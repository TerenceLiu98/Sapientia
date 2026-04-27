/**
 * Citation extraction from BlockNote document JSON.
 *
 * BlockNote stores documents as a tree of blocks; each block has a flat
 * `content` array of inline nodes. Our custom inline node `blockCitation`
 * carries the (paperId, blockId) tuple plus a snapshot string. This
 * module walks a document and aggregates those tuples — the API uses
 * the result to rebuild `note_block_refs` on every save.
 */

export interface CitationRef {
	paperId: string
	blockId: string
	count: number
}

interface InlineNodeShape {
	type?: string
	content?: unknown
	props?: { paperId?: string; blockId?: string; snapshot?: string } & Record<string, unknown>
}

interface BlockShape {
	type?: string
	content?: unknown
	children?: unknown
}

export function extractCitations(doc: unknown): CitationRef[] {
	if (!Array.isArray(doc)) return []
	const counts = new Map<string, CitationRef>()

	const visitInline = (node: unknown): void => {
		if (typeof node !== "object" || node === null) return
		const n = node as InlineNodeShape

		if (n.type === "blockCitation" && n.props) {
			const { paperId, blockId } = n.props
			if (typeof paperId === "string" && typeof blockId === "string" && paperId && blockId) {
				const key = `${paperId}#${blockId}`
				const existing = counts.get(key)
				if (existing) existing.count += 1
				else counts.set(key, { paperId, blockId, count: 1 })
			}
		}

		if (Array.isArray(n.content)) {
			for (const child of n.content) visitInline(child)
		}
	}

	const visitBlock = (block: unknown): void => {
		if (typeof block !== "object" || block === null) return
		const b = block as BlockShape
		if (Array.isArray(b.content)) {
			for (const inline of b.content) visitInline(inline)
		}
		if (Array.isArray(b.children)) {
			for (const child of b.children) visitBlock(child)
		}
	}

	for (const block of doc) visitBlock(block)
	return [...counts.values()]
}

// Markdown surface form for a citation chip:
//   [[<paperId>#<blockId>: <snapshot>]]
// Chosen because it's grep-able, stays readable in any markdown reader,
// and survives processors that don't understand it (looks like a footnote).
// `]]` inside the snapshot is escaped to `] ]` to keep the closer unique.
export function formatCitationToken(args: {
	paperId: string
	blockId: string
	snapshot: string
}): string {
	const safe = args.snapshot.replace(/\]\]/g, "] ]")
	return `[[${args.paperId}#${args.blockId}: ${safe}]]`
}
