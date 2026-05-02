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
	useReviewSemanticCandidate,
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
	const graphQuery = useWorkspaceGraph(workspace?.id)
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
						Read and compile a few papers first. Sapientia will surface concepts here once there is
						enough paper-local structure to connect.
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
							{data.graph.nodeCount} concepts · {data.graph.edgeCount} links
						</div>
					</div>
				</div>
				<WorkspaceGraphCanvas data={data} selection={selection} onSelect={setSelection} />
			</section>
				<WorkspaceGraphInspector
					data={data}
					selection={selection}
					onSelect={setSelection}
					workspaceId={workspace.id}
				/>
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
			aria-label="Workspace concept graph"
			className="h-full min-h-[34rem]"
			ref={containerRef}
			role="img"
		/>
	)
}

function WorkspaceGraphInspector({
	data,
	selection,
	onSelect,
	workspaceId,
}: {
	data: WorkspaceGraphPayload
	selection: Selection
	onSelect: (selection: Selection) => void
	workspaceId: string
}) {
	const reviewCandidate = useReviewSemanticCandidate(workspaceId)
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
				(candidate) =>
					candidate.source === selectedNode.id || candidate.target === selectedNode.id,
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
						Similar Concepts to Review
					</div>
					{selectedNode && visibleCandidates.length === 0 ? (
						<p className="mt-2 rounded-lg border border-border-subtle bg-bg-primary px-3 py-2 text-xs leading-5 text-text-secondary">
							No semantic candidates for this concept yet. Workspace-level candidates still exist;
							select Recall, Recall@1k, or F1 Score to inspect the current matches.
						</p>
					) : null}
					<div className="mt-2 space-y-2">
						<div className="rounded-lg border border-border-subtle bg-bg-primary px-3 py-2 text-xs text-text-secondary">
							{data.graph.semanticCandidateCounts.needsReview} to review ·{" "}
							{data.graph.semanticCandidateCounts.userAccepted} accepted ·{" "}
							{data.graph.semanticCandidateCounts.userRejected} rejected
						</div>
						{visibleCandidates.map((candidate) => (
								<SimilarConceptCandidateButton
									candidate={candidate}
									key={candidate.id}
									nodesById={nodesById}
									onSelect={onSelect}
									onReview={(decisionStatus) =>
										reviewCandidate.mutate({
											candidateId: candidate.id,
											decisionStatus,
										})
									}
									reviewing={reviewCandidate.isPending}
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

function SimilarConceptCandidateButton({
	candidate,
	nodesById,
	onSelect,
	onReview,
	reviewing,
	selectedNodeId,
}: {
	candidate: WorkspaceGraphPayload["graph"]["semanticCandidates"][number]
	nodesById: Map<string, WorkspaceGraphPayload["graph"]["nodes"][number]>
	onSelect: (selection: Selection) => void
	onReview: (decisionStatus: "user_accepted" | "user_rejected") => void
	reviewing: boolean
	selectedNodeId: string | null
}) {
	const source = nodesById.get(candidate.source)
	const target = nodesById.get(candidate.target)
	const nextNodeId =
		selectedNodeId === candidate.source ? candidate.target : selectedNodeId === candidate.target ? candidate.source : candidate.source

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
					</span>
				) : null}
				{candidate.rationale ? (
					<span className="mt-1 line-clamp-2 block leading-4 text-text-secondary">
						{candidate.rationale}
					</span>
				) : null}
			</button>
			{candidate.decisionStatus === "needs_review" ? (
				<div className="mt-2 flex gap-2">
					<button
						className="rounded-full border border-border-subtle px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:border-text-primary hover:text-text-primary disabled:opacity-50"
						disabled={reviewing}
						onClick={() => onReview("user_accepted")}
						type="button"
					>
						Accept
					</button>
					<button
						className="rounded-full border border-border-subtle px-2 py-1 text-[11px] font-medium text-text-tertiary transition-colors hover:border-text-secondary hover:text-text-primary disabled:opacity-50"
						disabled={reviewing}
						onClick={() => onReview("user_rejected")}
						type="button"
					>
						Reject
					</button>
				</div>
			) : null}
		</div>
	)
}

function formatCandidateDecisionStatus(status: WorkspaceGraphPayload["graph"]["semanticCandidates"][number]["decisionStatus"]) {
	if (status === "needs_review") return "review required"
	if (status === "auto_accepted") return "auto accepted"
	if (status === "user_accepted") return "user accepted"
	return status.replace("_", " ")
}

function buildSigmaGraph(
	data: WorkspaceGraphPayload,
	colors: {
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
		graph.addUndirectedEdgeWithKey(edge.id, edge.source, edge.target, {
			size: 0.8 + (edge.confidence ?? 0.5) * 1.8,
			label: edge.relationType,
			color: colors.edgeDefault,
			relationType: edge.relationType,
			confidence: edge.confidence ?? 0.5,
			zIndex: Math.round((edge.confidence ?? 0.5) * 10),
		})
	}

	return graph
}

function computeForceLayout(data: WorkspaceGraphPayload) {
	const nodes = data.graph.nodes.map<ForceNode>((node, index) => {
		const angle = (index / Math.max(data.graph.nodes.length, 1)) * Math.PI * 2
		const radius = 80 + data.graph.nodes.length * 5
		return {
			id: node.id,
			x: Math.cos(angle) * radius,
			y: Math.sin(angle) * radius,
			radius: 12 + Math.sqrt(Math.max(node.degree, node.salienceScore ?? 0) + 1) * 3,
		}
	})
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
		.force("collide", forceCollide<ForceNode>().radius((node) => node.radius + 8))
		.force("center", forceCenter(0, 0))
		.stop()

	for (let i = 0; i < 180; i += 1) simulation.tick()

	return new Map(nodes.map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]))
}

type ForceNode = SimulationNodeDatum & { id: string; radius: number }
type ForceLink = SimulationLinkDatum<ForceNode>

function colorForKind(
	kind: string,
	colors: { concept: string; method: string; task: string; metric: string; fallback: string },
) {
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

function cssVar(style: CSSStyleDeclaration, name: string, fallback: string) {
	const value = style.getPropertyValue(name).trim()
	return value || fallback
}
