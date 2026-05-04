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
	paper: Pick<
		Paper,
		| "id"
		| "title"
		| "authors"
		| "year"
		| "doi"
		| "arxivId"
		| "venue"
		| "pages"
		| "volume"
		| "issue"
		| "publisher"
		| "publicationType"
		| "url"
		| "abstract"
	>,
): string {
	return paperToBibtexWithKey(paper, bibtexKey(paper))
}

function paperToBibtexWithKey(
	paper: Parameters<typeof paperToBibtex>[0],
	key: string,
): string {
	const entryType = bibtexEntryType(paper)
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
	if (paper.pages) fields.push(`  pages = {${escapeLatex(paper.pages)}}`)
	if (paper.volume) fields.push(`  volume = {${escapeLatex(paper.volume)}}`)
	if (paper.issue) fields.push(`  number = {${escapeLatex(paper.issue)}}`)
	if (paper.publisher) fields.push(`  publisher = {${escapeLatex(paper.publisher)}}`)
	if (paper.url) fields.push(`  url = {${escapeLatex(paper.url)}}`)
	if (paper.abstract) fields.push(`  abstract = {${escapeLatex(paper.abstract)}}`)

	return `@${entryType}{${key},\n${fields.join(",\n")}\n}`
}

export function papersToBibtex(
	papers: Array<Parameters<typeof paperToBibtex>[0]>,
): string {
	const keys = uniqueBibtexKeys(papers)
	return `% BibTeX export from Sapientia\n% Generated: ${new Date().toISOString()}\n\n${papers
		.map((paper, index) => paperToBibtexWithKey(paper, keys[index] ?? bibtexKey(paper)))
		.join("\n\n")}\n`
}

function bibtexEntryType(
	paper: Pick<Paper, "publicationType" | "arxivId" | "venue">,
): "article" | "inproceedings" | "misc" | "book" | "incollection" {
	if (paper.publicationType === "conference") return "inproceedings"
	if (paper.publicationType === "journal") return "article"
	if (paper.publicationType === "book") return "book"
	if (paper.publicationType === "chapter") return "incollection"
	if (paper.publicationType === "preprint") return "misc"
	if (paper.arxivId && !paper.venue) return "misc"
	if (paper.venue && /\b(conference|proceedings|workshop|symposium)\b/i.test(paper.venue)) {
		return "inproceedings"
	}
	return "article"
}

function uniqueBibtexKeys(papers: Array<Parameters<typeof paperToBibtex>[0]>): string[] {
	const counts = new Map<string, number>()
	const bases = papers.map(bibtexKey)
	for (const base of bases) {
		counts.set(base, (counts.get(base) ?? 0) + 1)
	}
	const seen = new Map<string, number>()
	return bases.map((base) => {
		if ((counts.get(base) ?? 0) === 1) return base
		const index = seen.get(base) ?? 0
		seen.set(base, index + 1)
		return `${base}${String.fromCharCode("a".charCodeAt(0) + index)}`
	})
}

function bibtexKey(paper: Pick<Paper, "id" | "authors" | "year" | "title">): string {
	const lastName = paper.authors?.[0] ? extractLastName(paper.authors[0]).toLowerCase() : null
	const year = paper.year ? String(paper.year) : null
	const titleWord =
		paper.title
			?.toLowerCase()
			.split(/\s+/)
			.map((word) => word.replace(/[^a-z0-9]/g, ""))
			.find((word) => word.length > 3 && !STOP_WORDS.has(word)) ?? null
	const parts = [lastName, year, titleWord].filter(Boolean)
	if (parts.length === 0) return `paper${paper.id.slice(0, 8)}`
	return parts.join("").replace(/[^a-z0-9]/g, "")
}

function escapeLatex(value: string): string {
	return value
		.split(/(\$[^$]*\$)/g)
		.map((segment) =>
			segment.startsWith("$") && segment.endsWith("$")
				? segment
				: segment.replace(/[\\{}$&#%_^~]/g, (char) => LATEX_ESCAPES[char] ?? char),
		)
		.join("")
}

const STOP_WORDS = new Set([
	"about",
	"after",
	"also",
	"from",
	"into",
	"with",
	"using",
	"toward",
	"towards",
	"paper",
	"study",
	"approach",
])
