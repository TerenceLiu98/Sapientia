// One-shot diagnostic: pulls a paper's stashed MinerU zip out of S3 and prints
// the first block's bbox alongside the page_size we read from middle.json /
// layout.json. That lets us tell at a glance whether bbox & page_size share a
// coordinate system (PDF points vs raster pixels).
//
// Usage:
//   pnpm --filter @sapientia/api tsx scripts/inspect-mineru-zip.ts <paperId>
//
// Requires the API's normal env (DATABASE_URL, S3_*).

import { papers } from "@sapientia/db"
import { eq } from "drizzle-orm"
import { db } from "../src/db"
import { extractMineruZip, parsePageSizes } from "../src/services/mineru-zip"
import { readPdfPageSizes } from "../src/services/pdf-dims"
import { downloadFromS3 } from "../src/services/s3-client"

const paperId = process.argv[2]
if (!paperId) {
	console.error("usage: inspect-mineru-zip.ts <paperId>")
	process.exit(1)
}

const [paper] = await db.select().from(papers).where(eq(papers.id, paperId)).limit(1)
if (!paper) {
	console.error(`paper ${paperId} not found`)
	process.exit(1)
}

const userId = paper.ownerUserId
const zipKey = `papers/${userId}/${paperId}/mineru-result.zip`
console.log("zipKey:", zipKey)

const zipBytes = await downloadFromS3(zipKey)
const { contentList, middle, layout } = await extractMineruZip(Buffer.from(zipBytes))
console.log("middle present:", Boolean(middle), "layout present:", Boolean(layout))

const pageSizes = parsePageSizes({ middle, layout })
console.log("MinerU layout/middle page_size (page_idx -> [w,h]):")
for (const [idx, dims] of pageSizes) console.log(`  ${idx}: [${dims.w}, ${dims.h}]`)

const pdfBytes = await downloadFromS3(paper.pdfObjectKey)
const pdfDims = await readPdfPageSizes(pdfBytes)
console.log("pdf-lib MediaBox dims (page_idx -> [w,h]):")
for (const [idx, dims] of pdfDims) console.log(`  ${idx}: [${dims.w}, ${dims.h}]`)

const items = JSON.parse(contentList.toString("utf8")) as Array<{
	type?: string
	page_idx?: number
	bbox?: number[]
	text?: string
}>

console.log(`content_list items: ${items.length}`)

// Per-page extents: max x2 / max y2 across all blocks on the page.
const extents = new Map<number, { maxX: number; maxY: number; minX: number; minY: number }>()
for (const item of items) {
	const idx = item.page_idx ?? 0
	const bbox = item.bbox
	if (!bbox || bbox.length !== 4) continue
	const [x1, y1, x2, y2] = bbox
	const cur = extents.get(idx) ?? {
		maxX: -Infinity,
		maxY: -Infinity,
		minX: Infinity,
		minY: Infinity,
	}
	cur.maxX = Math.max(cur.maxX, x2)
	cur.maxY = Math.max(cur.maxY, y2)
	cur.minX = Math.min(cur.minX, x1)
	cur.minY = Math.min(cur.minY, y1)
	extents.set(idx, cur)
}
console.log("bbox extents (page_idx -> minX/maxX, minY/maxY):")
for (const [idx, e] of extents) {
	console.log(`  ${idx}: x [${e.minX}..${e.maxX}], y [${e.minY}..${e.maxY}]`)
}

console.log("first 8 blocks on page 0:")
const p0 = items.filter((i) => (i.page_idx ?? 0) === 0).slice(0, 8)
for (const item of p0) {
	const bb = item.bbox
	const center = bb ? `cx=${((bb[0] + bb[2]) / 2).toFixed(1)}` : ""
	console.log(
		`  ${item.type ?? "?"}  bbox=${JSON.stringify(bb)}  ${center}  ${(item.text ?? "").slice(0, 50)}`,
	)
}

process.exit(0)
