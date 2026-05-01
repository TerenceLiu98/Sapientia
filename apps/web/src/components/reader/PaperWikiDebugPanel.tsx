import { useState } from "react"
import { ApiError } from "@/api/client"
import { type PaperWikiPayload, useCompilePaperWiki, usePaperWiki } from "@/api/hooks/papers"

export function PaperWikiDebugPanel({
	paperId,
	workspaceId,
}: {
	paperId: string
	workspaceId: string | undefined
}) {
	const [isOpen, setIsOpen] = useState(false)
	const wikiQuery = usePaperWiki(workspaceId, paperId)
	const compileWiki = useCompilePaperWiki(workspaceId, paperId)

	if (!import.meta.env.DEV || !workspaceId) return null

	const notFound =
		wikiQuery.error instanceof ApiError &&
		wikiQuery.error.status === 404

	return (
		<div className="mb-3 overflow-hidden rounded-lg border border-border-subtle bg-bg-secondary/70 shadow-[var(--shadow-sm)]">
			<div className="flex items-center justify-between gap-3 px-4 py-2">
				<div className="min-w-0">
					<div className="text-[11px] uppercase tracking-[0.18em] text-text-tertiary">
						Paper Wiki Debug
					</div>
					<div className="truncate text-sm text-text-secondary">
						{wikiQuery.data
							? `${wikiQuery.data.concepts.length} concepts · ${wikiQuery.data.edges.length} edges · ${wikiQuery.data.page.referenceBlockIds.length} refs`
							: notFound
								? "No source page yet"
								: wikiQuery.isLoading
									? "Loading…"
									: wikiQuery.error
										? "Load failed"
										: "Ready to inspect"}
					</div>
				</div>
				<div className="flex items-center gap-2">
					<button
						className="rounded-md border border-border-default bg-bg-primary px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
						disabled={compileWiki.isPending}
						onClick={() => {
							void compileWiki.mutateAsync()
						}}
						type="button"
					>
						{compileWiki.isPending ? "Queueing…" : "Recompile"}
					</button>
					<button
						aria-expanded={isOpen}
						className="rounded-md border border-border-default bg-bg-primary px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
						onClick={() => setIsOpen((open) => !open)}
						type="button"
					>
						{isOpen ? "Hide" : "Show"}
					</button>
				</div>
			</div>
			{isOpen ? (
				<div className="grid gap-3 border-t border-border-subtle px-4 py-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.9fr)]">
					<PaperWikiSourceColumn data={wikiQuery.data} error={wikiQuery.error} isLoading={wikiQuery.isLoading} />
					<PaperWikiConceptsColumn data={wikiQuery.data} />
				</div>
			) : null}
		</div>
	)
}

function PaperWikiSourceColumn({
	data,
	error,
	isLoading,
}: {
	data: PaperWikiPayload | undefined
	error: unknown
	isLoading: boolean
}) {
	if (isLoading) {
		return <DebugCard title="Source Page">Loading source page…</DebugCard>
	}
	if (error) {
		return (
			<DebugCard title="Source Page">
				<div className="text-sm text-red-400">
					{error instanceof ApiError
						? `${error.status} ${typeof error.body === "object" && error.body && "error" in (error.body as Record<string, unknown>) ? String((error.body as Record<string, unknown>).error) : error.message}`
						: "Failed to load source page."}
				</div>
			</DebugCard>
		)
	}
	if (!data) {
		return <DebugCard title="Source Page">No source page loaded.</DebugCard>
	}

	return (
		<DebugCard
			meta={`${data.page.status} · ${data.page.promptVersion ?? "unknown prompt"} · ${data.page.modelName ?? "unknown model"}`}
			title={data.page.displayName}
		>
			<pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words text-[12px] leading-6 text-text-primary">
				{data.page.body ?? "(empty body)"}
			</pre>
		</DebugCard>
	)
}

function PaperWikiConceptsColumn({ data }: { data: PaperWikiPayload | undefined }) {
	return (
		<DebugCard
			meta={data ? `${data.concepts.length} local concepts · ${data.edges.length} edges` : undefined}
			title="Local Concepts"
		>
			{!data ? (
				<div className="text-sm text-text-tertiary">No concepts loaded.</div>
			) : data.concepts.length === 0 ? (
				<div className="text-sm text-text-tertiary">No local concepts yet.</div>
			) : (
				<div className="max-h-[28rem] space-y-2 overflow-auto pr-1">
					{data.concepts.map((concept) => (
						<div
							className="rounded-lg border border-border-subtle bg-bg-primary/80 px-3 py-2"
							key={concept.id}
						>
							<div className="flex items-center justify-between gap-2">
								<div className="min-w-0 truncate text-sm font-medium text-text-primary">
									{concept.displayName}
								</div>
								<div className="shrink-0 text-[11px] uppercase tracking-[0.16em] text-text-tertiary">
									{concept.kind}
								</div>
							</div>
							<div className="mt-1 text-[11px] text-text-tertiary">{concept.canonicalName}</div>
							<div className="mt-1 text-[11px] text-text-tertiary">
								score {concept.salienceScore.toFixed(2)} · h {concept.highlightCount} · note {concept.noteCitationCount}
							</div>
							<div className="mt-2 flex flex-wrap gap-1.5">
								{concept.evidence.map((item) => (
									<span
										className="rounded-full border border-border-default bg-bg-secondary px-2 py-0.5 text-[11px] text-text-secondary"
										key={`${concept.id}:${item.blockId}`}
										title={item.snippet ?? item.blockId}
									>
										{item.blockId}
									</span>
								))}
							</div>
						</div>
					))}
					{data.edges.length > 0 ? (
						<div className="pt-2">
							<div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-text-tertiary">
								Inner Graph Edges
							</div>
							<div className="space-y-2">
								{data.edges.map((edge) => {
									const source =
										data.concepts.find((concept) => concept.id === edge.sourceConceptId)
											?.displayName ?? edge.sourceConceptId
									const target =
										data.concepts.find((concept) => concept.id === edge.targetConceptId)
											?.displayName ?? edge.targetConceptId
									return (
										<div
											className="rounded-lg border border-border-subtle bg-bg-primary/80 px-3 py-2"
											key={edge.id}
										>
											<div className="text-sm text-text-primary">
												{source} {"->"} {target}
											</div>
											<div className="mt-1 text-[11px] text-text-tertiary">
												{edge.relationType}
												{edge.confidence != null
													? ` · conf ${edge.confidence.toFixed(2)}`
													: ""}
											</div>
											<div className="mt-2 flex flex-wrap gap-1.5">
												{edge.evidence.map((item) => (
													<span
														className="rounded-full border border-border-default bg-bg-secondary px-2 py-0.5 text-[11px] text-text-secondary"
														key={`${edge.id}:${item.blockId}`}
														title={item.snippet ?? item.blockId}
													>
														{item.blockId}
													</span>
												))}
											</div>
										</div>
									)
								})}
							</div>
						</div>
					) : null}
				</div>
			)}
		</DebugCard>
	)
}

function DebugCard({
	title,
	meta,
	children,
}: {
	title: string
	meta?: string
	children: React.ReactNode
}) {
	return (
		<section className="min-h-0 rounded-lg border border-border-subtle bg-[var(--color-reading-bg)] p-3 shadow-[var(--shadow-xs)]">
			<div className="mb-3 flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="truncate text-sm font-medium text-text-primary">{title}</div>
					{meta ? <div className="mt-1 text-[11px] text-text-tertiary">{meta}</div> : null}
				</div>
			</div>
			{children}
		</section>
	)
}
