import { createHash } from "node:crypto"
import type { NewBlock } from "@sapientia/db"
import { z } from "zod"

// Lenient: MinerU may add fields, we don't care, we passthrough.
const RawContentItemSchema = z
	.object({
		type: z.string().optional(),
		text: z.string().optional(),
		text_level: z.number().optional(),
		text_format: z.string().optional(),
		img_path: z.string().optional(),
		img_caption: z.array(z.string()).optional(),
		image_caption: z.array(z.string()).optional(),
		image_footnote: z.array(z.string()).optional(),
		table_body: z.string().optional(),
		table_caption: z.array(z.string()).optional(),
		table_footnote: z.array(z.string()).optional(),
		list_items: z.array(z.unknown()).optional(),
		sub_type: z.string().optional(),
		page_idx: z.number().optional(),
		// Real MinerU output: [x1, y1, x2, y2]. Some VLM responses have nothing.
		bbox: z.array(z.number()).length(4).optional(),
	})
	.passthrough()

const ContentListSchema = z.array(RawContentItemSchema)

export type BlockType =
	| "text"
	| "heading"
	| "figure"
	| "table"
	| "equation"
	| "list"
	| "code"
	| "other"

export type ParsedBlock = Omit<NewBlock, "paperId" | "createdAt">

function blockIdFromContent(content: string): string {
	return createHash("sha256").update(content).digest("hex").slice(0, 8)
}

// MinerU's bbox is two corners [x1, y1, x2, y2]; convert to {x, y, w, h}.
function toBboxObject(
	bbox: number[] | undefined,
): { x: number; y: number; w: number; h: number } | null {
	if (!bbox || bbox.length !== 4) return null
	const [x1, y1, x2, y2] = bbox
	return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) }
}

function mapType(rawType: string | undefined, hasTextLevel: boolean): BlockType {
	switch (rawType) {
		case "image":
			return "figure"
		case "table":
			return "table"
		case "list":
			return "list"
		case "equation":
			return "equation"
		case "code":
			return "code"
		case "header":
			// MinerU uses "header" for page-running headers, not document
			// section headings. They're noise — collapse to "other" so the
			// blocks panel can hide or de-emphasise them.
			return "other"
		case "page_footnote":
		case "aside_text":
		case "page_number":
			return "other"
		case "text":
			return hasTextLevel ? "heading" : "text"
		default:
			return "other"
	}
}

function captionFromArray(arr: string[] | undefined): string | null {
	if (!arr || arr.length === 0) return null
	const joined = arr.join(" ").trim()
	return joined.length > 0 ? joined : null
}

export function parseContentList(jsonBytes: Uint8Array | string): ParsedBlock[] {
	const text = typeof jsonBytes === "string" ? jsonBytes : new TextDecoder().decode(jsonBytes)
	const raw = JSON.parse(text) as unknown
	const items = ContentListSchema.parse(raw)

	const out: ParsedBlock[] = []

	for (let i = 0; i < items.length; i++) {
		const item = items[i]
		const type = mapType(item.type, item.text_level != null)

		const captionFromImage = captionFromArray(item.img_caption ?? item.image_caption)
		const captionFromTable = captionFromArray(item.table_caption)

		let textContent = ""
		let caption: string | null = null
		const metadata: Record<string, unknown> = {}

		if (type === "heading" || type === "text" || type === "code" || type === "equation") {
			textContent = item.text ?? ""
		} else if (type === "list") {
			textContent = item.text ?? ""
			if (item.list_items) metadata.listItems = item.list_items
			if (item.sub_type) metadata.listSubType = item.sub_type
		} else if (type === "figure") {
			caption = captionFromImage
			textContent = caption ?? ""
			if (item.img_path) metadata.imgPath = item.img_path
			if (item.image_footnote) metadata.imageFootnote = item.image_footnote
		} else if (type === "table") {
			caption = captionFromTable
			textContent = caption ?? ""
			if (item.table_body) metadata.tableBody = item.table_body
			if (item.table_footnote) metadata.tableFootnote = item.table_footnote
		} else {
			// "other" — preserve text if any (page footnotes etc.)
			textContent = item.text ?? ""
			if (item.type) metadata.originalType = item.type
		}

		const contentForHash = JSON.stringify({
			type,
			text: textContent,
			caption,
			page: item.page_idx ?? 0,
			img: item.img_path ?? null,
			i,
		})
		const blockId = blockIdFromContent(contentForHash)

		out.push({
			blockId,
			blockIndex: i,
			type,
			page: (item.page_idx ?? 0) + 1,
			bbox: toBboxObject(item.bbox),
			text: textContent,
			headingLevel: type === "heading" ? (item.text_level ?? null) : null,
			caption,
			imageObjectKey: null,
			metadata: Object.keys(metadata).length > 0 ? metadata : null,
		})
	}

	// Belt-and-braces uniqueness in case two items hash identically (the index
	// is included in the hash above so this should be very rare).
	const seen = new Set<string>()
	for (const b of out) {
		let id = b.blockId
		let suffix = 1
		while (seen.has(id)) {
			id = `${b.blockId}-${suffix++}`
		}
		seen.add(id)
		b.blockId = id
	}

	return out
}
