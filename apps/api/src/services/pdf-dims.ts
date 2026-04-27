import { PDFDocument } from "pdf-lib"

// Read each page's MediaBox dimensions in PDF user-units (points). MinerU's
// `content_list.json` bbox values are in this same coordinate space, so
// dividing by these dims gives the right [0, 1] ratio for the overlay.
//
// We learned the hard way that MinerU's `_middle.json` `page_size` is *not*
// reliably in the same units as content_list bbox — sometimes it reports
// US-Letter [612, 792] for a page whose content_list bbox values clearly span
// a wider coordinate system. Reading from the source PDF bypasses that
// ambiguity entirely.
export async function readPdfPageSizes(
	pdfBytes: Uint8Array,
): Promise<Map<number, { w: number; h: number }>> {
	const out = new Map<number, { w: number; h: number }>()
	const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false })
	const pages = doc.getPages()
	for (let i = 0; i < pages.length; i++) {
		const { width, height } = pages[i].getSize()
		out.set(i, { w: width, h: height })
	}
	return out
}
