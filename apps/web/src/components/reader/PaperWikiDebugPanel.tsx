import cytoscape, { type Core, type ElementDefinition } from "cytoscape"
import { useEffect, useRef, useState } from "react"
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
							? `${wikiQuery.data.concepts.length} concepts · ${wikiQuery.data.innerGraph.edgeCount} edges · ${wikiQuery.data.page.referenceBlockIds.length} refs`
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
			meta={data ? `${data.concepts.length} local concepts · ${data.innerGraph.edgeCount} edges` : undefined}
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
					{data.innerGraph.edgeCount > 0 ? (
						<div className="pt-2">
							<div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-text-tertiary">
								Inner Graph Edges
							</div>
							<InnerGraphPreview data={data} />
							<RelationCounts counts={data.innerGraph.relationCounts} />
							<div className="space-y-2">
								{data.innerGraph.edges.map((edge) => {
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
														className="rounded-md border border-border-default bg-bg-secondary px-2 py-1 text-[11px] text-text-secondary"
														key={`${edge.id}:${item.blockId}`}
														title={item.snippet ?? item.blockId}
													>
														{item.blockId}
														{item.snippet ? (
															<span className="ml-1 text-text-tertiary">
																{truncateSnippet(item.snippet)}
															</span>
														) : null}
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

function InnerGraphPreview({ data }: { data: PaperWikiPayload }) {
	const containerRef = useRef<HTMLDivElement | null>(null)

	useEffect(() => {
		const container = containerRef.current
		if (!container || data.innerGraph.edges.length === 0) return undefined

		const elements = buildGraphElements(data)
		const computedStyle = getComputedStyle(document.documentElement)
		const textPrimary = cssVar(computedStyle, "--color-text-primary", "#2f2a24")
		const textSecondary = cssVar(computedStyle, "--color-text-secondary", "#5f574e")
		const nodeConcept = cssVar(computedStyle, "--graph-node-concept", "#2f7f8f")
		const nodeSource = cssVar(computedStyle, "--graph-node-source", "#7f7a72")
		const edgeDefault = cssVar(computedStyle, "--graph-edge-default", "rgba(100, 92, 82, 0.45)")

		const cy: Core = cytoscape({
			container,
			elements,
			style: [
				{
					selector: "node",
					style: {
						"background-color": nodeConcept,
						"border-color": "rgba(255,255,255,0.82)",
						"border-width": "1px",
						color: textPrimary,
						content: "data(label)",
						"font-size": "10px",
						"text-background-color": "rgba(255,255,255,0.72)",
						"text-background-opacity": 1,
						"text-background-padding": "2px",
						"text-max-width": "92px",
						"text-valign": "bottom",
						"text-wrap": "wrap",
						height: "mapData(weight, 0, 5, 20, 38)",
						width: "mapData(weight, 0, 5, 20, 38)",
					},
				},
				{
					selector: 'node[kind = "method"]',
					style: { "background-color": "#8b6f47" },
				},
				{
					selector: 'node[kind = "task"]',
					style: { "background-color": "#9a624f" },
				},
				{
					selector: 'node[kind = "metric"]',
					style: { "background-color": nodeSource },
				},
				{
					selector: "edge",
					style: {
						color: textSecondary,
						content: "data(label)",
						"curve-style": "bezier",
						"font-size": "8px",
						"line-color": edgeDefault,
						"target-arrow-color": edgeDefault,
						"target-arrow-shape": "triangle",
						"text-background-color": "rgba(255,255,255,0.72)",
						"text-background-opacity": 1,
						"text-background-padding": "1px",
						width: "mapData(confidence, 0, 1, 1, 3)",
					},
				},
			],
			layout: {
				name: "cose",
				animate: false,
				fit: true,
				padding: 24,
			},
			minZoom: 0.45,
			maxZoom: 2.5,
			wheelSensitivity: 0.25,
		})

		return () => {
			cy.destroy()
		}
	}, [data])

	return (
		<div className="mb-2 overflow-hidden rounded-lg border border-border-subtle bg-bg-primary/80">
			<div
				aria-label="Inner paper concept graph preview"
				className="h-64 w-full"
				ref={containerRef}
			/>
		</div>
	)
}

function buildGraphElements(data: PaperWikiPayload): ElementDefinition[] {
	const connectedConceptIds = new Set<string>()
	for (const edge of data.innerGraph.edges) {
		connectedConceptIds.add(edge.sourceConceptId)
		connectedConceptIds.add(edge.targetConceptId)
	}

	const nodeWeights = new Map<string, number>()
	for (const edge of data.innerGraph.edges) {
		nodeWeights.set(edge.sourceConceptId, (nodeWeights.get(edge.sourceConceptId) ?? 0) + 1)
		nodeWeights.set(edge.targetConceptId, (nodeWeights.get(edge.targetConceptId) ?? 0) + 1)
	}

	const nodes: ElementDefinition[] = data.concepts
		.filter((concept) => connectedConceptIds.has(concept.id))
		.map((concept) => ({
			data: {
				id: concept.id,
				label: concept.displayName,
				kind: concept.kind,
				weight: nodeWeights.get(concept.id) ?? 0,
			},
		}))

	const edges: ElementDefinition[] = data.innerGraph.edges.map((edge) => ({
		data: {
			id: edge.id,
			source: edge.sourceConceptId,
			target: edge.targetConceptId,
			label: edge.relationType,
			confidence: edge.confidence ?? 0.5,
		},
	}))

	return [...nodes, ...edges]
}

function cssVar(style: CSSStyleDeclaration, name: string, fallback: string) {
	const value = style.getPropertyValue(name).trim()
	return value || fallback
}

function RelationCounts({
	counts,
}: {
	counts: PaperWikiPayload["innerGraph"]["relationCounts"]
}) {
	const entries = Object.entries(counts).filter(([, count]) => (count ?? 0) > 0)
	if (entries.length === 0) return null

	return (
		<div className="mb-2 flex flex-wrap gap-1.5">
			{entries.map(([relationType, count]) => (
				<span
					className="rounded-full border border-border-default bg-bg-secondary px-2 py-0.5 text-[11px] text-text-secondary"
					key={relationType}
				>
					{relationType} {count}
				</span>
			))}
		</div>
	)
}

function truncateSnippet(snippet: string) {
	const normalized = snippet.trim().replace(/\s+/g, " ")
	if (normalized.length <= 72) return normalized
	return `${normalized.slice(0, 69)}...`
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
