import type { Paper } from "@sapientia/db"
import { enrich, type EnrichmentResult } from "./enrichment/orchestrator"
import type { ExtractedIdentifiers } from "./enrichment/identifier-extractor"
import { deriveTitleSearchCandidate, normalizeTitle } from "./enrichment/utils"

function titlesDiffer(left: string | null | undefined, right: string | null | undefined) {
	if (!left || !right) return true
	return normalizeTitle(left) !== normalizeTitle(right)
}

export async function enrichPaperFromIdentifiers(args: {
	paper: Pick<Paper, "title" | "doi" | "arxivId">
	identifiers?: Partial<ExtractedIdentifiers> | null
	overrideTitle?: string | null
	overrideDoi?: string | null
	overrideArxivId?: string | null
	semanticScholarApiKey?: string | null
}): Promise<EnrichmentResult> {
	const {
		paper,
		identifiers,
		overrideTitle,
		overrideDoi,
		overrideArxivId,
		semanticScholarApiKey,
	} = args

	const fallbackTitle = deriveTitleSearchCandidate(overrideTitle ?? paper.title)
	const primaryTitle =
		deriveTitleSearchCandidate(overrideTitle) ??
		identifiers?.candidateTitle ??
		fallbackTitle

	const primaryIdentifiers: ExtractedIdentifiers = {
		doi: overrideDoi ?? identifiers?.doi ?? paper.doi ?? null,
		arxivId: overrideArxivId ?? identifiers?.arxivId ?? paper.arxivId ?? null,
		candidateTitle: primaryTitle,
		rawHeadText: identifiers?.rawHeadText ?? "",
	}

	if (!primaryIdentifiers.doi && !primaryIdentifiers.arxivId && !primaryIdentifiers.candidateTitle) {
		return { metadata: null, candidates: [], provenance: {}, sources: [], status: "skipped" }
	}

	const primaryResult = await enrich(primaryIdentifiers, { semanticScholarApiKey })
	if (primaryResult.status !== "failed" && primaryResult.status !== "skipped") {
		return primaryResult
	}

	if (!fallbackTitle || !titlesDiffer(primaryIdentifiers.candidateTitle, fallbackTitle)) {
		return primaryResult
	}

	return enrich(
		{
			...primaryIdentifiers,
			candidateTitle: fallbackTitle,
		},
		{ semanticScholarApiKey },
	)
}
