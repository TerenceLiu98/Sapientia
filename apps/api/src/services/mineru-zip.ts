import yauzl from "yauzl"

export interface MineruZipContents {
	contentList: Buffer
	middle: Buffer | null
	layout: Buffer | null
	// img_path (relative within the zip, e.g. "images/foo.jpg") -> bytes.
	images: Map<string, Buffer>
}

// Walk the MinerU result zip once, extracting everything we care about:
//   - *_content_list.json (block list, required)
//   - *_middle.json       (legacy per-page rasterized dims, optional)
//   - layout.json         (newer per-page rasterized dims, optional)
//   - images/*            (figure/table crops, optional)
export async function extractMineruZip(zipBuffer: Buffer): Promise<MineruZipContents> {
	return new Promise((resolve, reject) => {
		yauzl.fromBuffer(zipBuffer, { lazyEntries: true }, (err, zipfile) => {
			if (err) return reject(err)
			if (!zipfile) return reject(new Error("zip file is empty"))

			let contentList: Buffer | null = null
			let middle: Buffer | null = null
			let layout: Buffer | null = null
			const images = new Map<string, Buffer>()

			const readEntry = (entry: yauzl.Entry, onDone: () => void) => {
				zipfile.openReadStream(entry, (streamErr, stream) => {
					if (streamErr) return reject(streamErr)
					if (!stream) return reject(new Error("read stream is null"))
					const chunks: Buffer[] = []
					stream.on("data", (c: Buffer) => chunks.push(c))
					stream.on("end", () => {
						const buf = Buffer.concat(chunks)
						if (entry.fileName.endsWith("_content_list.json")) {
							contentList = buf
						} else if (entry.fileName.endsWith("_middle.json")) {
							middle = buf
						} else if (entry.fileName === "layout.json") {
							layout = buf
						} else if (entry.fileName.includes("images/")) {
							// Normalize to "images/<filename>" so it matches the
							// img_path values inside content_list.json.
							const idx = entry.fileName.indexOf("images/")
							images.set(entry.fileName.slice(idx), buf)
						}
						onDone()
					})
					stream.on("error", reject)
				})
			}

			zipfile.readEntry()
			zipfile.on("entry", (entry) => {
				const name = entry.fileName
				const interesting =
					name.endsWith("_content_list.json") ||
					name.endsWith("_middle.json") ||
					name === "layout.json" ||
					(name.includes("images/") && !name.endsWith("/"))
				if (interesting) {
					readEntry(entry, () => zipfile.readEntry())
				} else {
					zipfile.readEntry()
				}
			})
			zipfile.on("end", () => {
				if (!contentList) {
					return reject(new Error("content_list.json not found in MinerU zip"))
				}
				resolve({ contentList, middle, layout, images })
			})
			zipfile.on("error", reject)
		})
	})
}

export function parsePageSizes(args: {
	middle?: Buffer | null
	layout?: Buffer | null
}): Map<number, { w: number; h: number }> {
	const fromMiddle = parsePdfInfoPageSizes(args.middle)
	if (fromMiddle.size > 0) return fromMiddle
	return parsePdfInfoPageSizes(args.layout)
}

function parsePdfInfoPageSizes(
	source: Buffer | null | undefined,
): Map<number, { w: number; h: number }> {
	const out = new Map<number, { w: number; h: number }>()
	if (!source) return out
	try {
		const json = JSON.parse(source.toString("utf8")) as {
			pdf_info?: Array<{ page_idx?: number; page_size?: [number, number] }>
		}
		const pages = json.pdf_info ?? []
		for (let i = 0; i < pages.length; i++) {
			const p = pages[i]
			const idx = p.page_idx ?? i
			if (p.page_size && p.page_size.length === 2) {
				out.set(idx, { w: p.page_size[0], h: p.page_size[1] })
			}
		}
	} catch {
		// fall through; caller decides what to do when page sizes are absent
	}
	return out
}
