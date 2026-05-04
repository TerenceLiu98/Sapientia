import { Link } from "@tanstack/react-router"
import {
	forceCenter,
	forceCollide,
	forceLink,
	forceManyBody,
	forceSimulation,
	forceX,
	forceY,
	type SimulationLinkDatum,
	type SimulationNodeDatum,
} from "d3-force"
import Graph from "graphology"
import { ExternalLink, LocateFixed, Search, X } from "lucide-react"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import EdgeCurveProgram from "@sigma/edge-curve"
import Sigma from "sigma"
import type { EdgeProgramType } from "sigma/rendering"
import { type PaperGraphPayload, useWorkspaceGraph } from "@/api/hooks/graph"
import type { Workspace } from "@/api/hooks/workspaces"

type Selection = { kind: "node"; id: string } | { kind: "edge"; id: string } | null
type PaperEdgeKind = PaperGraphPayload["graph"]["edges"][number]["edgeKind"]
type PaperNode = PaperGraphPayload["graph"]["nodes"][number]
type PaperEdge = PaperGraphPayload["graph"]["edges"][number]
type PaperEvidence = PaperEdge["topEvidence"][number]

type SigmaNodeAttributes = {
	x: number
	y: number
	size: number
	label: string
	title: string
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
	status: "active" | "stale"
	type?: string
	curvature?: number
	zIndex?: number
}
type PaperSigmaGraph = Graph<SigmaNodeAttributes, SigmaEdgeAttributes>
const PaperEdgeCurveProgram = EdgeCurveProgram as unknown as EdgeProgramType<
	SigmaNodeAttributes,
	SigmaEdgeAttributes
>

const PAPER_EDGE_KIND_OPTIONS: Array<{ kind: PaperEdgeKind; label: string }> = [
	{ kind: "shared_concepts", label: "shared concepts" },
	{ kind: "similar_methods", label: "similar methods" },
	{ kind: "same_task", label: "same task" },
	{ kind: "related_metrics", label: "related metrics" },
	{ kind: "semantic_neighbor", label: "semantic neighbor" },
	{ kind: "mixed", label: "mixed evidence" },
]

export function WorkspaceGraphView({ workspace }: { workspace: Workspace | undefined }) {
	const [selection, setSelection] = useState<Selection>(null)
	const [searchQuery, setSearchQuery] = useState("")
	const [fitNonce, setFitNonce] = useState(0)
	const [activeEdgeKinds, setActiveEdgeKinds] = useState<Set<PaperEdgeKind>>(
		() => new Set(PAPER_EDGE_KIND_OPTIONS.map((option) => option.kind)),
	)
	const graphQuery = useWorkspaceGraph(workspace?.id, "papers")
	const data = graphQuery.data

	const paperData = data?.view === "papers" ? data : null
	const filteredData = useMemo(
		() => (paperData ? filterPaperGraphByKinds(paperData, activeEdgeKinds) : null),
		[activeEdgeKinds, paperData],
	)

	useEffect(() => {
		if (!selection || !filteredData) return
		if (
			selection.kind === "edge" &&
			!filteredData.graph.edges.some((edge) => edge.id === selection.id)
		) {
			setSelection(null)
		}
		if (
			selection.kind === "node" &&
			!filteredData.graph.nodes.some((node) => node.id === selection.id)
		) {
			setSelection(null)
		}
	}, [filteredData, selection])

	if (!workspace) {
		return <GraphLoadingState label="Loading workspace..." />
	}

	if (graphQuery.isLoading) {
		return <GraphLoadingState label="Loading paper map..." />
	}

	if (graphQuery.error) {
		return (
			<GraphErrorState
				error={graphQuery.error}
				onRetry={() => {
					void graphQuery.refetch()
				}}
			/>
		)
	}

	if (!paperData || paperData.graph.nodeCount < 2) {
		return <GraphEmptyState variant="papers" />
	}

	if (paperData.graph.edgeCount === 0) {
		return <GraphEmptyState variant="links" />
	}

	const clearGraphState = () => {
		setSelection(null)
		setSearchQuery("")
		setActiveEdgeKinds(new Set(PAPER_EDGE_KIND_OPTIONS.map((option) => option.kind)))
		setFitNonce((value) => value + 1)
	}

	return (
		<div className="flex h-full min-h-0 flex-col bg-bg-primary">
			<GraphToolbar
				activeEdgeKinds={activeEdgeKinds}
				data={paperData}
				onClear={clearGraphState}
				onFit={() => setFitNonce((value) => value + 1)}
				onToggleKind={(kind) => {
					setActiveEdgeKinds((current) => toggleEdgeKind(current, kind))
				}}
				visibleLinkCount={filteredData?.graph.edgeCount ?? 0}
			/>
			<div className="min-h-0 flex-1 p-3 lg:p-4">
				<section className="relative h-full min-h-[24rem] overflow-hidden rounded-lg border border-border-subtle bg-[var(--color-reading-bg)]">
					<WorkspaceGraphCanvas
						data={filteredData ?? paperData}
						fitNonce={fitNonce}
						onSelect={setSelection}
						selection={selection}
					/>
					<GraphCanvasPanels
						data={filteredData ?? paperData}
						onClearSelection={() => setSelection(null)}
						onSearchChange={setSearchQuery}
						onSelect={setSelection}
						searchQuery={searchQuery}
						selection={selection}
					/>
					<GraphLegend />
				</section>
			</div>
		</div>
	)
}

function GraphToolbar({
	activeEdgeKinds,
	data,
	onClear,
	onFit,
	onToggleKind,
	visibleLinkCount,
}: {
	activeEdgeKinds: Set<PaperEdgeKind>
	data: PaperGraphPayload
	onClear: () => void
	onFit: () => void
	onToggleKind: (kind: PaperEdgeKind) => void
	visibleLinkCount: number
}) {
	return (
		<header className="shrink-0 border-b border-border-subtle bg-[var(--color-reading-bg)] px-4 py-3">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<h1 className="text-lg font-semibold text-text-primary">Paper Map</h1>
					<p className="mt-1 text-sm leading-5 text-text-secondary">
						Connections inferred from shared concepts and semantic evidence.
					</p>
					<div className="mt-2 text-xs text-text-tertiary">
						{data.graph.nodeCount} papers · {visibleLinkCount} of {data.graph.edgeCount} links
						visible
					</div>
				</div>
				<div className="flex flex-wrap items-center justify-end gap-2">
					<button
						className="inline-flex h-9 items-center gap-2 rounded-md border border-border-subtle bg-bg-primary px-3 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
						onClick={onFit}
						type="button"
					>
						<LocateFixed className="h-4 w-4" />
						Fit
					</button>
					<button
						className="inline-flex h-9 items-center gap-2 rounded-md border border-border-subtle bg-bg-primary px-3 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
						onClick={onClear}
						type="button"
					>
						<X className="h-4 w-4" />
						Clear
					</button>
				</div>
			</div>
			<div className="mt-3 flex flex-wrap gap-1.5">
				{PAPER_EDGE_KIND_OPTIONS.map((option) => {
					const active = activeEdgeKinds.has(option.kind)
					return (
						<button
							aria-pressed={active}
							className={[
								"rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
								active
									? "border-border-strong bg-surface-selected text-text-primary"
									: "border-border-subtle bg-bg-primary text-text-tertiary hover:bg-surface-hover hover:text-text-primary",
							].join(" ")}
							key={option.kind}
							onClick={() => onToggleKind(option.kind)}
							type="button"
						>
							{option.label}
						</button>
					)
				})}
			</div>
		</header>
	)
}

function WorkspaceGraphCanvas({
	data,
	fitNonce,
	selection,
	onSelect,
}: {
	data: PaperGraphPayload
	fitNonce: number
	selection: Selection
	onSelect: (selection: Selection) => void
}) {
	const containerRef = useRef<HTMLDivElement | null>(null)
	const rendererRef = useRef<Sigma<SigmaNodeAttributes, SigmaEdgeAttributes> | null>(null)
	const selectionRef = useRef<Selection>(selection)
	const hoverRef = useRef<Selection>(null)
	const draggedNodeRef = useRef<string | null>(null)
	const physicsRef = useRef<PaperPhysicsSimulation | null>(null)

	useEffect(() => {
		selectionRef.current = selection
		rendererRef.current?.refresh()
	}, [selection])

	useEffect(() => {
		if (fitNonce === 0) return
		resetSigmaCamera(rendererRef.current)
	}, [fitNonce])

	useEffect(() => {
		const container = containerRef.current
		if (!container) return undefined

		const computedStyle = getComputedStyle(document.documentElement)
		const textPrimary = cssColorVar("--color-text-primary", "#2f2a24")
		const edgeDefault = cssColorVar("--graph-edge-default", "rgb(34, 34, 34)")
		const edgeActive = cssColorVar("--graph-edge-active", "rgb(18, 18, 18)")
		const edgeMinWidth = cssNumberVar(computedStyle, "--graph-edge-width-min", 0.5)
		const edgeMaxWidth = cssNumberVar(computedStyle, "--graph-edge-width-max", 3)
		const nodeMinRadius = cssNumberVar(computedStyle, "--graph-node-radius-min", 4)
		const nodeMaxRadius = cssNumberVar(computedStyle, "--graph-node-radius-max", 16)
		const colors = {
			paper: cssColorVar("--graph-node-source", "rgb(0, 78, 80)"),
			fallback: cssColorVar("--graph-node-source", "rgb(0, 78, 80)"),
			mutedNode: cssColorVar("--color-border-strong", "rgb(135, 126, 114)"),
			edgeDefault,
			edgeActive,
		}

		const graph = buildPaperSigmaGraph(data, colors, {
			edgeMinWidth,
			edgeMaxWidth,
			nodeMinRadius,
			nodeMaxRadius,
		})
		const adjacency = buildPaperAdjacency(data.graph.edges)
		const renderer = new Sigma<SigmaNodeAttributes, SigmaEdgeAttributes>(graph, container, {
			allowInvalidContainer: true,
			autoCenter: true,
			autoRescale: true,
			enableEdgeEvents: true,
			defaultEdgeType: "curved",
			defaultDrawNodeHover: () => {},
			defaultDrawNodeLabel: () => {},
			edgeProgramClasses: {
				curved: PaperEdgeCurveProgram,
			},
			labelColor: { color: textPrimary },
			labelDensity: 0,
			labelRenderedSizeThreshold: 12,
			labelSize: cssNumberVar(computedStyle, "--graph-label-font-size", 12),
			renderLabels: false,
			renderEdgeLabels: false,
			stagePadding: 42,
			zIndex: true,
			nodeReducer: (node, attributes) => {
				const active = selectionRef.current ?? hoverRef.current
				if (!active) return attributes
				const involved = isNodeInFocus(node, active, adjacency)
				if (!involved) {
					return {
						...attributes,
						color: colorWithAlpha(colors.mutedNode, 0.72),
						forceLabel: false,
						label: "",
						size: Math.max(attributes.size * 0.86, nodeMinRadius),
						zIndex: 0,
					}
				}
				return {
					...attributes,
					color: attributes.baseColor,
					forceLabel: active.kind === "node" && active.id === node,
					label: attributes.title,
					size:
						active.kind === "node" && active.id === node
							? Math.min(attributes.size * 1.34, nodeMaxRadius + 4)
							: Math.min(attributes.size * 1.12, nodeMaxRadius + 2),
					zIndex: active.kind === "node" && active.id === node ? 5 : 3,
				}
			},
			edgeReducer: (edge, attributes) => {
				const active = selectionRef.current ?? hoverRef.current
				if (!active) return attributes
				const involved = isEdgeInFocus(edge, active, graph)
				if (!involved) {
					return {
						...attributes,
						color: colorWithAlpha(attributes.baseColor, 0.34),
						size: Math.max(attributes.size * 0.78, edgeMinWidth),
						zIndex: 0,
					}
				}
				return {
					...attributes,
					color: edgeActive,
					size:
						active.kind === "edge" && active.id === edge
							? Math.min(Math.max(attributes.size * 1.7, edgeMinWidth + 1.5), edgeMaxWidth + 1.4)
							: Math.min(Math.max(attributes.size * 1.3, edgeMinWidth + 0.7), edgeMaxWidth + 0.8),
					zIndex: active.kind === "edge" && active.id === edge ? 5 : 3,
				}
			},
		})

		const physics = startPaperPhysicsSimulation(data, graph, renderer)
		physicsRef.current = physics
		const mouseCaptor = renderer.getMouseCaptor()
		renderer.on("clickNode", ({ node }) => onSelect({ kind: "node", id: node }))
		renderer.on("clickEdge", ({ edge }) => onSelect({ kind: "edge", id: edge }))
		renderer.on("clickStage", () => onSelect(null))
		renderer.on("enterNode", ({ node }) => {
			hoverRef.current = { kind: "node", id: node }
			container.style.cursor = "pointer"
			renderer.refresh()
		})
		renderer.on("leaveNode", () => {
			hoverRef.current = null
			container.style.cursor = ""
			renderer.refresh()
		})
		renderer.on("enterEdge", ({ edge }) => {
			hoverRef.current = { kind: "edge", id: edge }
			container.style.cursor = "pointer"
			renderer.refresh()
		})
		renderer.on("leaveEdge", () => {
			hoverRef.current = null
			container.style.cursor = ""
			renderer.refresh()
		})
		renderer.on("downNode", (event) => {
			draggedNodeRef.current = event.node
			physicsRef.current?.pinNode(
				event.node,
				graph.getNodeAttribute(event.node, "x"),
				graph.getNodeAttribute(event.node, "y"),
			)
			container.style.cursor = "grabbing"
			event.preventSigmaDefault()
		})
		mouseCaptor.on("mousemovebody", (event) => {
			const draggedNode = draggedNodeRef.current
			if (!draggedNode) return
			const position = renderer.viewportToGraph(event)
			physicsRef.current?.pinNode(draggedNode, position.x, position.y)
			event.preventSigmaDefault()
			event.original.preventDefault()
			event.original.stopPropagation()
		})
		mouseCaptor.on("mouseup", () => {
			const draggedNode = draggedNodeRef.current
			if (!draggedNode) return
			draggedNodeRef.current = null
			physicsRef.current?.releaseNode(draggedNode)
			container.style.cursor = ""
		})
		mouseCaptor.on("mouseleave", () => {
			const draggedNode = draggedNodeRef.current
			if (!draggedNode) return
			draggedNodeRef.current = null
			physicsRef.current?.releaseNode(draggedNode)
			container.style.cursor = ""
		})

		rendererRef.current = renderer

		return () => {
			draggedNodeRef.current = null
			hoverRef.current = null
			physics.stop()
			physicsRef.current = null
			renderer.kill()
			rendererRef.current = null
		}
	}, [data, onSelect])

	return (
		<div
			aria-label="Workspace graph"
			className="h-full min-h-[24rem] [background-image:linear-gradient(color-mix(in_srgb,var(--color-border-subtle)_34%,transparent)_1px,transparent_1px),linear-gradient(90deg,color-mix(in_srgb,var(--color-border-subtle)_34%,transparent)_1px,transparent_1px)] [background-size:32px_32px]"
			ref={containerRef}
			role="img"
		/>
	)
}

function GraphLegend() {
	return (
		<div className="pointer-events-none absolute right-3 bottom-3 max-w-[16rem] rounded-md border border-border-subtle bg-bg-primary/90 px-3 py-2 text-[11px] leading-5 text-text-tertiary shadow-[var(--shadow-sm)]">
			<div>
				<span className="font-medium text-text-secondary">Node size</span> = connectedness + concept
				count
			</div>
			<div>
				<span className="font-medium text-text-secondary">Edge width</span> = relationship strength
			</div>
			<div>
				<span className="font-medium text-text-secondary">Accent</span> = selected or neighboring
				evidence
			</div>
		</div>
	)
}

function GraphCanvasPanels({
	data,
	onClearSelection,
	onSearchChange,
	onSelect,
	selection,
	searchQuery,
}: {
	data: PaperGraphPayload
	selection: Selection
	searchQuery: string
	onSelect: (selection: Selection) => void
	onClearSelection: () => void
	onSearchChange: (value: string) => void
}) {
	const selectedNode =
		selection?.kind === "node" ? data.graph.nodes.find((node) => node.id === selection.id) : null
	const selectedEdge =
		selection?.kind === "edge" ? data.graph.edges.find((edge) => edge.id === selection.id) : null
	const papersById = useMemo(
		() => new Map(data.graph.nodes.map((node) => [node.id, node] as const)),
		[data.graph.nodes],
	)
	const normalizedQuery = normalizeSearch(searchQuery)
	const selectedNodeEdges = useMemo(() => {
		if (!selectedNode) return []
		return data.graph.edges
			.filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id)
			.sort((a, b) => b.weight - a.weight)
	}, [data.graph.edges, selectedNode])
	const topPapers = useMemo(
		() =>
			[...data.graph.nodes]
				.filter((paper) => matchesPaperSearch(paper, normalizedQuery))
				.sort((a, b) => b.degree + b.conceptCount / 10 - (a.degree + a.conceptCount / 10))
				.slice(0, 12),
		[data.graph.nodes, normalizedQuery],
	)
	const topEdges = useMemo(
		() =>
			[...data.graph.edges]
				.filter((edge) => matchesEdgeSearch(edge, papersById, normalizedQuery))
				.sort((a, b) => b.weight - a.weight)
				.slice(0, 8),
		[data.graph.edges, normalizedQuery, papersById],
	)

	return (
		<>
			<GraphSearchDock onSearchChange={onSearchChange} searchQuery={searchQuery}>
				{normalizedQuery ? (
					<GraphSearchResults
						onSelect={onSelect}
						papers={topPapers}
						papersById={papersById}
						strongEdges={topEdges}
					/>
				) : !selection ? (
					<GraphCanvasHint />
				) : null}
			</GraphSearchDock>
			{selectedEdge ? (
				<GraphDetailSheet heading="Evidence" onClose={onClearSelection}>
					<PaperEdgeCard edge={selectedEdge} papersById={papersById} onSelect={onSelect} />
				</GraphDetailSheet>
			) : selectedNode ? (
				<GraphDetailSheet heading="Paper" onClose={onClearSelection}>
					<PaperNodeCard
						edges={selectedNodeEdges}
						onSelect={onSelect}
						paper={selectedNode}
						papersById={papersById}
					/>
				</GraphDetailSheet>
			) : null}
		</>
	)
}

function GraphSearchDock({
	children,
	onSearchChange,
	searchQuery,
}: {
	children: ReactNode
	onSearchChange: (value: string) => void
	searchQuery: string
}) {
	return (
		<div className="absolute top-3 left-3 z-[var(--z-elevated)] w-[min(24rem,calc(100%-1.5rem))] rounded-lg border border-border-subtle bg-bg-secondary/95 p-2 shadow-[var(--shadow-md)] backdrop-blur">
			<label className="relative block min-w-0">
				<span className="sr-only">Search papers</span>
				<Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 text-text-tertiary" />
				<input
					className="h-9 w-full rounded-md border border-border-subtle bg-bg-primary pr-3 pl-8 text-sm text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong"
					onChange={(event) => onSearchChange(event.target.value)}
					placeholder="Search papers, authors, concepts"
					type="search"
					value={searchQuery}
				/>
			</label>
			{children}
		</div>
	)
}

function GraphCanvasHint() {
	return (
		<div className="pointer-events-none mt-2 rounded-md border border-border-subtle bg-bg-primary px-3 py-2 text-xs leading-5 text-text-secondary">
			Click a paper to expand its concepts and connections. Click a link to inspect the evidence.
		</div>
	)
}

function GraphSearchResults({
	onSelect,
	papers,
	papersById,
	strongEdges,
}: {
	onSelect: (selection: Selection) => void
	papers: PaperNode[]
	papersById: Map<string, PaperNode>
	strongEdges: PaperEdge[]
}) {
	return (
		<div className="mt-2 max-h-[min(30rem,calc(100vh-18rem))] overflow-auto rounded-md border border-border-subtle bg-bg-primary p-3">
			<div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">Search</div>
			<div className="mt-2 rounded-md border border-border-subtle bg-bg-primary px-3 py-2 text-xs text-text-secondary">
				{papers.length} paper match{papers.length === 1 ? "" : "es"} · {strongEdges.length}{" "}
				connection match
				{strongEdges.length === 1 ? "" : "es"}
			</div>
			<InspectorSection title="Papers">
				{papers.length > 0 ? (
					papers
						.slice(0, 5)
						.map((paper) => (
							<PaperButton
								key={paper.id}
								onClick={() => onSelect({ kind: "node", id: paper.id })}
								paper={paper}
							/>
						))
				) : (
					<EmptyInspectorLine>No matching papers.</EmptyInspectorLine>
				)}
			</InspectorSection>
			<InspectorSection title="Connections">
				{strongEdges.length > 0 ? (
					strongEdges
						.slice(0, 5)
						.map((edge) => (
							<PaperEdgeButton
								edge={edge}
								key={edge.id}
								onSelect={onSelect}
								papersById={papersById}
							/>
						))
				) : (
					<EmptyInspectorLine>No matching connections.</EmptyInspectorLine>
				)}
			</InspectorSection>
		</div>
	)
}

function GraphDetailSheet({
	children,
	heading,
	onClose,
}: {
	children: ReactNode
	heading: string
	onClose: () => void
}) {
	return (
		<div className="absolute bottom-3 left-3 z-[var(--z-elevated)] max-h-[min(42rem,calc(100%-2rem))] w-[min(32rem,calc(100%-1.5rem))] overflow-auto rounded-lg border border-border-subtle bg-bg-secondary/95 p-3 shadow-[var(--shadow-md)] backdrop-blur md:bottom-4 md:left-4">
			<div className="flex items-center justify-between gap-3">
				<div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">{heading}</div>
				<button
					aria-label="Close graph details"
					className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border-subtle bg-bg-primary text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-primary"
					onClick={onClose}
					type="button"
				>
					<X className="h-4 w-4" />
				</button>
			</div>
			{children}
		</div>
	)
}

function PaperNodeCard({
	edges,
	onSelect,
	paper,
	papersById,
}: {
	edges: PaperEdge[]
	onSelect: (selection: Selection) => void
	paper: PaperNode
	papersById: Map<string, PaperNode>
}) {
	return (
		<div className="mt-3 rounded-lg border border-border-subtle bg-bg-primary p-3">
			<div className="text-sm font-medium text-text-primary">{paper.title}</div>
			<div className="mt-1 text-xs leading-5 text-text-tertiary">
				{paper.year ?? "n.d."}
				{paper.venue ? ` · ${paper.venue}` : ""} · {paper.conceptCount} concepts · degree{" "}
				{paper.degree}
			</div>
			{paper.authors.length > 0 ? (
				<div className="mt-1 line-clamp-2 text-xs leading-5 text-text-secondary">
					{paper.authors.join(", ")}
				</div>
			) : null}
			<div className="mt-3 flex flex-wrap gap-2">
				<Link
					className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-subtle bg-bg-secondary px-2.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
					params={{ paperId: paper.paperId }}
					search={{ blockId: undefined }}
					to="/papers/$paperId"
				>
					<ExternalLink className="h-3.5 w-3.5" />
					Open paper
				</Link>
			</div>
			{paper.topConcepts.length > 0 ? (
				<div className="mt-3 flex flex-wrap gap-1.5">
					{paper.topConcepts.map((concept) => (
						<span
							className="rounded-md border border-border-subtle bg-bg-secondary px-2 py-1 text-[11px] text-text-secondary"
							key={concept.id}
						>
							<span className="font-medium text-text-primary">{concept.displayName}</span>
							<span className="text-text-tertiary"> · {concept.kind}</span>
							{concept.hasReaderNoteEvidence ? (
								<span className="text-text-tertiary"> · reader note</span>
							) : null}
						</span>
					))}
				</div>
			) : null}
			<InspectorSection title="Connected Papers">
				{edges.length > 0 ? (
					edges.map((edge) => (
						<PaperNodeConnectionButton
							edge={edge}
							key={edge.id}
							onSelect={onSelect}
							papersById={papersById}
							selectedPaperId={paper.id}
						/>
					))
				) : (
					<EmptyInspectorLine>No visible paper links.</EmptyInspectorLine>
				)}
			</InspectorSection>
		</div>
	)
}

function PaperNodeConnectionButton({
	edge,
	papersById,
	selectedPaperId,
	onSelect,
}: {
	edge: PaperEdge
	papersById: Map<string, PaperNode>
	selectedPaperId: string
	onSelect: (selection: Selection) => void
}) {
	const otherPaperId = edge.source === selectedPaperId ? edge.target : edge.source
	const otherPaper = papersById.get(otherPaperId)
	const strongestEvidence = sortedPaperEvidence(edge.topEvidence)[0]
	return (
		<button
			className="block w-full rounded-md border border-border-subtle bg-bg-secondary px-3 py-2 text-left text-xs transition-colors hover:bg-surface-hover"
			onClick={() => onSelect({ kind: "edge", id: edge.id })}
			type="button"
		>
			<span className="block truncate font-medium text-text-primary">
				{otherPaper?.title ?? "Connected paper"}
			</span>
			<span className="mt-0.5 block text-text-tertiary">
				{formatPaperEdgeKind(edge.edgeKind)} · strength {formatPercent(edge.weight)}
				{edge.status === "stale" ? " · stale" : edge.isRetained ? " · weaker evidence" : ""}
				{edge.hasReaderNoteEvidence ? " · reader note" : ""}
			</span>
			{strongestEvidence ? (
				<span className="mt-1 line-clamp-2 block leading-5 text-text-secondary">
					via {strongestEvidence.sourceConceptName} / {strongestEvidence.targetConceptName}
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
	edge: PaperEdge
	papersById: Map<string, PaperNode>
	onSelect: (selection: Selection) => void
}) {
	const source = papersById.get(edge.source)
	const target = papersById.get(edge.target)
	return (
		<button
			className="block w-full rounded-md border border-dashed border-border-subtle bg-bg-primary px-3 py-2 text-left text-xs transition-colors hover:bg-surface-hover"
			onClick={() => onSelect({ kind: "edge", id: edge.id })}
			type="button"
		>
			<span className="block truncate font-medium text-text-primary">
				{source?.title ?? "Paper"} / {target?.title ?? "Paper"}
			</span>
			<span className="mt-1 block text-text-tertiary">
				{formatPaperEdgeKind(edge.edgeKind)} · {edge.evidenceCount} evidence ·{" "}
				{formatPercent(edge.weight)}
				{edge.status === "stale" ? " · stale" : edge.isRetained ? " · weaker evidence" : ""}
			</span>
		</button>
	)
}

function PaperButton({ paper, onClick }: { paper: PaperNode; onClick: () => void }) {
	return (
		<button
			className="block w-full rounded-md border border-border-subtle bg-bg-primary px-3 py-2 text-left transition-colors hover:bg-surface-hover"
			onClick={onClick}
			type="button"
		>
			<span className="block truncate text-sm font-medium text-text-primary">{paper.title}</span>
			<span className="mt-0.5 block truncate text-xs text-text-tertiary">
				{paper.conceptCount} concepts · degree {paper.degree}
			</span>
		</button>
	)
}

function PaperEdgeCard({
	edge,
	papersById,
	onSelect,
}: {
	edge: PaperEdge
	papersById: Map<string, PaperNode>
	onSelect: (selection: Selection) => void
}) {
	const source = papersById.get(edge.source)
	const target = papersById.get(edge.target)
	const evidenceRows = sortedPaperEvidence(edge.topEvidence)
	return (
		<div className="mt-3 rounded-lg border border-border-subtle bg-bg-primary p-3">
			<div className="text-sm font-medium text-text-primary">
				{source?.title ?? "Paper"} / {target?.title ?? "Paper"}
			</div>
			<div className="mt-1 text-xs leading-5 text-text-tertiary">
				{formatPaperEdgeKind(edge.edgeKind)} · {edge.evidenceCount} evidence ·{" "}
				{edge.strongEvidenceCount} strong · strength {formatPercent(edge.weight)}
				{edge.status === "stale" ? " · stale" : edge.isRetained ? " · weaker evidence" : ""}
				{edge.hasReaderNoteEvidence ? " · reader note" : ""}
			</div>
			<div className="mt-3 flex flex-wrap gap-2">
				{source ? (
					<button
						className="rounded-md border border-border-subtle px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-hover"
						onClick={() => onSelect({ kind: "node", id: source.id })}
						type="button"
					>
						Source paper
					</button>
				) : null}
				{target ? (
					<button
						className="rounded-md border border-border-subtle px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-hover"
						onClick={() => onSelect({ kind: "node", id: target.id })}
						type="button"
					>
						Target paper
					</button>
				) : null}
			</div>
			<div className="mt-3 space-y-2">
				{evidenceRows.map((evidence) => (
					<div
						className="rounded-md border border-border-subtle bg-bg-secondary px-2.5 py-2 text-xs"
						key={`${evidence.sourceConceptId}:${evidence.targetConceptId}:${evidence.matchMethod}`}
					>
						<div className="font-medium text-text-primary">
							{evidence.sourceConceptName} / {evidence.targetConceptName}
						</div>
						<div className="mt-0.5 text-text-tertiary">
							{evidence.kind} · {evidence.matchMethod} · {formatPercent(evidence.similarityScore)}
							{evidence.llmDecision ? ` · LLM: ${evidence.llmDecision}` : ""}
							{evidence.llmConfidence != null
								? ` · confidence ${formatPercent(evidence.llmConfidence)}`
								: ""}
							{evidence.decisionStatus === "candidate" || evidence.decisionStatus === "needs_review"
								? " · suggested"
								: ""}
							{evidence.sourceHasReaderNoteEvidence || evidence.targetHasReaderNoteEvidence
								? " · reader note"
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
							<div className="mt-2 line-clamp-2 text-text-secondary">{evidence.rationale}</div>
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
				<div className="mt-2 rounded-md border border-border-subtle bg-bg-secondary px-2 py-1.5 leading-5 text-text-secondary">
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
			className="rounded-md border border-border-subtle px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
			params={{ paperId }}
			search={{ blockId }}
			to="/papers/$paperId"
		>
			{label}
		</Link>
	)
}

function InspectorSection({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div className="mt-5">
			<div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">{title}</div>
			<div className="mt-2 space-y-2">{children}</div>
		</div>
	)
}

function EmptyInspectorLine({ children }: { children: ReactNode }) {
	return (
		<div className="rounded-md border border-border-subtle bg-bg-primary px-3 py-2 text-xs text-text-secondary">
			{children}
		</div>
	)
}

function GraphLoadingState({ label }: { label: string }) {
	return (
		<div className="flex h-full min-h-0 flex-col bg-bg-primary">
			<div className="border-b border-border-subtle bg-[var(--color-reading-bg)] px-4 py-3">
				<div className="h-5 w-28 animate-pulse rounded bg-surface-hover" />
				<div className="mt-2 h-4 w-80 max-w-full animate-pulse rounded bg-surface-hover" />
			</div>
			<div className="min-h-0 flex-1 p-3 lg:p-4">
				<div className="relative h-full min-h-[24rem] rounded-lg border border-border-subtle bg-[var(--color-reading-bg)] p-4">
					<div className="h-full min-h-[22rem] animate-pulse rounded-md bg-surface-hover" />
					<div className="absolute top-7 left-7 rounded-md border border-border-subtle bg-bg-primary/90 px-3 py-2 text-sm text-text-tertiary shadow-[var(--shadow-sm)]">
						{label}
					</div>
				</div>
			</div>
		</div>
	)
}

function GraphEmptyState({ variant }: { variant: "papers" | "links" }) {
	const copy =
		variant === "papers"
			? {
					title: "Your paper map is still forming.",
					body: "Upload and compile at least two papers. Sapientia will connect them once enough concept evidence exists.",
				}
			: {
					title: "Papers are ready, but links are not strong enough yet.",
					body: "Read, annotate, and compile more papers. Links appear when shared concepts or semantic evidence become reliable.",
				}
	return (
		<div className="flex h-full min-h-[28rem] items-center justify-center bg-bg-primary p-8">
			<div className="max-w-md rounded-lg border border-border-subtle bg-bg-secondary p-6 text-center shadow-[var(--shadow-sm)]">
				<div className="text-sm font-medium text-text-primary">{copy.title}</div>
				<p className="mt-2 text-sm leading-6 text-text-secondary">{copy.body}</p>
			</div>
		</div>
	)
}

function GraphErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
	return (
		<div className="flex h-full min-h-[28rem] items-center justify-center bg-bg-primary p-8">
			<div className="max-w-md rounded-lg border border-border-subtle bg-bg-secondary p-6 text-center shadow-[var(--shadow-sm)]">
				<div className="text-sm font-medium text-text-primary">Paper map failed to load.</div>
				<p className="mt-2 text-sm leading-6 text-text-secondary">{errorMessage(error)}</p>
				<button
					className="mt-4 rounded-md border border-border-subtle bg-bg-primary px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
					onClick={onRetry}
					type="button"
				>
					Retry
				</button>
			</div>
		</div>
	)
}

function filterPaperGraphByKinds(data: PaperGraphPayload, activeEdgeKinds: Set<PaperEdgeKind>) {
	const edges = data.graph.edges.filter((edge) => activeEdgeKinds.has(edge.edgeKind))
	return {
		...data,
		graph: {
			...data.graph,
			edgeCount: edges.length,
			edges,
		},
	} satisfies PaperGraphPayload
}

function toggleEdgeKind(current: Set<PaperEdgeKind>, kind: PaperEdgeKind) {
	const next = new Set(current)
	if (next.has(kind)) next.delete(kind)
	else next.add(kind)
	return next
}

function buildPaperSigmaGraph(
	data: PaperGraphPayload,
	colors: { paper: string; fallback: string; edgeDefault: string },
	sizing: {
		edgeMinWidth: number
		edgeMaxWidth: number
		nodeMinRadius: number
		nodeMaxRadius: number
	},
): PaperSigmaGraph {
	const graph = new Graph<SigmaNodeAttributes, SigmaEdgeAttributes>({
		multi: true,
		type: "undirected",
	})
	const layout = computePaperForceLayout(data)
	const topLabelNodeIds = new Set(
		[...data.graph.nodes]
			.sort((a, b) => b.degree + b.conceptCount / 10 - (a.degree + a.conceptCount / 10))
			.slice(0, 8)
			.map((node) => node.id),
	)

	for (const node of data.graph.nodes) {
		const weight = Math.max(node.degree, node.conceptCount / 10)
		const position = layout.get(node.id) ?? { x: 0, y: 0 }
		graph.addNode(node.id, {
			x: position.x,
			y: position.y,
			size: clampSize(6 + Math.sqrt(weight + 1) * 2.7, sizing.nodeMinRadius, sizing.nodeMaxRadius),
			label: topLabelNodeIds.has(node.id) ? shortPaperLabel(node.title) : "",
			title: node.title,
			color: colors.paper,
			baseColor: colors.paper || colors.fallback,
			kind: "paper",
			weight,
			forceLabel: topLabelNodeIds.has(node.id),
			zIndex: Math.round(weight),
		})
	}
	for (const edge of data.graph.edges) {
		if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue
		const edgeColor =
			edge.status === "stale"
				? colorWithAlpha(colors.edgeDefault, 0.3)
				: edge.isRetained
					? colorWithAlpha(colors.edgeDefault, 0.5)
					: colorWithAlpha(colors.edgeDefault, 0.66)
		graph.addUndirectedEdgeWithKey(edge.id, edge.source, edge.target, {
			size: edgeWidthForWeight(edge.weight, sizing.edgeMinWidth, sizing.edgeMaxWidth),
			label: edge.edgeKind,
			color: edgeColor,
			baseColor: edgeColor,
			relationType: edge.edgeKind,
			confidence: edge.weight,
			status: edge.status ?? "active",
			type: "curved",
			curvature: curvatureForEdge(edge.id),
			zIndex: Math.round(edge.weight * 10),
		})
	}

	return graph
}

function computePaperForceLayout(data: PaperGraphPayload) {
	const nodes = data.graph.nodes.map((node, index) => {
		const angle = (index / Math.max(data.graph.nodes.length, 1)) * Math.PI * 2
		const radius = 80 + data.graph.nodes.length * 5
		const nodeWeight = Math.max(node.degree, node.conceptCount / 10)
		return {
			id: node.id,
			x: Math.cos(angle) * radius,
			y: Math.sin(angle) * radius,
			radius: 12 + Math.sqrt(nodeWeight + 1) * 3,
		}
	}) satisfies ForceNode[]
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
				.distance(190)
				.strength(0.09),
		)
		.force("charge", forceManyBody().strength(-520))
		.force(
			"collide",
			forceCollide<ForceNode>().radius((node) => node.radius + 30),
		)
		.force("center", forceCenter(0, 0))
		.stop()

	for (let i = 0; i < 180; i += 1) simulation.tick()

	return new Map(nodes.map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]))
}

type ForceNode = SimulationNodeDatum & { id: string; radius: number }
type ForceLink = SimulationLinkDatum<ForceNode>
type PhysicsNode = SimulationNodeDatum & {
	id: string
	radius: number
	fx?: number | null
	fy?: number | null
}
type PhysicsLink = SimulationLinkDatum<PhysicsNode> & { weight: number }
type PaperPhysicsSimulation = {
	pinNode: (nodeId: string, x: number, y: number) => void
	releaseNode: (nodeId: string) => void
	stop: () => void
}

function startPaperPhysicsSimulation(
	data: PaperGraphPayload,
	graph: PaperSigmaGraph,
	renderer: Sigma<SigmaNodeAttributes, SigmaEdgeAttributes>,
): PaperPhysicsSimulation {
	const nodes = data.graph.nodes
		.filter((node) => graph.hasNode(node.id))
		.map<PhysicsNode>((node) => ({
			id: node.id,
			x: graph.getNodeAttribute(node.id, "x"),
			y: graph.getNodeAttribute(node.id, "y"),
			radius: graph.getNodeAttribute(node.id, "size") + 10,
		}))
	const nodesById = new Map(nodes.map((node) => [node.id, node] as const))
	const links = data.graph.edges
		.filter((edge) => nodesById.has(edge.source) && nodesById.has(edge.target))
		.map<PhysicsLink>((edge) => ({
			source: edge.source,
			target: edge.target,
			weight: edge.weight,
		}))

	const simulation = forceSimulation<PhysicsNode>(nodes)
		.alpha(0.8)
		.alphaDecay(0.032)
		.velocityDecay(0.38)
		.force(
			"link",
			forceLink<PhysicsNode, PhysicsLink>(links)
				.id((node) => node.id)
				.distance((link) => 300 - Math.max(0, Math.min(1, link.weight)) * 85)
				.strength((link) => 0.018 + Math.max(0, Math.min(1, link.weight)) * 0.075),
		)
		.force(
			"charge",
			forceManyBody<PhysicsNode>().strength((node) => -380 - Math.min(300, node.radius * 10)),
		)
		.force(
			"collide",
			forceCollide<PhysicsNode>()
				.radius((node) => node.radius + 34)
				.strength(0.92),
		)
		.force("center", forceCenter(0, 0))
		.force("gravity-x", forceX<PhysicsNode>(0).strength(0.006))
		.force("gravity-y", forceY<PhysicsNode>(0).strength(0.006))
		.on("tick", () => {
			for (const node of nodes) {
				if (graph.hasNode(node.id)) {
					graph.setNodeAttribute(node.id, "x", node.x ?? 0)
					graph.setNodeAttribute(node.id, "y", node.y ?? 0)
				}
			}
			renderer.refresh()
		})

	return {
		pinNode: (nodeId, x, y) => {
			const node = nodesById.get(nodeId)
			if (!node) return
			node.fx = x
			node.fy = y
			node.x = x
			node.y = y
			graph.setNodeAttribute(nodeId, "x", x)
			graph.setNodeAttribute(nodeId, "y", y)
			simulation.alphaTarget(0.18).restart()
			renderer.refresh()
		},
		releaseNode: (nodeId) => {
			const node = nodesById.get(nodeId)
			if (!node) return
			node.fx = null
			node.fy = null
			simulation.alphaTarget(0).alpha(0.35).restart()
		},
		stop: () => simulation.stop(),
	}
}

function buildPaperAdjacency(edges: PaperEdge[]) {
	const adjacency = new Map<string, Set<string>>()
	const edgeMap = new Map<string, [string, string]>()
	for (const edge of edges) {
		edgeMap.set(edge.id, [edge.source, edge.target])
		if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set())
		if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set())
		adjacency.get(edge.source)?.add(edge.target)
		adjacency.get(edge.target)?.add(edge.source)
	}
	return { adjacency, edgeMap }
}

function isNodeInFocus(
	nodeId: string,
	active: Selection,
	adjacency: ReturnType<typeof buildPaperAdjacency>,
) {
	if (!active) return true
	if (active.kind === "node") {
		return nodeId === active.id || Boolean(adjacency.adjacency.get(active.id)?.has(nodeId))
	}
	const edge = adjacency.edgeMap.get(active.id)
	return Boolean(edge && (edge[0] === nodeId || edge[1] === nodeId))
}

function isEdgeInFocus(edgeId: string, active: Selection, graph: PaperSigmaGraph) {
	if (!active) return true
	if (active.kind === "edge") return active.id === edgeId
	const [source, target] = graph.extremities(edgeId)
	return source === active.id || target === active.id
}

function sortedPaperEvidence(evidence: PaperEvidence[]) {
	return [...evidence].sort(
		(a, b) =>
			(b.llmConfidence ?? b.similarityScore ?? 0) - (a.llmConfidence ?? a.similarityScore ?? 0),
	)
}

function matchesPaperSearch(paper: PaperNode, normalizedQuery: string) {
	if (!normalizedQuery) return true
	const haystack = [
		paper.title,
		paper.label,
		paper.venue,
		String(paper.year ?? ""),
		...paper.authors,
		...(paper.searchConcepts ?? []).flatMap((concept) => [concept.displayName, concept.kind]),
		...paper.topConcepts.flatMap((concept) => [concept.displayName, concept.kind]),
	]
	return haystack.some((value) => normalizeSearch(value ?? "").includes(normalizedQuery))
}

function matchesEdgeSearch(
	edge: PaperEdge,
	papersById: Map<string, PaperNode>,
	normalizedQuery: string,
) {
	if (!normalizedQuery) return true
	const source = papersById.get(edge.source)
	const target = papersById.get(edge.target)
	if (source && matchesPaperSearch(source, normalizedQuery)) return true
	if (target && matchesPaperSearch(target, normalizedQuery)) return true
	const haystack = [
		formatPaperEdgeKind(edge.edgeKind),
		...edge.kinds,
		...edge.topEvidence.flatMap((evidence) => [
			evidence.sourceConceptName,
			evidence.targetConceptName,
			evidence.matchMethod,
			evidence.llmDecision ?? "",
			evidence.rationale ?? "",
		]),
	]
	return haystack.some((value) => normalizeSearch(value).includes(normalizedQuery))
}

function resetSigmaCamera(renderer: Sigma<SigmaNodeAttributes, SigmaEdgeAttributes> | null) {
	if (!renderer) return
	const camera = (
		renderer as unknown as {
			getCamera?: () => {
				animatedReset?: (options?: { duration?: number }) => void
				setState?: (state: { x: number; y: number; ratio: number }) => void
			}
		}
	).getCamera?.()
	if (camera?.animatedReset) {
		camera.animatedReset({ duration: 220 })
		return
	}
	camera?.setState?.({ x: 0, y: 0, ratio: 1 })
}

function edgeWidthForWeight(weight: number, min: number, max: number) {
	return clampSize(min + (max - min) * Math.max(0, Math.min(1, weight)), min, max)
}

function curvatureForEdge(edgeId: string) {
	let hash = 0
	for (let index = 0; index < edgeId.length; index += 1) {
		hash = (hash * 31 + edgeId.charCodeAt(index)) >>> 0
	}
	const sign = hash % 2 === 0 ? 1 : -1
	return sign * (0.14 + (hash % 3) * 0.025)
}

function clampSize(value: number, min: number, max: number) {
	return Math.min(Math.max(value, min), max)
}

function formatPercent(value: number | null) {
	if (value == null) return "n/a"
	return `${Math.round(value * 100)}%`
}

function formatPaperEdgeKind(kind: PaperEdgeKind) {
	if (kind === "shared_concepts") return "shared concepts"
	if (kind === "similar_methods") return "similar methods"
	if (kind === "same_task") return "same task"
	if (kind === "related_metrics") return "related metrics"
	if (kind === "semantic_neighbor") return "semantic neighbor"
	return "mixed evidence"
}

function shortPaperLabel(title: string) {
	const normalized = title.replace(/\s+/g, " ").trim()
	return normalized.length <= 34 ? normalized : `${normalized.slice(0, 31)}...`
}

function normalizeSearch(value: string) {
	return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function colorWithAlpha(color: string, alpha: number) {
	const resolved = resolveCssColor(color, color)
	if (resolved.startsWith("rgb(")) return resolved.replace("rgb(", "rgba(").replace(")", `, ${alpha})`)
	if (resolved.startsWith("rgba(")) {
		return resolved.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, `rgba($1,$2,$3, ${alpha})`)
	}
	return resolved
}

function errorMessage(error: unknown) {
	if (error instanceof Error && error.message) return error.message
	return "The graph request failed. Try again in a moment."
}

function cssColorVar(name: string, fallback: string) {
	if (typeof document === "undefined") return fallback
	return resolveCssColor(`var(${name})`, fallback)
}

function resolveCssColor(color: string, fallback: string) {
	if (typeof document === "undefined") return fallback
	const probe = document.createElement("span")
	probe.style.color = color
	probe.style.display = "none"
	document.body.appendChild(probe)
	const value = getComputedStyle(probe).color
	probe.remove()
	if (!value) return fallback
	if (value.startsWith("rgb(") || value.startsWith("rgba(") || value.startsWith("#")) return value
	return fallback
}

function cssNumberVar(style: CSSStyleDeclaration, name: string, fallback: number) {
	const value = style.getPropertyValue(name).trim()
	const number = Number.parseFloat(value)
	return Number.isFinite(number) ? number : fallback
}
