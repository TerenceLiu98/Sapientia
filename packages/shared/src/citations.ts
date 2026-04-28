/**
 * Citation extraction from Tiptap document JSON.
 *
 * Tiptap stores documents as a tree rooted at `{ type: 'doc', content: [...] }`.
 * Every node has an optional `content` array of children. Our custom
 * `blockCitation` node lives inline (inside a paragraph's content array)
 * and carries the `(paperId, blockId)` tuple plus a snapshot string in
 * `attrs`. This module walks the tree and aggregates those tuples — the
 * API uses the result to rebuild `note_block_refs` on every save.
 *
 * Legacy empty BlockNote payloads (`[]`) and unknown shapes return `[]`
 * gracefully, so a freshly-created note that hasn't been edited yet
 * doesn't throw on the first save.
 */

export interface CitationRef {
	paperId: string
	blockId: string
	count: number
}

interface Node {
	type?: string
	content?: unknown
	// Legacy BlockNote nested-list shape — children of a list-item live in
	// `children` rather than `content`. Walk both so notes saved before the
	// migration still extract correctly.
	children?: unknown
	attrs?: {
		paperId?: string
		blockId?: string
		blockNumber?: number
		snapshot?: string
	} & Record<string, unknown>
	// Legacy BlockNote shape — kept so the extractor doesn't false-negative
	// on rows still in the BlockNote format. New notes never write `props`.
	props?: {
		paperId?: string
		blockId?: string
		blockNumber?: number
		snapshot?: string
	} & Record<string, unknown>
}

export function extractCitations(doc: unknown): CitationRef[] {
	const counts = new Map<string, CitationRef>()

	const visit = (node: unknown): void => {
		if (typeof node !== "object" || node === null) return
		const n = node as Node

		if (n.type === "blockCitation") {
			const data = n.attrs ?? n.props
			const paperId = data?.paperId
			const blockId = data?.blockId
			if (typeof paperId === "string" && typeof blockId === "string" && paperId && blockId) {
				const key = `${paperId}#${blockId}`
				const existing = counts.get(key)
				if (existing) existing.count += 1
				else counts.set(key, { paperId, blockId, count: 1 })
			}
		}

		if (Array.isArray(n.content)) {
			for (const child of n.content) visit(child)
		}
		if (Array.isArray(n.children)) {
			for (const child of n.children) visit(child)
		}
	}

	if (Array.isArray(doc)) {
		// Legacy BlockNote shape: doc is the top-level blocks array.
		for (const block of doc) visit(block)
	} else if (typeof doc === "object" && doc !== null) {
		// Tiptap shape: doc is `{ type: 'doc', content: [...] }`.
		visit(doc)
	}

	return [...counts.values()]
}

// Markdown surface form for a citation chip. New format anchors the
// citation to its 1-based block index — e.g. `[[block 12 · paperId#blockId]]`
// — so the markdown stays readable while still being grep-able and
// resolvable. Older notes that only stored a snapshot fall back to that
// snapshot inside the brackets.
export function formatCitationToken(args: {
	paperId: string
	blockId: string
	blockNumber?: number
	snapshot?: string
}): string {
	if (typeof args.blockNumber === "number" && args.blockNumber > 0) {
		return `[[block ${args.blockNumber} · ${args.paperId}#${args.blockId}]]`
	}
	const safe = (args.snapshot ?? "").replace(/\]\]/g, "] ]")
	return `[[${args.paperId}#${args.blockId}${safe ? `: ${safe}` : ""}]]`
}
