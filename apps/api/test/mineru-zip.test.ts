import { Buffer } from "node:buffer"
import { describe, expect, it } from "vitest"
import yazl from "yazl"
import { extractMineruZip, parsePageSizes } from "../src/services/mineru-zip"

function buildZip(files: Record<string, string>): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const zipfile = new yazl.ZipFile()
		for (const [name, content] of Object.entries(files)) {
			zipfile.addBuffer(Buffer.from(content), name)
		}
		zipfile.end()

		const chunks: Buffer[] = []
		zipfile.outputStream.on("data", (c: Buffer) => chunks.push(c))
		zipfile.outputStream.on("end", () => resolve(Buffer.concat(chunks)))
		zipfile.outputStream.on("error", reject)
	})
}

describe("mineru-zip helpers", () => {
	it("extracts layout.json and falls back to it for page sizes", async () => {
		const zip = await buildZip({
			"abc_content_list.json": "[]",
			"layout.json": JSON.stringify({
				pdf_info: [
					{ page_idx: 0, page_size: [1000, 2000] },
					{ page_idx: 1, page_size: [900, 1800] },
				],
			}),
		})

		const extracted = await extractMineruZip(zip)
		expect(extracted.layout).not.toBeNull()

		const pageSizes = parsePageSizes({ middle: null, layout: extracted.layout })
		expect(pageSizes.get(0)).toEqual({ w: 1000, h: 2000 })
		expect(pageSizes.get(1)).toEqual({ w: 900, h: 1800 })
	})
})
