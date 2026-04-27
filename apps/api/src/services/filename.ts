const MAX_FILENAME_LENGTH = 100

const STOP_WORDS = new Set([
	"a",
	"an",
	"the",
	"and",
	"or",
	"but",
	"of",
	"in",
	"on",
	"at",
	"to",
	"for",
	"with",
	"by",
	"from",
	"as",
	"is",
	"are",
	"was",
	"were",
])

export function buildDisplayFilename(args: {
	paperId: string
	title: string | null
	authors: string[]
	year: number | null
}): string {
	const { paperId, title, authors, year } = args
	const parts: string[] = []

	const lastName = authors[0] ? extractLastName(authors[0]) : null
	if (lastName) parts.push(lastName)
	if (year) parts.push(String(year))
	if (title) {
		const slug = slugifyTitle(title)
		if (slug) parts.push(slug)
	}

	if (parts.length === 0) {
		return `paper-${paperId.slice(0, 8)}.pdf`
	}

	let basename = parts.join("-")
	basename = basename.replace(/[^A-Za-z0-9.-]/g, "")
	basename = basename.replace(/-+/g, "-").replace(/^-|-$/g, "")
	if (basename.length > MAX_FILENAME_LENGTH - 4) {
		basename = basename.slice(0, MAX_FILENAME_LENGTH - 4).replace(/-+$/g, "")
	}
	return `${basename}.pdf`
}

export function extractLastName(fullName: string): string {
	const trimmed = fullName.trim()
	if (!trimmed) return ""
	if (trimmed.includes(",")) {
		return trimmed.split(",")[0]?.trim().replace(/\s+/g, "") ?? ""
	}
	const parts = trimmed.split(/\s+/)
	return parts[parts.length - 1] ?? trimmed
}

function slugifyTitle(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((word) => word.length > 0 && !STOP_WORDS.has(word))
		.slice(0, 3)
		.map((word) => word[0]?.toUpperCase() + word.slice(1))
		.join("-")
}
