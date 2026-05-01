/**
 * Audit the current reader_annotations table for any legacy rows that still
 * predate the text-markup-only model.
 *
 * Run with:
 *   node --experimental-strip-types apps/api/scripts/audit-reader-annotations.ts
 * or
 *   bun apps/api/scripts/audit-reader-annotations.ts
 */
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

async function main() {
	const databaseUrl = await resolveDatabaseUrl()
	const summaryRows = await queryPsql(
		databaseUrl,
		`
		SELECT
			count(*)::int AS total,
			count(*) FILTER (WHERE kind = 'ink')::int AS ink_rows,
			count(*) FILTER (WHERE kind NOT IN ('highlight', 'underline', 'ink'))::int AS other_kind_rows,
			count(*) FILTER (WHERE body ? 'rects')::int AS text_markup_rows,
			count(*) FILTER (WHERE body ? 'rect' AND NOT body ? 'rects')::int AS legacy_rect_rows,
			count(*) FILTER (WHERE body ? 'from' AND body ? 'to' AND NOT body ? 'rects')::int AS legacy_underline_rows
		FROM reader_annotations
		`,
	)
	const sampleRows = await queryPsql(
		databaseUrl,
		`
		SELECT
			id::text,
			paper_id::text,
			page::text,
			kind,
			body::text
		FROM reader_annotations
		WHERE kind = 'ink'
		   OR kind NOT IN ('highlight', 'underline', 'ink')
		   OR (body ? 'rect' AND NOT body ? 'rects')
		   OR (body ? 'from' AND body ? 'to' AND NOT body ? 'rects')
		ORDER BY created_at DESC
		LIMIT 10
		`,
	)

	console.log("reader_annotations audit")
	if (summaryRows[0]) {
		const [total, inkRows, otherKindRows, textMarkupRows, legacyRectRows, legacyUnderlineRows] =
			summaryRows[0]
		console.table([
			{
				total: Number(total ?? 0),
				ink_rows: Number(inkRows ?? 0),
				other_kind_rows: Number(otherKindRows ?? 0),
				text_markup_rows: Number(textMarkupRows ?? 0),
				legacy_rect_rows: Number(legacyRectRows ?? 0),
				legacy_underline_rows: Number(legacyUnderlineRows ?? 0),
			},
		])
	}

	if (sampleRows.length > 0) {
		console.log("legacy samples")
		console.table(
			sampleRows.map(([id, paperId, page, kind, body]) => ({
				id,
				paperId,
				page: Number(page ?? 0),
				kind,
				body,
			})),
		)
	} else {
		console.log("No legacy reader annotation rows found.")
	}
}

async function queryPsql(databaseUrl: string, query: string) {
	const { stdout } = await execFileAsync("psql", [
		databaseUrl,
		"-X",
		"-A",
		"-F",
		"\t",
		"-t",
		"-v",
		"ON_ERROR_STOP=1",
		"-c",
		query,
	])

	return stdout
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter(Boolean)
		.map((line) => line.split("\t"))
}

async function resolveDatabaseUrl() {
	if (process.env.DATABASE_URL) return process.env.DATABASE_URL
	const envPath = resolve(import.meta.dirname, "../../../packages/db/.env")
	try {
		const contents = await readFile(envPath, "utf8")
		for (const line of contents.split(/\r?\n/)) {
			const trimmed = line.trim()
			if (!trimmed || trimmed.startsWith("#")) continue
			if (!trimmed.startsWith("DATABASE_URL=")) continue
			return trimmed.slice("DATABASE_URL=".length)
		}
	} catch {
		// Fall through to the explicit error below.
	}
	throw new Error("DATABASE_URL is not set and packages/db/.env could not provide one.")
}

await main()
