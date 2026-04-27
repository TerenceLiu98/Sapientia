import { afterEach, describe, expect, it, vi } from "vitest"

const getTextMock = vi.fn()
const destroyMock = vi.fn()

vi.mock("pdf-parse", () => ({
	PDFParse: class {
		getText = getTextMock
		destroy = destroyMock
	},
}))

afterEach(() => {
	vi.clearAllMocks()
})

describe("identifier-extractor", () => {
	it("extracts DOI, arXiv id, and candidate title from head text", async () => {
		getTextMock.mockResolvedValue({
			text: [
				"Attention Is All You Need",
				"",
				"Some author list",
				"10.5555/abc123.",
				"arXiv:2401.12345v2",
			].join("\n"),
		})

		const { extractIdentifiers } = await import("./identifier-extractor")
		const result = await extractIdentifiers({
			pdfBytes: Buffer.from("%PDF-test"),
			filename: "paper.pdf",
		})

		expect(result).toMatchObject({
			doi: "10.5555/abc123",
			arxivId: "2401.12345",
			candidateTitle: "Attention Is All You Need",
		})
		expect(destroyMock).toHaveBeenCalled()
	})
})
