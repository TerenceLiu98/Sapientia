import { Link } from "@tanstack/react-router"
import {
	forceCenter,
	forceCollide,
	forceLink,
	forceManyBody,
	forceSimulation,
	type SimulationLinkDatum,
	type SimulationNodeDatum,
} from "d3-force"
import Graph from "graphology"
import { useEffect, useMemo, useRef, useState } from "react"
import Sigma from "sigma"
import {
	type ConceptGraphPayload,
	type PaperGraphPayload,
	useWorkspaceGraph,
	type WorkspaceGraphPayload,
} from "@/api/hooks/graph"
import type { Workspace } from "@/api/hooks/workspaces"

type Selection = { kind: "node"; id: string } | { kind: "edge"; id: string } | null
type SigmaNodeAttributes = {
	x: number
	y: number
	size: number
	label: string
	color: string
	baseColor: string
	kind: string
	weight: number
	forceLabel?: boolean
	zIndex?: number
}
type SigmaEdgeAttributes = {
	size: number
	label: string
	color: string
	baseColor: string
	relationType: string
	confidence: number
	zIndex?: number
}
type ConceptGraph = Graph<SigmaNodeAttributes, SigmaEdgeAttributes>

export function WorkspaceGraphView({ workspace }: { workspace: Workspace | undefined }) {
	const [selection, setSelection] = useState<Selection>(null)
	const graphQuery = useWorkspaceGraph(workspace?.id, "papers")
	const data = graphQuery.data

	if (!workspace) {
		return <div className="p-8 text-sm text-text-tertiary">Loading workspace…</div>
	}

	if (graphQuery.isLoading) {
		return <div className="p-8 text-sm text-text-tertiary">Loading graph…</div>
	}

	if (!data || data.graph.nodeCount < 2) {
		return (
			<div className="flex h-full min-h-[28rem] items-center justify-center p-8">
				<div className="max-w-md rounded-2xl border border-border-subtle bg-bg-secondary p-6 text-center shadow-[var(--shadow-sm)]">
					<div className="text-sm font-medium text-text-primary">Your graph is still forming.</div>
					<p className="mt-2 text-sm leading-6 text-text-secondary">
						Read and compile a few papers first. Sapientia will connect papers here once there is
						enough concept evidence.
					</p>
				</div>
			</div>
		)
	}

	return (
		<div className="grid h-full min-h-0 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
			<section className="min-h-0 overflow-hidden rounded-2xl border border-border-subtle bg-[var(--color-reading-bg)] shadow-[var(--shadow-sm)]">
				<div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
					<div>
						<div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">
							Paper Relationship Map
						</div>
						<div className="mt-1 text-sm text-text-secondary">
							{data.graph.nodeCount} {data.view === "papers" ? "papers" : "concepts"} ·{" "}
							{data.graph.edgeCount} links
						</div>
					</div>
				</div>
				<WorkspaceGraphCanvas data={data} selection={selection} onSelect={setSelection} />
			</section>
			<WorkspaceGraphInspector data={data} selection={selection} onSelect={setSelection} />
		</div>
	)
}

function WorkspaceGraphCanvas({
	data,
	selection,
	onSelect,
}: {
	data: WorkspaceGraphPayload
	selection: Selection
	onSelect: (selection: Selection) => void
}) {
	const containerRef = useRef<HTMLDivElement | null>(null)
	const rendererRef = useRef<Sigma<SigmaNodeAttributes, SigmaEdgeAttributes> | null>(null)
	const selectionRef = useRef<Selection>(selection)
	const draggedNodeRef = useRef<string | null>(null)

	useEffect(() => {
		selectionRef.current = selection
		rendererRef.current?.refresh()
	}, [selection])

	useEffect(() => {
		const container = containerRef.current
		if (!container) return undefined

		const computedStyle = getComputedStyle(document.documentElement)
		const textPrimary = cssColorVar("--color-text-primary", "#2f2a24")
		const edgeDefault = cssColorVar("--graph-edge-default", "rgba(100, 92, 82, 0.45)")
		const edgeActive = cssColorVar("--graph-edge-active", "#2f7f8f")
		const edgeMinWidth = cssNumberVar(computedStyle, "--graph-edge-width-min", 0.5)
		const edgeMaxWidth = cssNumberVar(computedStyle, "--graph-edge-width-max", 3)
		const nodeMinRadius = cssNumberVar(computedStyle, "--graph-node-radius-min", 4)
		const nodeMaxRadius = cssNumberVar(computedStyle, "--graph-node-radius-max", 16)
		const colors = {
			paper: cssColorVar("--graph-node-source", "#7f7a72"),
			concept: cssColorVar("--graph-node-concept", "#2f7f8f"),
			method: cssColorVar("--graph-node-method", "#4f8f68"),
			task: cssColorVar("--graph-node-task", "#a67a36"),
			metric: cssColorVar("--graph-node-metric", "#9a4f43"),
			entity: cssColorVar("--graph-node-entity", "#9a624f"),
			fallback: cssColorVar("--graph-node-source", "#7f7a72"),
			edgeDefault,
			edgeActive,
		}

		const graph = buildSigmaGraph(data, colors, {
			edgeMinWidth,
			edgeMaxWidth,
			nodeMinRadius,
			nodeMaxRadius,
		})
		const renderer = new Sigma<SigmaNodeAttributes, SigmaEdgeAttributes>(graph, container, {
			allowInvalidContainer: true,
			autoCenter: true,
			autoRescale: true,
			enableEdgeEvents: true,
			labelColor: { color: textPrimary },
			labelDensity: 0,
			labelRenderedSizeThreshold: 999,
			labelSize: cssNumberVar(computedStyle, "--graph-label-font-size", 12),
			renderEdgeLabels: false,
			stagePadding: 40,
			zIndex: true,
			nodeReducer: (node, attributes) => {
				const currentSelection = selectionRef.current
				if (currentSelection?.kind !== "node") return attributes
				if (currentSelection.id === node) {
					return {
						...attributes,
						color: attributes.baseColor,
						forceLabel: false,
						size: Math.min(attributes.size * 1.28, nodeMaxRadius + 3),
						zIndex: 4,
					}
				}
				return {
					...attributes,
					color: attributes.baseColor,
					forceLabel: false,
					size: Math.max(attributes.size * 0.92, nodeMinRadius),
					zIndex: 1,
				}
			},
			edgeReducer: (edge, attributes) => {
				const currentSelection = selectionRef.current
				if (!currentSelection) return attributes
				if (currentSelection.kind === "edge" && currentSelection.id === edge) {
					return {
						...attributes,
						color: edgeActive,
						size: Math.min(Math.max(attributes.size * 1.6, edgeMinWidth + 1.5), edgeMaxWidth + 1.4),
						zIndex: 4,
					}
				}
				if (currentSelection.kind === "node") {
					const [source, target] = graph.extremities(edge)
					if (source === currentSelection.id || target === currentSelection.id) {
						return {
							...attributes,
							color: edgeActive,
							size: Math.min(Math.max(attributes.size * 1.28, edgeMinWidth + 0.7), edgeMaxWidth + 0.8),
							zIndex: 3,
						}
					}
				}
				return {
					...attributes,
					color: attributes.baseColor,
					size: Math.max(attributes.size * 0.82, edgeMinWidth),
					zIndex: 1,
				}
			},
		})

		const mouseCaptor = renderer.getMouseCaptor()
		renderer.on("clickNode", ({ node }) => onSelect({ kind: "node", id: node }))
		renderer.on("clickEdge", ({ edge }) => onSelect({ kind: "edge", id: edge }))
		renderer.on("clickStage", () => onSelect(null))
		renderer.on("downNode", (event) => {
			draggedNodeRef.current = event.node
			container.style.cursor = "grabbing"
			event.preventSigmaDefault()
		})
		mouseCaptor.on("mousemovebody", (event) => {
			const draggedNode = draggedNodeRef.current
			if (!draggedNode) return
			const position = renderer.viewportToGraph(event)
			graph.setNodeAttribute(draggedNode, "x", position.x)
			graph.setNodeAttribute(draggedNode, "y", position.y)
			event.preventSigmaDefault()
			event.original.preventDefault()
			event.original.stopPropagation()
		})
		mouseCaptor.on("mouseup", () => {
			if (!draggedNodeRef.current) return
			draggedNodeRef.current = null
			container.style.cursor = ""
		})
		mouseCaptor.on("mouseleave", () => {
			if (!draggedNodeRef.current) return
			draggedNodeRef.current = null
			container.style.cursor = ""
		})

		rendererRef.current = renderer

		return () => {
			draggedNodeRef.current = null
			renderer.kill()
			rendererRef.current = null
		}
	}, [data, onSelect])

	return (
		<div
			aria-label="Workspace graph"
			className="h-full min-h-[34rem]"
			ref={containerRef}
			role="img"
		/>
	)
}

function WorkspaceGraphInspector(props: {
	data: WorkspaceGraphPayload
	selection: Selection
	onSelect: (selection: Selection) => void
}) {
	if (props.data.view === "papers") {
		return (
			<PaperGraphInspector
				data={props.data}
				selection={props.selection}
				onSelect={props.onSelect}
			/>
		)
	}
	return <ConceptGraphInspector {...props} data={props.data} />
}

function ConceptGraphInspector({
	data,
	selection,
	onSelect,
}: {
	data: ConceptGraphPayload
	selection: Selection
	onSelect: (selection: Selection) => void
}) {
	const selectedNode =
		selection?.kind === "node" ? data.graph.nodes.find((node) => node.id === selection.id) : null
	const nodesById = useMemo(
		() => new Map(data.graph.nodes.map((node) => [node.id, node] as const)),
		[data.graph.nodes],
	)
	const selectedCandidates = useMemo(() => {
		if (!selectedNode) return []
		return data.graph.semanticCandidates
			.filter(
				(candidate) => candidate.source === selectedNode.id || candidate.target === selectedNode.id,
			)
			.sort((a, b) => (b.similarityScore ?? 0) - (a.similarityScore ?? 0))
			.slice(0, 6)
	}, [data.graph.semanticCandidates, selectedNode])
	const visibleCandidates = selectedNode
		? selectedCandidates
		: [...data.graph.semanticCandidates]
				.sort((a, b) => (b.similarityScore ?? 0) - (a.similarityScore ?? 0))
				.slice(0, 6)
	const topNodes = useMemo(
		() =>
			[...data.graph.nodes]
				.sort((a, b) => b.degree + b.salienceScore - (a.degree + a.salienceScore))
				.slice(0, 12),
		[data.graph.nodes],
	)

	return (
		<aside className="min-h-0 overflow-auto rounded-2xl border border-border-subtle bg-bg-secondary p-4 shadow-[var(--shadow-sm)]">
			<div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">Inspector</div>
			{selectedNode ? (
				<div className="mt-3 rounded-xl border border-border-subtle bg-bg-primary p-3">
					<div className="text-sm font-medium text-text-primary">{selectedNode.label}</div>
					<div className="mt-1 text-xs text-text-tertiary">
						{selectedNode.kind} · {selectedNode.paperCount} papers · {selectedNode.memberCount}{" "}
						local concepts
					</div>
					<div className="mt-3 space-y-2">
						{selectedNode.members.slice(0, 5).map((member) => (
							<Link
								className="block rounded-md border border-border-subtle bg-bg-secondary px-2.5 py-2 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary"
								key={member.localConceptId}
								params={{ paperId: member.paperId }}
								search={{ blockId: undefined }}
								to="/papers/$paperId"
							>
								<span className="block truncate font-medium text-text-primary">
									{member.paperTitle ?? "Untitled paper"}
								</span>
								<span className="mt-0.5 block truncate">{member.displayName}</span>
								{member.sourceLevelDescription ? (
									<span className="mt-1 line-clamp-2 block leading-5 text-text-secondary">
										{member.sourceLevelDescription}
									</span>
								) : null}
								{member.readerSignalSummary ? (
									<span className="mt-1 line-clamp-2 block text-[11px] leading-4 text-text-tertiary">
										{member.readerSignalSummary}
									</span>
								) : null}
							</Link>
						))}
					</div>
				</div>
			) : (
				<p className="mt-3 text-sm leading-6 text-text-secondary">
					Select a concept to open its source paper. The graph is still evidence-first: structure
					helps you return to reading, not replace it.
				</p>
			)}
			{data.graph.semanticCandidates.length > 0 ? (
				<div className="mt-5">
					<div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">
						Related Concept Hints
					</div>
					{selectedNode && visibleCandidates.length === 0 ? (
						<p className="mt-2 rounded-lg border border-border-subtle bg-bg-primary px-3 py-2 text-xs leading-5 text-text-secondary">
							No related concept hints for this concept yet. Workspace-level hints still exist;
							select another concept to inspect the current matches.
						</p>
					) : null}
					<div className="mt-2 space-y-2">
						<div className="rounded-lg border border-border-subtle bg-bg-primary px-3 py-2 text-xs text-text-secondary">
							{data.graph.semanticCandidateCounts.generated} recalled ·{" "}
							{data.graph.semanticCandidateCounts.userAccepted} AI confirmed ·{" "}
							{data.graph.semanticCandidateCounts.userRejected} AI rejected
						</div>
						{visibleCandidates.map((candidate) => (
							<SimilarConceptCandidateButton
								candidate={candidate}
								key={candidate.id}
								nodesById={nodesById}
								onSelect={onSelect}
								selectedNodeId={selectedNode?.id ?? null}
							/>
						))}
					</div>
				</div>
			) : null}
			<div className="mt-5 text-xs uppercase tracking-[0.18em] text-text-tertiary">
				Top Concepts
			</div>
			<div className="mt-2 space-y-2">
				{topNodes.map((node) => (
					<button
						className="block w-full rounded-lg border border-border-subtle bg-bg-primary px-3 py-2 text-left transition-colors hover:bg-surface-hover"
						key={node.id}
						onClick={() => onSelect({ kind: "node", id: node.id })}
						type="button"
					>
						<span className="block truncate text-sm font-medium text-text-primary">
							{node.label}
						</span>
						<span className="mt-0.5 block truncate text-xs text-text-tertiary">
							{node.kind} · {node.paperCount} papers · degree {node.degree}
						</span>
					</button>
				))}
			</div>
		</aside>
	)
}

function PaperGraphInspector({
	data,
	selection,
	onSelect,
}: {
	data: PaperGraphPayload
	selection: Selection
	onSelect: (selection: Selection) => void
}) {
	const selectedNode =
		selection?.kind === "node" ? data.graph.nodes.find((node) => node.id === selection.id) : null
	const selectedEdge =
		selection?.kind === "edge" ? data.graph.edges.find((edge) => edge.id === selection.id) : null
	const papersById = useMemo(
		() => new Map(data.graph.nodes.map((node) => [node.id, node] as const)),
		[data.graph.nodes],
	)
	const selectedNodeEdges = useMemo(() => {
		if (!selectedNode) return []
		return data.graph.edges
			.filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id)
			.sort((a, b) => b.weight - a.weight)
			.slice(0, 5)
	}, [data.graph.edges, selectedNode])
	const topPapers = useMemo(
		() =>
			[...data.graph.nodes]
				.sort((a, b) => b.degree + b.conceptCount / 10 - (a.degree + a.conceptCount / 10))
				.slice(0, 12),
		[data.graph.nodes],
	)
	const topEdges = useMemo(
		() => [...data.graph.edges].sort((a, b) => b.weight - a.weight).slice(0, 8),
		[data.graph.edges],
	)

	return (
		<aside className="min-h-0 overflow-auto rounded-2xl border border-border-subtle bg-bg-secondary p-4 shadow-[var(--shadow-sm)]">
			<div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">Paper Map</div>
			{selectedEdge ? (
				<PaperEdgeCard edge={selectedEdge} papersById={papersById} onSelect={onSelect} />
			) : selectedNode ? (
				<div className="mt-3 rounded-xl border border-border-subtle bg-bg-primary p-3">
					<div className="text-sm font-medium text-text-primary">{selectedNode.title}</div>
					<div className="mt-1 text-xs text-text-tertiary">
						{selectedNode.year ?? "n.d."}
						{selectedNode.venue ? ` · ${selectedNode.venue}` : ""} · {selectedNode.conceptCount}{" "}
						concepts · degree {selectedNode.degree}
					</div>
					<Link
						className="mt-3 inline-flex rounded-full border border-border-subtle px-3 py-1 text-xs font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary"
						params={{ paperId: selectedNode.paperId }}
						search={{ blockId: undefined }}
						to="/papers/$paperId"
					>
						Open paper
					</Link>
					{selectedNode.topConcepts.length > 0 ? (
						<div className="mt-3 space-y-1.5">
							<div className="text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
								Top Concepts
							</div>
							{selectedNode.topConcepts.map((concept) => (
								<div
									className="rounded-md border border-border-subtle bg-bg-secondary px-2.5 py-1.5 text-xs text-text-secondary"
									key={concept.id}
								>
									<span className="font-medium text-text-primary">{concept.displayName}</span>
									<span className="text-text-tertiary"> · {concept.kind}</span>
								</div>
							))}
						</div>
					) : null}
					{selectedNodeEdges.length > 0 ? (
						<div className="mt-4 space-y-2">
							<div className="text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
								Connected Papers
							</div>
							{selectedNodeEdges.map((edge) => (
								<PaperNodeConnectionButton
									edge={edge}
									key={edge.id}
									onSelect={onSelect}
									papersById={papersById}
									selectedPaperId={selectedNode.id}
								/>
							))}
						</div>
					) : (
						<p className="mt-4 rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2 text-xs leading-5 text-text-secondary">
							No confirmed paper links yet. Sapientia will add links when concept evidence is
							strong enough.
						</p>
					)}
				</div>
			) : (
				<p className="mt-3 text-sm leading-6 text-text-secondary">
					Select a paper or connection. This map shows paper relationships inferred from
					AI-confirmed concept evidence, so it helps you decide what to read next without asking
					you to curate the graph.
				</p>
			)}
			<div className="mt-5 text-xs uppercase tracking-[0.18em] text-text-tertiary">
				Strong Connections
			</div>
			<div className="mt-2 space-y-2">
				{topEdges.map((edge) => (
					<PaperEdgeButton edge={edge} key={edge.id} onSelect={onSelect} papersById={papersById} />
				))}
			</div>
			<div className="mt-5 text-xs uppercase tracking-[0.18em] text-text-tertiary">Top Papers</div>
			<div className="mt-2 space-y-2">
				{topPapers.map((paper) => (
					<button
						className="block w-full rounded-lg border border-border-subtle bg-bg-primary px-3 py-2 text-left transition-colors hover:bg-surface-hover"
						key={paper.id}
						onClick={() => onSelect({ kind: "node", id: paper.id })}
						type="button"
					>
						<span className="block truncate text-sm font-medium text-text-primary">
							{paper.title}
						</span>
						<span className="mt-0.5 block truncate text-xs text-text-tertiary">
							{paper.conceptCount} concepts · degree {paper.degree}
						</span>
					</button>
				))}
			</div>
		</aside>
	)
}

function PaperNodeConnectionButton({
	edge,
	papersById,
	selectedPaperId,
	onSelect,
}: {
	edge: PaperGraphPayload["graph"]["edges"][number]
	papersById: Map<string, PaperGraphPayload["graph"]["nodes"][number]>
	selectedPaperId: string
	onSelect: (selection: Selection) => void
}) {
	const otherPaperId = edge.source === selectedPaperId ? edge.target : edge.source
	const otherPaper = papersById.get(otherPaperId)
	const strongestEvidence = edge.topEvidence[0]
	return (
		<button
			className="block w-full rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2 text-left text-xs transition-colors hover:bg-surface-hover"
			onClick={() => onSelect({ kind: "edge", id: edge.id })}
			type="button"
		>
			<span className="block truncate font-medium text-text-primary">
				{otherPaper?.title ?? "Connected paper"}
			</span>
			<span className="mt-0.5 block text-text-tertiary">
				{formatPaperEdgeKind(edge.edgeKind)} · strength {formatPercent(edge.weight)}
			</span>
			{strongestEvidence ? (
				<span className="mt-1 line-clamp-2 block leading-5 text-text-secondary">
					via {strongestEvidence.sourceConceptName} ↔ {strongestEvidence.targetConceptName}
				</span>
			) : null}
		</button>
	)
}

function PaperEdgeButton({
	edge,
	papersById,
	onSelect,
}: {
	edge: PaperGraphPayload["graph"]["edges"][number]
	papersById: Map<string, PaperGraphPayload["graph"]["nodes"][number]>
	onSelect: (selection: Selection) => void
}) {
	const source = papersById.get(edge.source)
	const target = papersById.get(edge.target)
	return (
		<button
			className="block w-full rounded-lg border border-dashed border-border-subtle bg-bg-primary px-3 py-2 text-left text-xs transition-colors hover:bg-surface-hover"
			onClick={() => onSelect({ kind: "edge", id: edge.id })}
			type="button"
		>
			<span className="block truncate font-medium text-text-primary">
				{source?.title ?? "Paper"} ↔ {target?.title ?? "Paper"}
			</span>
			<span className="mt-1 block text-text-tertiary">
				{formatPaperEdgeKind(edge.edgeKind)} · {edge.evidenceCount} evidence ·{" "}
				{formatPercent(edge.weight)}
			</span>
		</button>
	)
}

function PaperEdgeCard({
	edge,
	papersById,
	onSelect,
}: {
	edge: PaperGraphPayload["graph"]["edges"][number]
	papersById: Map<string, PaperGraphPayload["graph"]["nodes"][number]>
	onSelect: (selection: Selection) => void
}) {
	const source = papersById.get(edge.source)
	const target = papersById.get(edge.target)
	return (
		<div className="mt-3 rounded-xl border border-border-subtle bg-bg-primary p-3">
			<div className="text-sm font-medium text-text-primary">
				{source?.title ?? "Paper"} ↔ {target?.title ?? "Paper"}
			</div>
			<div className="mt-1 text-xs text-text-tertiary">
				{formatPaperEdgeKind(edge.edgeKind)} · {edge.evidenceCount} evidence ·{" "}
				{edge.strongEvidenceCount} strong · strength {formatPercent(edge.weight)}
			</div>
			<div className="mt-3 flex gap-2">
				{source ? (
					<button
						className="rounded-full border border-border-subtle px-2.5 py-1 text-xs text-text-secondary hover:bg-surface-hover"
						onClick={() => onSelect({ kind: "node", id: source.id })}
						type="button"
					>
						Source paper
					</button>
				) : null}
				{target ? (
					<button
						className="rounded-full border border-border-subtle px-2.5 py-1 text-xs text-text-secondary hover:bg-surface-hover"
						onClick={() => onSelect({ kind: "node", id: target.id })}
						type="button"
					>
						Target paper
					</button>
				) : null}
			</div>
			<div className="mt-3 space-y-2">
				{edge.topEvidence.map((evidence) => (
					<div
						className="rounded-lg border border-border-subtle bg-bg-secondary px-2.5 py-2 text-xs"
						key={`${evidence.sourceConceptId}:${evidence.targetConceptId}:${evidence.matchMethod}`}
					>
						<div className="font-medium text-text-primary">
							{evidence.sourceConceptName} ↔ {evidence.targetConceptName}
						</div>
						<div className="mt-0.5 text-text-tertiary">
							{evidence.kind} · {evidence.matchMethod} · {formatPercent(evidence.similarityScore)}
							{evidence.llmDecision ? ` · LLM: ${evidence.llmDecision}` : ""}
							{evidence.llmConfidence != null
								? ` · confidence ${formatPercent(evidence.llmConfidence)}`
								: ""}
						</div>
						<div className="mt-2 grid gap-2">
							<ConceptMeaningCard
								description={evidence.sourceDescription}
								label={papersById.get(evidence.sourcePaperId)?.title ?? "Source paper"}
								name={evidence.sourceConceptName}
								snippets={evidence.sourceEvidenceSnippets}
							/>
							<ConceptMeaningCard
								description={evidence.targetDescription}
								label={papersById.get(evidence.targetPaperId)?.title ?? "Target paper"}
								name={evidence.targetConceptName}
								snippets={evidence.targetEvidenceSnippets}
							/>
						</div>
						{evidence.rationale ? (
							<div className="mt-1 line-clamp-2 text-text-secondary">{evidence.rationale}</div>
						) : null}
						<div className="mt-2 flex flex-wrap gap-2">
							<EvidenceJumpLink
								blockIds={evidence.sourceEvidenceBlockIds}
								label="Open source evidence"
								paperId={evidence.sourcePaperId}
							/>
							<EvidenceJumpLink
								blockIds={evidence.targetEvidenceBlockIds}
								label="Open target evidence"
								paperId={evidence.targetPaperId}
							/>
						</div>
					</div>
				))}
			</div>
		</div>
	)
}

function ConceptMeaningCard({
	label,
	name,
	description,
	snippets,
}: {
	label: string
	name: string
	description: string | null
	snippets: Array<{ blockId: string; snippet: string }>
}) {
	return (
		<div className="rounded-md border border-border-subtle bg-bg-primary px-2.5 py-2">
			<div className="text-[11px] uppercase tracking-[0.12em] text-text-tertiary">{label}</div>
			<div className="mt-1 font-medium text-text-primary">{name}</div>
			{description ? (
				<div className="mt-1 line-clamp-3 leading-5 text-text-secondary">{description}</div>
			) : (
				<div className="mt-1 text-text-tertiary">No source-level description yet.</div>
			)}
			{snippets.length > 0 ? (
				<div className="mt-2 rounded border border-border-subtle bg-bg-secondary px-2 py-1.5 leading-5 text-text-secondary">
					<span className="text-text-tertiary">Evidence: </span>
					{snippets[0]?.snippet}
				</div>
			) : null}
		</div>
	)
}

function EvidenceJumpLink({
	blockIds,
	label,
	paperId,
}: {
	blockIds: string[]
	label: string
	paperId: string
}) {
	const blockId = blockIds[0]
	if (!blockId) return null
	return (
		<Link
			className="rounded-full border border-border-subtle px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
			params={{ paperId }}
			search={{ blockId }}
			to="/papers/$paperId"
		>
			{label}
		</Link>
	)
}

function SimilarConceptCandidateButton({
	candidate,
	nodesById,
	onSelect,
	selectedNodeId,
}: {
	candidate: ConceptGraphPayload["graph"]["semanticCandidates"][number]
	nodesById: Map<string, ConceptGraphPayload["graph"]["nodes"][number]>
	onSelect: (selection: Selection) => void
	selectedNodeId: string | null
}) {
	const source = nodesById.get(candidate.source)
	const target = nodesById.get(candidate.target)
	const nextNodeId =
		selectedNodeId === candidate.source
			? candidate.target
			: selectedNodeId === candidate.target
				? candidate.source
				: candidate.source

	return (
		<div className="rounded-md border border-dashed border-border-subtle bg-bg-primary px-2.5 py-2 text-xs">
			<button
				className="block w-full text-left transition-colors hover:text-text-primary"
				onClick={() => onSelect({ kind: "node", id: nextNodeId })}
				type="button"
			>
				<span className="flex items-center justify-between gap-2">
					<span className="truncate font-medium text-text-primary">
						{source?.label ?? "Related concept"} ↔ {target?.label ?? "Related concept"}
					</span>
					<span className="shrink-0 text-text-tertiary">
						{formatPercent(candidate.similarityScore)}
					</span>
				</span>
				<span className="mt-0.5 block truncate text-text-tertiary">
					{formatCandidateDecisionStatus(candidate.decisionStatus)} · {candidate.matchMethod}
				</span>
				{candidate.llmDecision ? (
					<span className="mt-1 inline-flex rounded-full border border-border-subtle px-2 py-0.5 text-[11px] font-medium text-text-secondary">
						LLM: {candidate.llmDecision}
						{candidate.llmConfidence != null
							? ` · confidence ${formatPercent(candidate.llmConfidence)}`
							: ""}
					</span>
				) : null}
				{candidate.rationale ? (
					<span className="mt-1 line-clamp-2 block leading-4 text-text-secondary">
						{candidate.rationale}
					</span>
				) : null}
			</button>
		</div>
	)
}

function formatCandidateDecisionStatus(
	status: ConceptGraphPayload["graph"]["semanticCandidates"][number]["decisionStatus"],
) {
	if (status === "candidate" || status === "needs_review") return "AI linked"
	if (status === "auto_accepted") return "AI linked"
	if (status === "ai_confirmed") return "AI confirmed"
	if (status === "ai_rejected") return "AI rejected"
	if (status === "user_accepted") return "manually kept"
	if (status === "user_rejected") return "manually hidden"
	return status.replace("_", " ")
}

function buildSigmaGraph(
	data: WorkspaceGraphPayload,
	colors: {
		paper: string
		concept: string
		method: string
		task: string
		metric: string
		entity: string
		fallback: string
		edgeDefault: string
	},
	sizing: {
		edgeMinWidth: number
		edgeMaxWidth: number
		nodeMinRadius: number
		nodeMaxRadius: number
	},
): ConceptGraph {
	const graph = new Graph<SigmaNodeAttributes, SigmaEdgeAttributes>({
		multi: true,
		type: "undirected",
	})
	const layout = computeForceLayout(data)

	if (data.view === "papers") {
		for (const node of data.graph.nodes) {
			const weight = Math.max(node.degree, node.conceptCount / 10)
			const position = layout.get(node.id) ?? { x: 0, y: 0 }
			graph.addNode(node.id, {
				x: position.x,
				y: position.y,
				size: clampSize(6 + Math.sqrt(weight + 1) * 2.7, sizing.nodeMinRadius, sizing.nodeMaxRadius),
				label: "",
				color: colorForKind("paper", colors),
				baseColor: colorForKind("paper", colors),
				kind: "paper",
				weight,
				forceLabel: false,
				zIndex: Math.round(weight),
			})
		}
		for (const edge of data.graph.edges) {
			if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue
			graph.addUndirectedEdgeWithKey(edge.id, edge.source, edge.target, {
				size: edgeWidthForWeight(edge.weight, sizing.edgeMinWidth, sizing.edgeMaxWidth),
				label: edge.edgeKind,
				color: colors.edgeDefault,
				baseColor: colors.edgeDefault,
				relationType: edge.edgeKind,
				confidence: edge.weight,
				zIndex: Math.round(edge.weight * 10),
			})
		}
	} else {
		for (const node of data.graph.nodes) {
			const weight = Math.max(node.degree, node.salienceScore ?? 0)
			const position = layout.get(node.id) ?? { x: 0, y: 0 }
			graph.addNode(node.id, {
				x: position.x,
				y: position.y,
				size: clampSize(6 + Math.sqrt(weight + 1) * 2.7, sizing.nodeMinRadius, sizing.nodeMaxRadius),
				label: "",
				color: colorForKind(node.kind, colors),
				baseColor: colorForKind(node.kind, colors),
				kind: node.kind,
				weight,
				forceLabel: false,
				zIndex: Math.round(weight),
			})
		}
		for (const edge of data.graph.edges) {
			if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue
			const edgeWeight = edge.confidence ?? 0.5
			graph.addUndirectedEdgeWithKey(edge.id, edge.source, edge.target, {
				size: edgeWidthForWeight(edgeWeight, sizing.edgeMinWidth, sizing.edgeMaxWidth),
				label: edge.relationType,
				color: colors.edgeDefault,
				baseColor: colors.edgeDefault,
				relationType: edge.relationType,
				confidence: edgeWeight,
				zIndex: Math.round(edgeWeight * 10),
			})
		}
	}

	return graph
}

function computeForceLayout(data: WorkspaceGraphPayload) {
	const nodes = (
		data.view === "papers"
			? data.graph.nodes.map((node, index) => {
					const angle = (index / Math.max(data.graph.nodes.length, 1)) * Math.PI * 2
					const radius = 80 + data.graph.nodes.length * 5
					const nodeWeight = Math.max(node.degree, node.conceptCount / 10)
					return {
						id: node.id,
						x: Math.cos(angle) * radius,
						y: Math.sin(angle) * radius,
						radius: 12 + Math.sqrt(nodeWeight + 1) * 3,
					}
				})
			: data.graph.nodes.map((node, index) => {
					const angle = (index / Math.max(data.graph.nodes.length, 1)) * Math.PI * 2
					const radius = 80 + data.graph.nodes.length * 5
					const nodeWeight = Math.max(node.degree, node.salienceScore ?? 0)
					return {
						id: node.id,
						x: Math.cos(angle) * radius,
						y: Math.sin(angle) * radius,
						radius: 12 + Math.sqrt(nodeWeight + 1) * 3,
					}
				})
	) satisfies ForceNode[]
	const nodeIds = new Set(nodes.map((node) => node.id))
	const links = data.graph.edges
		.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
		.map<ForceLink>((edge) => ({ source: edge.source, target: edge.target }))

	if (nodes.length === 0) return new Map<string, { x: number; y: number }>()
	if (links.length === 0) {
		return new Map(
			nodes.map((node, index) => {
				const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2
				const radius = 140
				return [node.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }]
			}),
		)
	}

	const simulation = forceSimulation<ForceNode>(nodes)
		.force(
			"link",
			forceLink<ForceNode, ForceLink>(links)
				.id((node) => node.id)
				.distance(90)
				.strength(0.28),
		)
		.force("charge", forceManyBody().strength(-170))
		.force(
			"collide",
			forceCollide<ForceNode>().radius((node) => node.radius + 8),
		)
		.force("center", forceCenter(0, 0))
		.stop()

	for (let i = 0; i < 180; i += 1) simulation.tick()

	return new Map(nodes.map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]))
}

type ForceNode = SimulationNodeDatum & { id: string; radius: number }
type ForceLink = SimulationLinkDatum<ForceNode>

function colorForKind(
	kind: string,
	colors: {
		paper: string
		concept: string
		method: string
		task: string
		metric: string
		entity: string
		fallback: string
	},
) {
	if (kind === "paper") return colors.paper
	if (kind === "concept") return colors.concept
	if (kind === "method") return colors.method
	if (kind === "task") return colors.task
	if (kind === "metric") return colors.metric
	if (kind === "person" || kind === "organization" || kind === "dataset") return colors.entity
	return colors.fallback
}

function edgeWidthForWeight(weight: number, min: number, max: number) {
	return clampSize(min + (max - min) * Math.max(0, Math.min(1, weight)), min, max)
}

function clampSize(value: number, min: number, max: number) {
	return Math.min(Math.max(value, min), max)
}

function formatPercent(value: number | null) {
	if (value == null) return "n/a"
	return `${Math.round(value * 100)}%`
}

function formatPaperEdgeKind(kind: PaperGraphPayload["graph"]["edges"][number]["edgeKind"]) {
	if (kind === "shared_concepts") return "shared concepts"
	if (kind === "similar_methods") return "similar methods"
	if (kind === "same_task") return "same task"
	if (kind === "related_metrics") return "related metrics"
	if (kind === "semantic_neighbor") return "semantic neighbor"
	return "mixed evidence"
}

function cssColorVar(name: string, fallback: string) {
	if (typeof document === "undefined") return fallback
	const probe = document.createElement("span")
	probe.style.color = `var(${name})`
	probe.style.display = "none"
	document.body.appendChild(probe)
	const value = getComputedStyle(probe).color
	probe.remove()
	return value || fallback
}

function cssNumberVar(style: CSSStyleDeclaration, name: string, fallback: number) {
	const value = style.getPropertyValue(name).trim()
	const number = Number.parseFloat(value)
	return Number.isFinite(number) ? number : fallback
}
