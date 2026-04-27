// Confirms the diagnosis: read the PDF's MediaBox dims from the source PDF
// and compare against what middle.json claims.

import { papers } from "@sapientia/db"
import { eq } from "drizzle-orm"
import { db } from "../src/db"
import { extractMineruZip, parsePageSizes } from "../src/services/mineru-zip"
import { readPdfPageSizes } from "../src/services/pdf-dims"
import { downloadFromS3 } from "../src/services/s3-client"

const paperId = process.argv[2]
if (!paperId) {
	console.error("usage: check-pdf-dims.ts <paperId>")
	process.exit(1)
}

const [paper] = await db.select().from(papers).where(eq(papers.id, paperId)).limit(1)
if (!paper) {
	console.error(`paper ${paperId} not found`)
	process.exit(1)
}

const pdfBytes = await downloadFromS3(paper.pdfObjectKey)
const fromPdf = await readPdfPageSizes(pdfBytes)
console.log("PDF MediaBox dims (page_idx -> [w, h]):")
for (const [idx, dims] of [...fromPdf].slice(0, 3)) {
	console.log(`  ${idx}: [${dims.w}, ${dims.h}]`)
}

const zipKey = `papers/${paper.ownerUserId}/${paperId}/mineru-result.zip`
const zipBytes = await downloadFromS3(zipKey)
const { middle, layout } = await extractMineruZip(Buffer.from(zipBytes))
const fromMineru = parsePageSizes({ middle, layout })
console.log("MinerU page_size (page_idx -> [w, h]):")
for (const [idx, dims] of [...fromMineru].slice(0, 3)) {
	console.log(`  ${idx}: [${dims.w}, ${dims.h}]`)
}

process.exit(0)
