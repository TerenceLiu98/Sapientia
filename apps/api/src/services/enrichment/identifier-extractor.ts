import { PDFParse } from "pdf-parse"
import { stripTrailingPunctuation } from "./utils"

const DOI_PATTERN = /\b10\.\d{4,9}\/[^\s\]<>"]+/g
const ARXIV_ID_PATTERN = /\b(\d{4}\.\d{4,5})(v\d+)?\b/

export interface ExtractedIdentifiers {
	doi: string | null
	arxivId: string | null
	candidateTitle: string | null
	rawHeadText: string
}

export async function extractIdentifiers(args: {
	pdfBytes: Buffer
	filename: string
}): Promise<ExtractedIdentifiers> {
	const { pdfBytes, filename } = args

	let text = ""
	try {
		const parser = new PDFParse({ data: pdfBytes })
		const result = await parser.getText({ first: 3 })
		text = result.text ?? ""
		await parser.destroy()
	} catch {
		text = ""
	}

	const doiMatches = text.match(DOI_PATTERN)
	const doi = doiMatches?.[0] ? stripTrailingPunctuation(doiMatches[0]) : null

	let arxivId: string | null = null
	const fileMatch = filename.match(ARXIV_ID_PATTERN)
	if (fileMatch?.[1]) {
		arxivId = fileMatch[1]
	} else {
		const textMatch = text.match(ARXIV_ID_PATTERN)
		if (textMatch?.[1]) arxivId = textMatch[1]
	}

	return {
		doi,
		arxivId,
		candidateTitle: extractCandidateTitle(text),
		rawHeadText: text.slice(0, 5000),
	}
}

function extractCandidateTitle(text: string): string | null {
	const lines = text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)

	for (const line of lines.slice(0, 30)) {
		if (line.length < 10 || line.length > 300) continue
		if (line === line.toUpperCase()) continue
		if (/^(abstract|introduction|page|figure|table)\b/i.test(line)) continue
		if (/^\d+$/.test(line)) continue
		if (/[a-z]/.test(line) && /[a-zA-Z]{3,}/.test(line)) {
			return line.slice(0, 300)
		}
	}
	return null
}
