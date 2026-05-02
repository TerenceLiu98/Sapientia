import { useEffect, useState } from "react"
import { usePaperBlockConceptLens } from "@/api/hooks/papers"
import type { PaperBlockConceptLensPayload, PaperWikiConcept } from "@/api/hooks/papers"

interface BlockConceptLensPanelProps {
	blockId: string | null
	blockNumber?: number | null
	paperId: string
	variant?: "default" | "marginalia"
	workspaceId?: string
}

const CONCEPT_PREVIEW_LIMIT = 6
const CANDIDATE_PREVIEW_LIMIT = 5

export function BlockConceptLensPanel({
	blockId,
	blockNumber,
	paperId,
	variant = "default",
	workspaceId,
}: BlockConceptLensPanelProps) {
	const { data, isLoading, isError } = usePaperBlockConceptLens(workspaceId, paperId, blockId)
	const [isExpanded, setIsExpanded] = useState(variant !== "marginalia")

	useEffect(() => {
		setIsExpanded(variant !== "marginalia")
	}, [variant])

	if (!blockId && variant !== "marginalia") return null

	const concepts = data?.concepts ?? []
	const semanticCandidates = data?.semanticCandidates ?? []
	const conceptPreviewLimit = variant === "marginalia" ? concepts.length : CONCEPT_PREVIEW_LIMIT
	const candidatePreviewLimit =
		variant === "marginalia" ? semanticCandidates.length : CANDIDATE_PREVIEW_LIMIT
	const hasRelatedCandidates = semanticCandidates.length > 0

	if (variant === "marginalia" && !isExpanded) {
		return (
			<button
				aria-label="Open Concept Lens"
				className="group flex w-[272px] max-w-[calc(100vw-84px)] items-center gap-2 rounded-full border border-border-subtle bg-bg-primary/95 px-2.5 py-1.5 text-left text-xs text-text-secondary shadow-md backdrop-blur transition hover:bg-surface-hover"
				onClick={() => setIsExpanded(true)}
				type="button"
			>
				<span className="h-2 w-2 shrink-0 rounded-full bg-text-secondary/55 transition group-hover:bg-text-primary" />
				<span className="min-w-0 truncate font-semibold text-text-primary">Concept Lens</span>
				<span className="shrink-0 text-text-tertiary">
					{!blockId
						? "select block"
						: isLoading
							? "loading"
							: `${concepts.length} concept${concepts.length === 1 ? "" : "s"}${
									hasRelatedCandidates ? ` · ${semanticCandidates.length} related` : ""
								}`}
				</span>
			</button>
		)
	}

	return (
		<section
			className={
				variant === "marginalia"
					? "max-h-[min(54vh,460px)] w-[min(460px,calc(100vw-84px))] overflow-y-auto rounded-2xl border border-border-subtle bg-bg-primary/95 p-2.5 shadow-lg backdrop-blur"
					: "mb-3 rounded-2xl border border-border-subtle bg-bg-primary/92 p-3 shadow-sm"
			}
		>
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">
						Concept Lens
					</div>
					<div className="mt-1 text-sm font-semibold text-text-primary">
						{blockId
							? blockNumber
								? `Block ${blockNumber}`
								: "Selected block"
							: "No block selected"}
					</div>
				</div>
				{variant === "marginalia" ? (
					<button
						className="rounded-full border border-border-subtle px-2 py-0.5 text-[11px] text-text-tertiary transition hover:bg-surface-hover"
						onClick={() => setIsExpanded(false)}
						type="button"
					>
						Close
					</button>
				) : (
					<div className="rounded-full border border-border-subtle bg-bg-secondary px-2 py-0.5 text-[11px] text-text-tertiary">
						Evidence-linked
					</div>
				)}
			</div>

			{!blockId ? (
				<div className="mt-3 text-sm text-text-tertiary">
					Select a paper block to inspect its grounded concepts.
				</div>
			) : isLoading ? (
				<div className="mt-3 text-sm text-text-tertiary">Loading concepts for this block…</div>
			) : isError ? (
				<div className="mt-3 text-sm text-text-tertiary">
					Concepts are not ready for this block yet.
				</div>
			) : concepts.length === 0 ? (
				<div className="mt-3 text-sm text-text-tertiary">
					No public concepts are grounded to this block yet.
				</div>
			) : (
				<div
					className={
						variant === "marginalia"
							? "mt-3 space-y-3"
							: "mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.72fr)]"
					}
				>
					<div className="space-y-2">
						<div className="text-xs font-semibold text-text-secondary">Concepts in this block</div>
						<div
							className={
								variant === "marginalia"
									? "space-y-2"
									: "grid gap-2 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2"
							}
						>
							{concepts.slice(0, conceptPreviewLimit).map((concept) => (
								<ConceptCard concept={concept} key={concept.id} variant={variant} />
							))}
						</div>
						{variant !== "marginalia" && concepts.length > conceptPreviewLimit ? (
							<div className="text-xs text-text-tertiary">
								+{concepts.length - conceptPreviewLimit} more concepts grounded here.
							</div>
						) : null}
					</div>

					<div className="space-y-2">
						<div className="flex items-center justify-between gap-2">
							<div className="text-xs font-semibold text-text-secondary">Related concept hints</div>
							{semanticCandidates.length > 0 ? (
								<div className="text-[11px] text-text-tertiary">
									{semanticCandidates.length} related
								</div>
							) : null}
						</div>
						{semanticCandidates.length === 0 ? (
							<div className="rounded-xl border border-dashed border-border-subtle bg-bg-secondary/70 p-3 text-sm text-text-tertiary">
								No nearby cross-paper concepts are linked to this block yet.
							</div>
						) : (
							<div className="space-y-2">
								{semanticCandidates.slice(0, candidatePreviewLimit).map((candidate) => (
									<CandidateCard candidate={candidate} key={candidate.id} />
								))}
								{variant !== "marginalia" && semanticCandidates.length > candidatePreviewLimit ? (
									<div className="text-xs text-text-tertiary">
										+{semanticCandidates.length - candidatePreviewLimit} more related hints in
										graph.
									</div>
								) : null}
							</div>
						)}
					</div>
				</div>
			)}
		</section>
	)
}

function ConceptCard({
	concept,
	variant,
}: {
	concept: PaperBlockConceptLensPayload["concepts"][number]
	variant: "default" | "marginalia"
}) {
	const clusterLabel = concept.cluster?.displayName ?? concept.cluster?.canonicalName ?? null
	return (
		<article className="rounded-xl border border-border-subtle bg-bg-secondary/70 p-2.5">
			<div className="flex flex-wrap items-center gap-2">
				<span className="rounded-full bg-bg-primary px-2 py-0.5 text-[11px] font-medium text-text-secondary">
					{formatKind(concept.kind)}
				</span>
				<span className="text-sm font-semibold leading-5 text-text-primary">
					{concept.displayName}
				</span>
			</div>
			<p
				className={`mt-2 text-sm leading-5 text-text-secondary ${
					variant === "marginalia" ? "line-clamp-2" : "line-clamp-3"
				}`}
			>
				{concept.sourceLevelDescription ??
					(concept.sourceLevelDescriptionStatus === "done"
						? "No source-level description was generated."
						: "Source-level description is still forming.")}
			</p>
			{concept.readerSignalSummary ? (
				<p className="mt-2 line-clamp-2 text-xs leading-5 text-text-tertiary">
					{concept.readerSignalSummary}
				</p>
			) : null}
			<div className="mt-2 flex flex-wrap gap-2 text-[11px] text-text-tertiary">
				<span>{formatScore(concept.salienceScore)} salience</span>
				{concept.evidence.confidence != null ? (
					<span>{formatScore(concept.evidence.confidence)} evidence</span>
				) : null}
				{clusterLabel && variant !== "marginalia" ? <span>Cluster: {clusterLabel}</span> : null}
			</div>
		</article>
	)
}

function CandidateCard({
	candidate,
}: {
	candidate: PaperBlockConceptLensPayload["semanticCandidates"][number]
}) {
	return (
		<article className="rounded-xl border border-border-subtle bg-bg-secondary/70 p-3">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<div className="text-sm font-semibold text-text-primary">
						{candidate.relatedCluster?.displayName ?? "Related concept"}
					</div>
					<div className="mt-1 text-[11px] text-text-tertiary">
						{formatKind(candidate.kind)} · {formatCandidateStatus(candidate.decisionStatus)}
						{candidate.llmDecision ? ` · LLM: ${candidate.llmDecision}` : ""}
						{candidate.llmConfidence != null
							? ` · confidence ${formatScore(candidate.llmConfidence)}`
							: ""}
					</div>
				</div>
				<span className="rounded-full bg-bg-primary px-2 py-0.5 text-[11px] text-text-secondary">
					{formatScore(candidate.similarityScore)}
				</span>
			</div>
			{candidate.rationale ? (
				<p className="mt-2 line-clamp-2 text-xs leading-5 text-text-secondary">
					{candidate.rationale}
				</p>
			) : null}
		</article>
	)
}

function formatKind(kind: PaperWikiConcept["kind"]) {
	return kind.replace(/_/g, " ")
}

function formatScore(score: number | null) {
	if (score == null) return "n/a"
	return `${Math.round(score * 100)}%`
}

function formatCandidateStatus(
	status: PaperBlockConceptLensPayload["semanticCandidates"][number]["decisionStatus"],
) {
	if (status === "candidate" || status === "needs_review") return "AI linked"
	if (status === "ai_confirmed") return "AI confirmed"
	if (status === "ai_rejected") return "AI rejected"
	if (status === "user_accepted") return "manually kept"
	if (status === "user_rejected") return "manually hidden"
	if (status === "auto_accepted") return "AI linked"
	return status.replace(/_/g, " ")
}
