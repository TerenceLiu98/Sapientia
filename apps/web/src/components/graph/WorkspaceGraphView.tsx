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
	kind: string
	weight: number
	forceLabel?: boolean
	zIndex?: number
}
type SigmaEdgeAttributes = {
	size: number
	label: string
	color: string
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
							Workspace Graph
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

	useEffect(() => {
		selectionRef.current = selection
		rendererRef.current?.refresh()
	}, [selection])

	useEffect(() => {
		const container = containerRef.current
		if (!container) return undefined

		const computedStyle = getComputedStyle(document.documentElement)
		const textPrimary = cssVar(computedStyle, "--color-text-primary", "#2f2a24")
		const edgeDefault = cssVar(computedStyle, "--graph-edge-default", "rgba(100, 92, 82, 0.45)")
		const edgeActive = cssVar(computedStyle, "--graph-edge-active", "#2f2a24")
		const colors = {
			paper: cssVar(computedStyle, "--graph-node-concept", "#2f7f8f"),
			concept: cssVar(computedStyle, "--graph-node-concept", "#2f7f8f"),
			method: "#8b6f47",
			task: "#9a624f",
			metric: "#7f7a72",
			fallback: "#7f7a72",
			edgeDefault,
			edgeActive,
		}

		const graph = buildSigmaGraph(data, colors)
		const renderer = new Sigma<SigmaNodeAttributes, SigmaEdgeAttributes>(graph, container, {
			allowInvalidContainer: true,
			autoCenter: true,
			autoRescale: true,
			enableEdgeEvents: true,
			labelColor: { color: textPrimary },
			labelDensity: 0.08,
			labelRenderedSizeThreshold: 8,
			labelSize: 11,
			renderEdgeLabels: false,
			stagePadding: 40,
			zIndex: true,
			nodeReducer: (node, attributes) => {
				const currentSelection = selectionRef.current
				if (currentSelection?.kind !== "node") return attributes
				if (currentSelection.id === node) {
					return {
						...attributes,
						color: edgeActive,
						forceLabel: true,
						size: attributes.size * 1.24,
						zIndex: 4,
					}
				}
				return { ...attributes, color: fadeColor(attributes.color), zIndex: 1 }
			},
			edgeReducer: (edge, attributes) => {
				const currentSelection = selectionRef.current
				if (currentSelection?.kind !== "edge") return attributes
				if (currentSelection.id === edge) {
					return {
						...attributes,
						color: edgeActive,
						size: Math.max(attributes.size * 1.6, 2.5),
						zIndex: 4,
					}
				}
				return { ...attributes, color: fadeColor(attributes.color), zIndex: 1 }
			},
		})

		renderer.on("clickNode", ({ node }) => onSelect({ kind: "node", id: node }))
		renderer.on("clickEdge", ({ edge }) => onSelect({ kind: "edge", id: edge }))
		renderer.on("clickStage", () => onSelect(null))

		rendererRef.current = renderer

		return () => {
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
				</div>
			) : (
				<p className="mt-3 text-sm leading-6 text-text-secondary">
					Select a paper or connection. Edges are built from shared and semantically related
					concepts, so the map stays grounded in paper evidence.
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
				{edge.strongEvidenceCount} strong
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
		fallback: string
		edgeDefault: string
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
				size: 6 + Math.sqrt(weight + 1) * 2.7,
				label: node.label,
				color: colorForKind("paper", colors),
				kind: "paper",
				weight,
				forceLabel: node.degree > 0,
				zIndex: Math.round(weight),
			})
		}
		for (const edge of data.graph.edges) {
			if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue
			graph.addUndirectedEdgeWithKey(edge.id, edge.source, edge.target, {
				size: 0.8 + edge.weight * 1.8,
				label: edge.edgeKind,
				color: colors.edgeDefault,
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
				size: 6 + Math.sqrt(weight + 1) * 2.7,
				label: node.label,
				color: colorForKind(node.kind, colors),
				kind: node.kind,
				weight,
				forceLabel: node.degree > 2 || node.paperCount > 1,
				zIndex: Math.round(weight),
			})
		}
		for (const edge of data.graph.edges) {
			if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue
			const edgeWeight = edge.confidence ?? 0.5
			graph.addUndirectedEdgeWithKey(edge.id, edge.source, edge.target, {
				size: 0.8 + edgeWeight * 1.8,
				label: edge.relationType,
				color: colors.edgeDefault,
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
		fallback: string
	},
) {
	if (kind === "paper") return colors.paper
	if (kind === "concept") return colors.concept
	if (kind === "method") return colors.method
	if (kind === "task") return colors.task
	if (kind === "metric") return colors.metric
	return colors.fallback
}

function fadeColor(color: string) {
	if (color.startsWith("#") && color.length === 7) {
		const r = Number.parseInt(color.slice(1, 3), 16)
		const g = Number.parseInt(color.slice(3, 5), 16)
		const b = Number.parseInt(color.slice(5, 7), 16)
		return `rgba(${r}, ${g}, ${b}, 0.32)`
	}
	return color
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

function cssVar(style: CSSStyleDeclaration, name: string, fallback: string) {
	const value = style.getPropertyValue(name).trim()
	return value || fallback
}
