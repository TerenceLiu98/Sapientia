import type { Paper } from "@sapientia/db"
import { extractLastName } from "./filename"

const LATEX_ESCAPES: Record<string, string> = {
	"\\": "\\textbackslash{}",
	"{": "\\{",
	"}": "\\}",
	$: "\\$",
	"&": "\\&",
	"#": "\\#",
	"%": "\\%",
	_: "\\_",
	"^": "\\^{}",
	"~": "\\~{}",
}

export function paperToBibtex(
	paper: Pick<Paper, "id" | "title" | "authors" | "year" | "doi" | "arxivId" | "venue">,
): string {
	const key = bibtexKey(paper)
	let entryType = "article"
	if (paper.arxivId && !paper.venue) entryType = "misc"
	if (paper.venue && /\b(conference|proceedings|workshop|symposium)\b/i.test(paper.venue)) {
		entryType = "inproceedings"
	}

	const fields: string[] = []
	if (paper.title) fields.push(`  title = {${escapeLatex(paper.title)}}`)
	if (paper.authors && paper.authors.length > 0) {
		fields.push(`  author = {${paper.authors.map(escapeLatex).join(" and ")}}`)
	}
	if (paper.year) fields.push(`  year = {${paper.year}}`)
	if (paper.doi) fields.push(`  doi = {${escapeLatex(paper.doi)}}`)
	if (paper.arxivId) {
		fields.push(`  eprint = {${paper.arxivId}}`)
		fields.push("  archivePrefix = {arXiv}")
	}
	if (paper.venue) {
		const venueField = entryType === "inproceedings" ? "booktitle" : "journal"
		fields.push(`  ${venueField} = {${escapeLatex(paper.venue)}}`)
	}

	return `@${entryType}{${key},\n${fields.join(",\n")}\n}`
}

export function papersToBibtex(
	papers: Array<Pick<Paper, "id" | "title" | "authors" | "year" | "doi" | "arxivId" | "venue">>,
): string {
	return `% BibTeX export from Sapientia\n% Generated: ${new Date().toISOString()}\n\n${papers
		.map(paperToBibtex)
		.join("\n\n")}\n`
}

function bibtexKey(paper: Pick<Paper, "id" | "authors" | "year" | "title">): string {
	const lastName = paper.authors?.[0] ? extractLastName(paper.authors[0]).toLowerCase() : null
	const year = paper.year ? String(paper.year) : null
	const titleWord =
		paper.title
			?.toLowerCase()
			.split(/\s+/)
			.find((word) => word.length > 3) ?? null
	const parts = [lastName, year, titleWord].filter(Boolean)
	if (parts.length === 0) return `paper${paper.id.slice(0, 8)}`
	return parts.join("").replace(/[^a-z0-9]/g, "")
}

function escapeLatex(value: string): string {
	return value.replace(/[\\{}$&#%_^~]/g, (char) => LATEX_ESCAPES[char] ?? char)
}
