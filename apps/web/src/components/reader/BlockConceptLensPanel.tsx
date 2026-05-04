import { useEffect, useState } from "react"
import { usePaperConceptLens } from "@/api/hooks/papers"
import type { PaperBlockConceptLensPayload, PaperWikiConcept } from "@/api/hooks/papers"

interface BlockConceptLensPanelProps {
	blockId: string | null
	blockNumber?: number | null
	noteId?: string | null
	annotationId?: string | null
	paperId: string
	variant?: "default" | "marginalia"
	workspaceId?: string
}

const CONCEPT_PREVIEW_LIMIT = 6
const CANDIDATE_PREVIEW_LIMIT = 5
const RELATED_PAPER_PREVIEW_LIMIT = 4
const NOTE_CONCEPT_PROMPT_VERSION = "note-concept-extract-v1"

export function BlockConceptLensPanel({
	blockId,
	blockNumber,
	noteId,
	annotationId,
	paperId,
	variant = "default",
	workspaceId,
}: BlockConceptLensPanelProps) {
	const lensInput = noteId
		? { noteId }
		: annotationId
			? { annotationId }
			: { blockId }
	const { data, isLoading, isError } = usePaperConceptLens(workspaceId, paperId, lensInput)
	const [isExpanded, setIsExpanded] = useState(variant !== "marginalia")

	useEffect(() => {
		setIsExpanded(variant !== "marginalia")
	}, [variant])

	const hasLensAnchor = Boolean(noteId || annotationId || blockId)
	const heading = noteId
		? "Open note"
		: annotationId
			? "Selected annotation"
			: blockId
				? blockNumber
					? `Block ${blockNumber}`
					: "Selected block"
				: "No block selected"

	if (!hasLensAnchor && variant !== "marginalia") return null

	const concepts = data?.concepts ?? []
	const semanticCandidates = data?.semanticCandidates ?? []
	const relatedPapers = data?.relatedPapers ?? []
	const hasGroundedConcepts = concepts.length > 0
	const conceptPreviewLimit = variant === "marginalia" ? concepts.length : CONCEPT_PREVIEW_LIMIT
	const candidatePreviewLimit =
		variant === "marginalia" ? semanticCandidates.length : CANDIDATE_PREVIEW_LIMIT

	if (variant === "marginalia" && !isExpanded) {
		return (
			<button
				aria-label="Open Concept Lens"
				className="group inline-flex max-w-[calc(100vw-84px)] items-center gap-1.5 rounded-full border border-border-subtle bg-bg-primary/90 px-2 py-1 text-left text-[11px] text-text-secondary shadow-md backdrop-blur transition hover:bg-surface-hover"
				onClick={() => setIsExpanded(true)}
				type="button"
			>
				<span
					className={`h-1.5 w-1.5 shrink-0 rounded-full transition ${
						hasGroundedConcepts
							? "bg-[#005f61] opacity-90 shadow-[0_0_0_3px_rgba(0,95,97,0.12)] group-hover:opacity-100"
							: "bg-text-secondary/35 opacity-70 group-hover:bg-text-secondary/55 group-hover:opacity-90"
					}`}
				/>
				<span className="min-w-0 truncate font-semibold text-text-primary">Concept Lens</span>
			</button>
		)
	}

	return (
		<section
			className={
				variant === "marginalia"
					? "max-h-[min(48vh,400px)] w-[min(360px,calc(100vw-84px))] overflow-y-auto rounded-2xl border border-border-subtle bg-bg-primary/95 p-2.5 shadow-lg backdrop-blur"
					: "mb-3 rounded-2xl border border-border-subtle bg-bg-primary/92 p-3 shadow-sm"
			}
		>
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">
						Concept Lens
					</div>
					<div className="mt-1 text-sm font-semibold text-text-primary">
						{heading}
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

			{!hasLensAnchor ? (
				<div className="mt-3 text-sm text-text-tertiary">
					Select a paper block or open a note to inspect grounded concepts.
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
						<div className="text-xs font-semibold text-text-secondary">In this passage</div>
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
							<div className="text-xs font-semibold text-text-secondary">Across papers</div>
						</div>
						{relatedPapers.length === 0 ? (
							<div className="rounded-xl border border-dashed border-border-subtle bg-bg-secondary/70 p-3 text-sm text-text-tertiary">
								No stable paper connections are grounded here yet.
							</div>
						) : (
							<div className="space-y-2">
								{relatedPapers.slice(0, RELATED_PAPER_PREVIEW_LIMIT).map((item) => (
									<RelatedPaperCard item={item} key={item.id} />
								))}
							</div>
						)}
					</div>

					<div className="space-y-2">
						<div className="flex items-center justify-between gap-2">
							<div className="text-xs font-semibold text-text-secondary">From your notes</div>
						</div>
						{semanticCandidates.length === 0 ? (
							<div className="rounded-xl border border-dashed border-border-subtle bg-bg-secondary/70 p-3 text-sm text-text-tertiary">
								No note-shaped cross-paper hints are linked to this passage yet.
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
				{concept.promptVersion === NOTE_CONCEPT_PROMPT_VERSION ? (
					<span className="rounded-full border border-border-subtle bg-bg-primary px-2 py-0.5 text-[11px] text-text-tertiary">
						reader note
					</span>
				) : null}
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
			{clusterLabel && variant !== "marginalia" ? (
				<div className="mt-2 text-[11px] text-text-tertiary">{clusterLabel}</div>
			) : null}
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
			<div className="text-sm font-semibold text-text-primary">
				{candidate.relatedCluster?.displayName ?? "Related concept"}
			</div>
		</article>
	)
}

function RelatedPaperCard({
	item,
}: {
	item: NonNullable<PaperBlockConceptLensPayload["relatedPapers"]>[number]
}) {
	const evidence = item.strongestEvidence
	const blockId =
		evidence?.otherEvidenceBlockIds?.[0] ??
		evidence?.targetEvidenceBlockIds[0] ??
		evidence?.sourceEvidenceBlockIds[0]
	return (
		<article className="rounded-xl border border-border-subtle bg-bg-secondary/70 p-2.5">
			<div className="text-sm font-semibold leading-5 text-text-primary">
				{item.paper?.title ?? "Related paper"}
			</div>
			{item.paper && blockId ? (
				<a
					className="mt-2 inline-flex rounded-md border border-border-subtle px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
					href={`/papers/${item.paper.paperId}?blockId=${blockId}`}
				>
					Open evidence
				</a>
			) : null}
		</article>
	)
}

function formatKind(kind: PaperWikiConcept["kind"]) {
	return kind.replace(/_/g, " ")
}
