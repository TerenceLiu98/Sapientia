import { Link } from "@tanstack/react-router"
import { ExternalLink, Search, X } from "lucide-react"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import ForceGraph3D from "react-force-graph-3d"
import type { ForceGraphMethods, GraphData, LinkObject, NodeObject } from "react-force-graph-3d"
import { type PaperGraphPayload, useWorkspaceGraph } from "@/api/hooks/graph"
import type { Workspace } from "@/api/hooks/workspaces"

type Selection = { kind: "node"; id: string } | { kind: "edge"; id: string } | null
type PaperEdgeKind = PaperGraphPayload["graph"]["edges"][number]["edgeKind"]
type PaperNode = PaperGraphPayload["graph"]["nodes"][number]
type PaperEdge = PaperGraphPayload["graph"]["edges"][number]
type PaperEvidence = PaperEdge["topEvidence"][number]

type Paper3DNode = NodeObject<{
	id: string
	paper: PaperNode
	label: string
	value: number
	depth: number
}>
type Paper3DLink = LinkObject<Paper3DNode, { id: string; edge: PaperEdge }>
type Paper3DGraphData = GraphData<Paper3DNode, Paper3DLink>

export function WorkspaceGraphView({ workspace }: { workspace: Workspace | undefined }) {
	const [selection, setSelection] = useState<Selection>(null)
	const [searchQuery, setSearchQuery] = useState("")
	const graphQuery = useWorkspaceGraph(workspace?.id, "papers")
	const data = graphQuery.data

	const paperData = data?.view === "papers" ? data : null

	useEffect(() => {
		if (!selection || !paperData) return
		if (
			selection.kind === "edge" &&
			!paperData.graph.edges.some((edge) => edge.id === selection.id)
		) {
			setSelection(null)
		}
		if (
			selection.kind === "node" &&
			!paperData.graph.nodes.some((node) => node.id === selection.id)
		) {
			setSelection(null)
		}
	}, [paperData, selection])

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

	return (
		<div className="flex h-full min-h-0 flex-col bg-bg-primary">
			<div className="min-h-0 flex-1 p-3 lg:p-4">
				<section className="relative h-full min-h-[24rem] overflow-hidden rounded-lg border border-border-subtle bg-[var(--color-reading-bg)]">
					<WorkspaceGraphCanvas
						data={paperData}
						onSelect={setSelection}
						selection={selection}
					/>
					<GraphCanvasPanels
						data={paperData}
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

function WorkspaceGraphCanvas({
	data,
	selection,
	onSelect,
}: {
	data: PaperGraphPayload
	selection: Selection
	onSelect: (selection: Selection) => void
}) {
	const containerRef = useRef<HTMLDivElement | null>(null)
	const graphRef = useRef<ForceGraphMethods<any, any> | undefined>(undefined)
	const initialFitDoneRef = useRef(false)
	const [canvasSize, setCanvasSize] = useState({ width: 960, height: 640 })
	const [hoverSelection, setHoverSelection] = useState<Selection>(null)

	useEffect(() => {
		const container = containerRef.current
		if (!container) return undefined

		const measure = () => {
			setCanvasSize({
				width: Math.max(container.clientWidth, 320),
				height: Math.max(container.clientHeight, 384),
			})
		}
		measure()

		if (typeof ResizeObserver === "undefined") {
			window.addEventListener("resize", measure)
			return () => window.removeEventListener("resize", measure)
		}

		const observer = new ResizeObserver(measure)
		observer.observe(container)
		return () => observer.disconnect()
	}, [])

	const graphData = useMemo(() => buildPaper3DGraphData(data), [data])
	const adjacency = useMemo(() => buildPaperAdjacency(data.graph.edges), [data.graph.edges])
	const activeSelection = selection ?? hoverSelection
	const edgeMinWidth = cssNumberVar("--graph-edge-width-min", 0.5)
	const edgeMaxWidth = cssNumberVar("--graph-edge-width-max", 3)
	const colors = {
		node: cssColorVar("--graph-node-source", "rgb(0, 78, 80)"),
		nodeActive: cssColorVar("--graph-node-source-active", "rgb(0, 101, 103)"),
		nodeFar: cssColorVar("--graph-node-source-muted", "rgb(0, 58, 60)"),
		mutedNode: cssColorVar("--color-border-strong", "rgb(135, 126, 114)"),
		edge: cssColorVar("--graph-edge-default", "rgb(34, 34, 34)"),
		edgeActive: cssColorVar("--graph-edge-active", "rgb(18, 18, 18)"),
	}

	useEffect(() => {
		const graph = graphRef.current
		if (!graph) return
		const linkForce = graph.d3Force("link") as
			| {
					distance?: (value: number | ((link: Paper3DLink) => number)) => unknown
					strength?: (value: number | ((link: Paper3DLink) => number)) => unknown
			  }
			| undefined
		linkForce?.distance?.((link) => 380 - Math.max(0, Math.min(1, link.edge.weight)) * 110)
		linkForce?.strength?.((link) => 0.012 + Math.max(0, Math.min(1, link.edge.weight)) * 0.05)
		const chargeForce = graph.d3Force("charge") as
			| { strength?: (value: number | ((node: Paper3DNode) => number)) => unknown }
			| undefined
		chargeForce?.strength?.((node) => -230 - Math.min(360, paper3DNodeValue(node.paper) * 18))
		graph.d3ReheatSimulation()
	}, [graphData])

	return (
		<div
			aria-label="Workspace graph"
			className="h-full min-h-[24rem] bg-[var(--graph-canvas-bg)] [background-image:linear-gradient(color-mix(in_srgb,var(--color-border-subtle)_24%,transparent)_1px,transparent_1px),linear-gradient(90deg,color-mix(in_srgb,var(--color-border-subtle)_24%,transparent)_1px,transparent_1px)] [background-size:48px_48px]"
			ref={containerRef}
			role="img"
		>
			<ForceGraph3D
				backgroundColor="rgba(0,0,0,0)"
				cooldownTicks={180}
				d3AlphaDecay={0.022}
				d3VelocityDecay={0.28}
				enableNodeDrag
				enablePointerInteraction
				forceEngine="d3"
				graphData={graphData}
				height={canvasSize.height}
				linkColor={(link) => paper3DLinkColor(link as Paper3DLink, activeSelection, colors)}
				linkCurvature={(link) =>
					curvatureForEdge((link as Paper3DLink).id, (link as Paper3DLink).edge.weight)
				}
				linkDirectionalParticleColor={(link) =>
					paper3DLinkColor(link as Paper3DLink, activeSelection, colors)
				}
				linkDirectionalParticles={(link) =>
					activeSelection?.kind === "edge" && activeSelection.id === (link as Paper3DLink).id
						? 2
						: 0
				}
				linkDirectionalParticleSpeed={0.004}
				linkDirectionalParticleWidth={(link) =>
					activeSelection?.kind === "edge" && activeSelection.id === (link as Paper3DLink).id
						? 1.4
						: 0
				}
				linkHoverPrecision={6}
				linkLabel={(link) =>
					`${formatPaperEdgeKind((link as Paper3DLink).edge.edgeKind)} · strength ${formatPercent((link as Paper3DLink).edge.weight)}`
				}
				linkOpacity={1}
				linkWidth={(link) =>
					paper3DLinkWidth(link as Paper3DLink, activeSelection, edgeMinWidth, edgeMaxWidth)
				}
				nodeColor={(node) => paper3DNodeColor(node, activeSelection, adjacency, colors)}
				nodeLabel={(node) => node.paper.title}
				nodeOpacity={0.96}
				nodeRelSize={4}
				nodeResolution={16}
				nodeVal={(node) => paper3DNodeValue(node.paper)}
				numDimensions={3}
				onBackgroundClick={() => onSelect(null)}
				onEngineStop={() => {
					if (initialFitDoneRef.current) return
					initialFitDoneRef.current = true
					graphRef.current?.zoomToFit(650, 80)
				}}
				onLinkClick={(link) => onSelect({ kind: "edge", id: (link as Paper3DLink).id })}
				onLinkHover={(link) =>
					setHoverSelection(link ? { kind: "edge", id: (link as Paper3DLink).id } : null)
				}
				onNodeClick={(node) => onSelect({ kind: "node", id: node.id })}
				onNodeHover={(node) =>
					setHoverSelection(node ? { kind: "node", id: node.id } : null)
				}
				ref={graphRef}
				showNavInfo={false}
				showPointerCursor
				width={canvasSize.width}
				warmupTicks={80}
			/>
		</div>
	)
}

function GraphLegend() {
	return (
		<div className="pointer-events-none absolute right-3 bottom-3 flex items-center gap-3 rounded-full border border-border-subtle bg-bg-primary/78 px-2.5 py-1.5 text-[11px] text-text-tertiary shadow-[var(--shadow-sm)] backdrop-blur">
			<div className="flex items-center gap-1.5">
				<span className="h-2.5 w-2.5 rounded-full bg-[rgb(0,78,80)]" />
				<span>paper</span>
			</div>
			<div className="flex items-center gap-1.5">
				<span className="h-px w-5 bg-text-secondary/65" />
				<span>link</span>
			</div>
			<div className="flex items-center gap-1.5">
				<span className="h-2.5 w-2.5 rounded-full bg-border-strong/70" />
				<span>dimmed</span>
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
	const [expanded, setExpanded] = useState(false)

	if (!expanded) {
		return (
			<button
				aria-label="Search papers"
				className="absolute top-3 left-3 z-[var(--z-elevated)] inline-flex h-9 w-9 items-center justify-center rounded-md border border-border-subtle bg-bg-secondary/90 text-text-secondary shadow-[var(--shadow-sm)] backdrop-blur transition-colors hover:bg-surface-hover hover:text-text-primary"
				onClick={() => setExpanded(true)}
				type="button"
			>
				<Search className="h-4 w-4" />
			</button>
		)
	}

	return (
		<div className="absolute top-3 left-3 z-[var(--z-elevated)] w-[min(18rem,calc(100%-1.5rem))] rounded-md border border-border-subtle bg-bg-secondary/95 p-1.5 shadow-[var(--shadow-md)] backdrop-blur">
			<div className="flex items-center gap-1.5">
				<label className="relative block min-w-0 flex-1">
					<span className="sr-only">Search papers</span>
					<Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 text-text-tertiary" />
					<input
						autoFocus
						className="h-8 w-full rounded-md border border-border-subtle bg-bg-primary pr-2 pl-8 text-sm text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-border-strong"
						onChange={(event) => onSearchChange(event.target.value)}
						placeholder="Search"
						type="search"
						value={searchQuery}
					/>
				</label>
				<button
					aria-label="Close search"
					className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-bg-primary text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-primary"
					onClick={() => {
						onSearchChange("")
						setExpanded(false)
					}}
					type="button"
				>
					<X className="h-4 w-4" />
				</button>
			</div>
			{children}
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
		<div className="absolute bottom-3 left-3 z-[var(--z-elevated)] max-h-[min(28rem,calc(100%-2rem))] w-[min(22rem,calc(100%-1.5rem))] overflow-auto rounded-lg border border-border-subtle bg-bg-secondary/95 p-2.5 shadow-[var(--shadow-md)] backdrop-blur md:bottom-4 md:left-4">
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
			<div className="line-clamp-2 text-[13px] leading-5 font-medium text-text-primary">
				{paper.title}
			</div>
			<div className="mt-1 text-[11px] leading-4 text-text-tertiary">
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
							className="rounded-md border border-border-subtle bg-bg-secondary px-2 py-1 text-[10px] text-text-secondary"
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
			<span className="block truncate text-[12px] font-medium text-text-primary">
				{otherPaper?.title ?? "Connected paper"}
			</span>
			<span className="mt-0.5 block text-[10px] leading-4 text-text-tertiary">
				{formatPaperEdgeKind(edge.edgeKind)} · strength {formatPercent(edge.weight)}
				{edge.status === "stale" ? " · stale" : edge.isRetained ? " · weaker evidence" : ""}
				{edge.hasReaderNoteEvidence ? " · reader note" : ""}
			</span>
			{strongestEvidence ? (
				<span className="mt-1 line-clamp-2 block text-[11px] leading-4 text-text-secondary">
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
			<span className="block truncate text-[12px] font-medium text-text-primary">
				{source?.title ?? "Paper"} / {target?.title ?? "Paper"}
			</span>
			<span className="mt-1 block text-[10px] leading-4 text-text-tertiary">
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
			<span className="block truncate text-[12px] font-medium text-text-primary">{paper.title}</span>
			<span className="mt-0.5 block truncate text-[10px] text-text-tertiary">
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
			<div className="line-clamp-2 text-[13px] leading-5 font-medium text-text-primary">
				{source?.title ?? "Paper"} / {target?.title ?? "Paper"}
			</div>
			<div className="mt-1 text-[10px] leading-4 text-text-tertiary">
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
						<div className="text-[12px] font-medium text-text-primary">
							{evidence.sourceConceptName} / {evidence.targetConceptName}
						</div>
						<div className="mt-0.5 text-[10px] leading-4 text-text-tertiary">
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
							<div className="mt-2 line-clamp-2 text-[11px] leading-4 text-text-secondary">
								{evidence.rationale}
							</div>
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
			<div className="line-clamp-1 text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
				{label}
			</div>
			<div className="mt-1 text-[11px] font-medium text-text-primary">{name}</div>
			{description ? (
				<div className="mt-1 line-clamp-3 text-[11px] leading-4 text-text-secondary">
					{description}
				</div>
			) : (
				<div className="mt-1 text-[11px] text-text-tertiary">
					No source-level description yet.
				</div>
			)}
			{snippets.length > 0 ? (
				<div className="mt-2 rounded-md border border-border-subtle bg-bg-secondary px-2 py-1.5 text-[11px] leading-4 text-text-secondary">
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

function buildPaper3DGraphData(data: PaperGraphPayload): Paper3DGraphData {
	const nodeIds = new Set(data.graph.nodes.map((node) => node.id))
	return {
		nodes: data.graph.nodes.map((paper) => ({
			id: paper.id,
			paper,
			label: paper.title,
			value: paper3DNodeValue(paper),
			depth: depthForNode(paper.id),
		})),
		links: data.graph.edges
			.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
			.map((edge) => ({
				id: edge.id,
				source: edge.source,
				target: edge.target,
				edge,
			})),
	}
}

function paper3DNodeValue(paper: PaperNode) {
	return Math.max(1, paper.degree + paper.conceptCount / 8)
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

function paper3DNodeColor(
	node: Paper3DNode,
	active: Selection,
	adjacency: ReturnType<typeof buildPaperAdjacency>,
	colors: {
		node: string
		nodeActive: string
		nodeFar: string
		mutedNode: string
	},
) {
	if (!active) {
		return paperNodeColorForDepth(node.depth, {
			paper: colors.node,
			paperActive: colors.nodeActive,
			paperFar: colors.nodeFar,
		})
	}
	if (!isNodeInFocus(node.id, active, adjacency)) return colorWithAlpha(colors.mutedNode, 0.68)
	if (active.kind === "node" && active.id === node.id) return colors.nodeActive
	return paperNodeColorForDepth(node.depth, {
		paper: colors.node,
		paperActive: colors.nodeActive,
		paperFar: colors.nodeFar,
	})
}

function paper3DLinkColor(
	link: Paper3DLink,
	active: Selection,
	colors: { edge: string; edgeActive: string },
) {
	const baseAlpha = link.edge.status === "stale" ? 0.14 : link.edge.isRetained ? 0.24 : 0.38
	if (!active) return colorWithAlpha(colors.edge, baseAlpha)
	if (!isPaper3DLinkInFocus(link, active)) return colorWithAlpha(colors.edge, 0.1)
	return colorWithAlpha(colors.edgeActive, active.kind === "edge" && active.id === link.id ? 0.72 : 0.52)
}

function paper3DLinkWidth(link: Paper3DLink, active: Selection, min: number, max: number) {
	const base = edgeWidthForWeight(link.edge.weight, min, max)
	if (!active) return link.edge.status === "stale" ? Math.max(min, base * 0.62) : base
	if (!isPaper3DLinkInFocus(link, active)) return Math.max(min, base * 0.56)
	if (active.kind === "edge" && active.id === link.id) return Math.min(max + 0.55, base * 1.5)
	return Math.min(max + 0.25, base * 1.16)
}

function isPaper3DLinkInFocus(link: Paper3DLink, active: Selection) {
	if (!active) return true
	if (active.kind === "edge") return active.id === link.id
	const source = graphEndpointId(link.source)
	const target = graphEndpointId(link.target)
	return source === active.id || target === active.id
}

function graphEndpointId(endpoint: Paper3DLink["source"] | Paper3DLink["target"]) {
	if (typeof endpoint === "string" || typeof endpoint === "number") return String(endpoint)
	if (endpoint && typeof endpoint === "object") return String(endpoint.id)
	return ""
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

function edgeWidthForWeight(weight: number, min: number, max: number) {
	return clampSize(min + (max - min) * Math.max(0, Math.min(1, weight)), min, max)
}

function depthForNode(nodeId: string) {
	let hash = 0
	for (let index = 0; index < nodeId.length; index += 1) {
		hash = (hash * 33 + nodeId.charCodeAt(index)) >>> 0
	}
	return ((hash % 1000) / 1000) * 2 - 1
}

function paperNodeColorForDepth(
	depth: number,
	colors: { paper: string; paperActive: string; paperFar: string },
) {
	if (depth > 0.45) return colors.paperActive
	if (depth < -0.45) return colors.paperFar
	return colors.paper
}

function curvatureForEdge(edgeId: string, weight: number) {
	let hash = 0
	for (let index = 0; index < edgeId.length; index += 1) {
		hash = (hash * 31 + edgeId.charCodeAt(index)) >>> 0
	}
	const sign = hash % 2 === 0 ? 1 : -1
	return sign * (0.18 + (hash % 4) * 0.028 + (1 - Math.max(0, Math.min(1, weight))) * 0.035)
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

function cssNumberVar(name: string, fallback: number) {
	if (typeof document === "undefined") return fallback
	const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
	const number = Number.parseFloat(value)
	return Number.isFinite(number) ? number : fallback
}
