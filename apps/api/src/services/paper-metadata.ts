import type { Paper } from "@sapientia/db"
import { buildDisplayFilename } from "./filename"
import type { EnrichedMetadata, MetadataCandidate, MetadataProvenance } from "./enrichment/types"

export type EditableMetadataField =
	| "title"
	| "authors"
	| "year"
	| "doi"
	| "arxivId"
	| "venue"
	| "abstract"
	| "pages"
	| "volume"
	| "issue"
	| "publisher"
	| "publicationType"
	| "url"

const editableMetadataFields = [
	"title",
	"authors",
	"year",
	"doi",
	"arxivId",
	"venue",
	"abstract",
	"pages",
	"volume",
	"issue",
	"publisher",
	"publicationType",
	"url",
] as const satisfies readonly EditableMetadataField[]

export type MetadataEditedByUser = NonNullable<Paper["metadataEditedByUser"]>

export function mergeMetadataEditedFlags(
	current: MetadataEditedByUser | null | undefined,
	patch: Partial<Record<EditableMetadataField, unknown>>,
): MetadataEditedByUser {
	const next = { ...(current ?? {}) }
	for (const field of editableMetadataFields) {
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
		| "abstract"
		| "citationCount"
		| "pages"
		| "volume"
		| "issue"
		| "publisher"
		| "publicationType"
		| "url"
		| "metadataCandidates"
		| "metadataProvenance"
		| "metadataEditedByUser"
	>,
	enrichment: {
		metadata: Partial<EnrichedMetadata> | null
		status: "enriched" | "partial" | "failed" | "skipped"
		sources: string[]
		candidates?: MetadataCandidate[]
		provenance?: MetadataProvenance
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
	const abstract =
		!protectedFields.abstract && metadata.abstract ? metadata.abstract : paper.abstract
	const pages =
		!protectedFields.pages && metadata.pages ? metadata.pages : paper.pages
	const volume =
		!protectedFields.volume && metadata.volume ? metadata.volume : paper.volume
	const issue =
		!protectedFields.issue && metadata.issue ? metadata.issue : paper.issue
	const publisher =
		!protectedFields.publisher && metadata.publisher ? metadata.publisher : paper.publisher
	const publicationType =
		!protectedFields.publicationType && metadata.publicationType
			? metadata.publicationType
			: paper.publicationType
	const citationCount =
		metadata.citationCount != null ? metadata.citationCount : paper.citationCount
	const url = !protectedFields.url && metadata.url ? metadata.url : paper.url

	return {
		title,
		authors,
		year,
		doi,
		arxivId,
		venue,
		abstract,
		citationCount,
		pages,
		volume,
		issue,
		publisher,
		publicationType,
		url,
		metadataCandidates: enrichment.candidates ?? paper.metadataCandidates ?? [],
		metadataProvenance: {
			...(paper.metadataProvenance ?? {}),
			...(enrichment.provenance ?? {}),
		},
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
