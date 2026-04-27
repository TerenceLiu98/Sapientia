import type { Paper } from "@sapientia/db"
import { buildDisplayFilename } from "./filename"

export type EditableMetadataField = "title" | "authors" | "year" | "doi" | "arxivId" | "venue"

export type MetadataEditedByUser = NonNullable<Paper["metadataEditedByUser"]>

export function mergeMetadataEditedFlags(
	current: MetadataEditedByUser | null | undefined,
	patch: Partial<Record<EditableMetadataField, unknown>>,
): MetadataEditedByUser {
	const next = { ...(current ?? {}) }
	for (const field of ["title", "authors", "year", "doi", "arxivId", "venue"] as const) {
		if (field in patch) next[field] = true
	}
	return next
}

export function applyEnrichedMetadataToPaper(
	paper: Pick<
		Paper,
		| "id"
		| "title"
		| "authors"
		| "year"
		| "doi"
		| "arxivId"
		| "venue"
		| "metadataEditedByUser"
	>,
	enrichment: {
		metadata: Partial<{
			title: string | null
			authors: string[]
			year: number | null
			doi: string | null
			arxivId: string | null
			venue: string | null
		}> | null
		status: "enriched" | "partial" | "failed" | "skipped"
		sources: string[]
	},
) {
	const protectedFields = paper.metadataEditedByUser ?? {}
	const metadata = enrichment.metadata ?? {}

	const title =
		!protectedFields.title && metadata.title ? metadata.title : paper.title
	const authors =
		!protectedFields.authors && metadata.authors?.length ? metadata.authors : (paper.authors ?? [])
	const year =
		!protectedFields.year && metadata.year ? metadata.year : paper.year
	const doi =
		!protectedFields.doi && metadata.doi ? metadata.doi : paper.doi
	const arxivId =
		!protectedFields.arxivId && metadata.arxivId ? metadata.arxivId : paper.arxivId
	const venue =
		!protectedFields.venue && metadata.venue ? metadata.venue : paper.venue

	return {
		title,
		authors,
		year,
		doi,
		arxivId,
		venue,
		displayFilename: buildDisplayFilename({
			paperId: paper.id,
			title,
			authors,
			year,
		}),
		enrichmentStatus: enrichment.status,
		enrichmentSource: enrichment.sources.join(",") || null,
		enrichedAt: enrichment.status === "failed" ? null : new Date(),
		updatedAt: new Date(),
	}
}
