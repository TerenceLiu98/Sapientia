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

const NORMALIZED_BBOX_EPSILON = 0.02
// MinerU's content_list.json bbox is normalized so that BOTH x and y map to
// the 0-1000 range — the page is treated as an abstract 1000×1000 square,
// independent of the PDF's actual aspect ratio. The frontend renders the PDF
// at its real pixel dimensions, so multiplying ratio × actual_pixel_dim
// recovers the correct on-screen position.
//
// Empirical evidence (collected across 3 papers):
//   - Centered blocks have bbox center.x ≈ 498-500 → page midpoint
//   - Block y values span [~65, ~890], not [0, 792] (PDF points). A title at
//     PDF point y≈90 normalizes to bbox.y≈119 → ratio 0.119, which lifted
//     to a 792-pt page gives back ≈94pt — matches the visual.
//   - Aspect is NOT preserved in bbox space (612×792 portrait page maps to
//     1000×1000 in MinerU coords, getting compressed vertically in
//     MinerU's normalized space and decompressed back when rendered).
//
// Documented as 0-1000 here:
//   https://opendatalab.github.io/MinerU/reference/output_files/
const MINERU_CANVAS_UNITS = 1000

function isValidNormalizedBbox(bbox: { x: number; y: number; w: number; h: number }): boolean {
	if (!Number.isFinite(bbox.x) || !Number.isFinite(bbox.y)) return false
	if (!Number.isFinite(bbox.w) || !Number.isFinite(bbox.h)) return false
	if (bbox.x < 0 || bbox.y < 0 || bbox.w <= 0 || bbox.h <= 0) return false
	if (bbox.x > 1 + NORMALIZED_BBOX_EPSILON || bbox.y > 1 + NORMALIZED_BBOX_EPSILON) return false
	if (bbox.x + bbox.w > 1 + NORMALIZED_BBOX_EPSILON) return false
	if (bbox.y + bbox.h > 1 + NORMALIZED_BBOX_EPSILON) return false
	return true
}

function normalizeRawBbox(
	bbox: number[],
	pageSizePx: { w: number; h: number },
): { x: number; y: number; w: number; h: number } | null {
	if (pageSizePx.w <= 0 || pageSizePx.h <= 0) return null
	const [x1, y1, x2, y2] = bbox
	const normalized = {
		x: x1 / pageSizePx.w,
		y: y1 / pageSizePx.h,
		w: Math.max(0, x2 - x1) / pageSizePx.w,
		h: Math.max(0, y2 - y1) / pageSizePx.h,
	}
	return isValidNormalizedBbox(normalized) ? normalized : null
}

function looksLikeAlreadyNormalized(bbox: number[]): boolean {
	const [x1, y1, x2, y2] = bbox
	return (
		x1 >= 0 &&
		y1 >= 0 &&
		x2 > x1 &&
		y2 > y1 &&
		x2 <= 1 + NORMALIZED_BBOX_EPSILON &&
		y2 <= 1 + NORMALIZED_BBOX_EPSILON
	)
}

// MinerU normalizes every page to the same 1000×1000 abstract canvas, so
// `pdfPageDims` from the worker isn't actually needed for the math. We still
// build a per-page map (rather than a single constant) so the rest of the
// parser stays uniform and doesn't have to special-case "pages with bboxes
// vs pages without".
function deriveCanvasDims(
	items: { page_idx?: number; bbox?: number[] }[],
	_pdfPageDims: Map<number, { w: number; h: number }> | undefined,
): Map<number, { w: number; h: number }> {
	const out = new Map<number, { w: number; h: number }>()
	const pages = new Set<number>()
	for (const item of items) {
		if (item.bbox && item.bbox.length === 4) pages.add(item.page_idx ?? 0)
	}
	for (const idx of pages) {
		out.set(idx, { w: MINERU_CANVAS_UNITS, h: MINERU_CANVAS_UNITS })
	}
	return out
}

// MinerU's bbox is two corners [x1, y1, x2, y2] in the rasterized PDF's pixel
// space. We only persist normalized [0, 1] ratios, because the frontend PDF
// overlay needs a stable coordinate system across different render scales and
// DPIs. If we do not know the page's rasterized dimensions, we drop the bbox
// instead of storing raw pixels that the UI would misinterpret.
function toBboxObject(
	bbox: number[] | undefined,
	pageSizePx: { w: number; h: number } | undefined,
): { x: number; y: number; w: number; h: number } | null {
	if (!bbox || bbox.length !== 4) return null
	if (looksLikeAlreadyNormalized(bbox)) {
		const [x1, y1, x2, y2] = bbox
		return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
	}
	return pageSizePx ? normalizeRawBbox(bbox, pageSizePx) : null
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

export interface ParseContentListOptions {
	// Per page (0-indexed) rasterized pixel size. When provided, bbox is
	// converted to ratios in [0, 1]. Missing page sizes mean bbox is omitted.
	pageSizesPx?: Map<number, { w: number; h: number }>
	// Map from MinerU's relative `img_path` to the S3 object key the worker
	// uploaded it to. Stamped onto figure/table blocks as `imageObjectKey`.
	imageKeys?: Map<string, string>
}

export function parseContentList(
	jsonBytes: Uint8Array | string,
	options: ParseContentListOptions = {},
): ParsedBlock[] {
	const text = typeof jsonBytes === "string" ? jsonBytes : new TextDecoder().decode(jsonBytes)
	const raw = JSON.parse(text) as unknown
	const items = ContentListSchema.parse(raw)
	// `pageSizesPx` from the caller is the PDF MediaBox (or middle.json fallback).
	// We pass it as a hint into `deriveCanvasDims`, which then either honors it
	// (bbox values are PDF points) or grows it to fit observed bbox extents
	// (bbox is in MinerU's scaled internal space).
	const pageSizesPx = deriveCanvasDims(items, options.pageSizesPx)
	const imageKeys = options.imageKeys

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

		const pageIdx = item.page_idx ?? 0
		const imgPath = typeof item.img_path === "string" ? item.img_path : null
		out.push({
			blockId,
			blockIndex: i,
			type,
			page: pageIdx + 1,
			bbox: toBboxObject(item.bbox, pageSizesPx?.get(pageIdx)),
			text: textContent,
			headingLevel: type === "heading" ? (item.text_level ?? null) : null,
			caption,
			imageObjectKey: imgPath ? (imageKeys?.get(imgPath) ?? null) : null,
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
