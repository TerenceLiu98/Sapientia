import cytoscape, { type Core, type ElementDefinition, type EventObject } from "cytoscape"
import type React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { ApiError } from "@/api/client"
import { type PaperConceptGraphPayload, usePaperConceptGraph } from "@/api/hooks/papers"

interface PaperConceptGraphPanelProps {
	paperId: string
	workspaceId: string | undefined
	onOpenBlock: (blockId: string) => void
}

type Selection = { kind: "node"; id: string } | { kind: "edge"; id: string } | null

export function PaperConceptGraphPanel({
	paperId,
	workspaceId,
	onOpenBlock,
}: PaperConceptGraphPanelProps) {
	const [isOpen, setIsOpen] = useState(false)
	const [selection, setSelection] = useState<Selection>(null)
	const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(() => new Set())
	const [hiddenRelations, setHiddenRelations] = useState<Set<string>>(() => new Set())
	const graphQuery = usePaperConceptGraph(workspaceId, paperId)
	const data = graphQuery.data
	const notFound = graphQuery.error instanceof ApiError && graphQuery.error.status === 404
	const filteredData = useMemo(
		() => filterGraph(data, hiddenKinds, hiddenRelations),
		[data, hiddenKinds, hiddenRelations],
	)

	if (!workspaceId) return null

	const summary = data
		? `${data.graph.nodeCount} concepts · ${data.graph.edgeCount} links`
		: notFound
			? "Graph is not compiled yet"
			: graphQuery.isLoading
				? "Loading graph…"
				: graphQuery.error
					? "Graph failed to load"
					: "Concept graph"

	return (
		<section className="mb-3 overflow-hidden rounded-lg border border-border-subtle bg-[color-mix(in_srgb,var(--color-reading-bg)_78%,var(--color-bg-secondary))] shadow-[var(--shadow-sm)]">
			<div className="flex items-center justify-between gap-3 px-4 py-2.5">
				<div className="min-w-0">
					<div className="text-[11px] uppercase tracking-[0.18em] text-text-tertiary">
						Concept Graph
					</div>
					<div className="truncate text-sm text-text-secondary">{summary}</div>
				</div>
				<button
					aria-expanded={isOpen}
					className="rounded-md border border-border-default bg-bg-primary px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
					onClick={() => setIsOpen((open) => !open)}
					type="button"
				>
					{isOpen ? "Hide" : "Show"}
				</button>
			</div>
			{isOpen ? (
				<div className="space-y-3 border-t border-border-subtle p-3">
					<GraphFilters
						data={data}
						hiddenKinds={hiddenKinds}
						hiddenRelations={hiddenRelations}
						onToggleKind={(kind) => {
							setHiddenKinds((current) => toggleSetValue(current, kind))
							setSelection(null)
						}}
						onToggleRelation={(relation) => {
							setHiddenRelations((current) => toggleSetValue(current, relation))
							setSelection(null)
						}}
					/>
					<div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
						<GraphCanvas
							data={filteredData}
							isLoading={graphQuery.isLoading}
							onSelect={setSelection}
						/>
						<GraphInspector
							data={filteredData}
							onOpenBlock={onOpenBlock}
							onSelect={setSelection}
							selection={selection}
						/>
					</div>
				</div>
			) : null}
		</section>
	)
}

function GraphFilters({
	data,
	hiddenKinds,
	hiddenRelations,
	onToggleKind,
	onToggleRelation,
}: {
	data: PaperConceptGraphPayload | undefined
	hiddenKinds: Set<string>
	hiddenRelations: Set<string>
	onToggleKind: (kind: string) => void
	onToggleRelation: (relation: string) => void
}) {
	if (!data || data.graph.nodes.length === 0) return null

	const kinds = [...new Set(data.graph.nodes.map((node) => node.kind))].sort()
	const relations = [...new Set(data.graph.edges.map((edge) => edge.relationType))].sort()

	return (
		<div className="flex flex-wrap items-center gap-1.5">
			<span className="mr-1 text-[11px] uppercase tracking-[0.16em] text-text-tertiary">
				Filter
			</span>
			{kinds.map((kind) => {
				const active = !hiddenKinds.has(kind)
				return (
					<button
						aria-pressed={active}
						className={filterChipClass(active)}
						key={kind}
						onClick={() => onToggleKind(kind)}
						type="button"
					>
						{kind}
					</button>
				)
			})}
			{relations.length > 0 ? (
				<span aria-hidden="true" className="mx-1 h-4 w-px bg-border-subtle" />
			) : null}
			{relations.map((relation) => {
				const active = !hiddenRelations.has(relation)
				return (
					<button
						aria-pressed={active}
						className={filterChipClass(active)}
						key={relation}
						onClick={() => onToggleRelation(relation)}
						type="button"
					>
						{relation}
					</button>
				)
			})}
		</div>
	)
}

function GraphCanvas({
	data,
	isLoading,
	onSelect,
}: {
	data: PaperConceptGraphPayload | undefined
	isLoading: boolean
	onSelect: (selection: Selection) => void
}) {
	const containerRef = useRef<HTMLDivElement | null>(null)

	useEffect(() => {
		const container = containerRef.current
		if (!container || !data || data.graph.nodes.length === 0) return undefined

		const computedStyle = getComputedStyle(document.documentElement)
		const textPrimary = cssVar(computedStyle, "--color-text-primary", "#2f2a24")
		const textSecondary = cssVar(computedStyle, "--color-text-secondary", "#5f574e")
		const edgeDefault = cssVar(computedStyle, "--graph-edge-default", "rgba(100, 92, 82, 0.45)")

		const cy: Core = cytoscape({
			container,
			elements: buildGraphElements(data),
			style: [
				{
					selector: "node",
					style: {
						"background-color": "#2f7f8f",
						"border-color": "rgba(255,255,255,0.82)",
						"border-width": "1px",
						color: textPrimary,
						content: "data(label)",
						"font-size": "10px",
						height: "mapData(weight, 0, 8, 20, 44)",
						"text-background-color": "rgba(255,255,255,0.74)",
						"text-background-opacity": 1,
						"text-background-padding": "2px",
						"text-max-width": "104px",
						"text-valign": "bottom",
						"text-wrap": "wrap",
						width: "mapData(weight, 0, 8, 20, 44)",
					},
				},
				{ selector: 'node[kind = "method"]', style: { "background-color": "#8b6f47" } },
				{ selector: 'node[kind = "task"]', style: { "background-color": "#9a624f" } },
				{ selector: 'node[kind = "metric"]', style: { "background-color": "#7f7a72" } },
				{
					selector: "node:selected",
					style: {
						"border-color": "#2f2a24",
						"border-width": "2px",
					},
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
				{
					selector: "edge:selected",
					style: {
						"line-color": "#2f2a24",
						"target-arrow-color": "#2f2a24",
						width: 3,
					},
				},
			],
			layout: {
				name: "cose",
				animate: false,
				fit: true,
				padding: 32,
			},
			maxZoom: 2.5,
			minZoom: 0.35,
			wheelSensitivity: 0.25,
		})

		cy.on("tap", "node", (event: EventObject) => {
			const id = event.target.data("id")
			if (typeof id === "string") onSelect({ kind: "node", id })
		})
		cy.on("tap", "edge", (event: EventObject) => {
			const id = event.target.data("id")
			if (typeof id === "string") onSelect({ kind: "edge", id })
		})
		cy.on("tap", (event: EventObject) => {
			if (event.target === cy) onSelect(null)
		})

		return () => {
			cy.destroy()
		}
	}, [data, onSelect])

	if (isLoading) {
		return <GraphEmptyState>Loading graph…</GraphEmptyState>
	}

	if (!data || data.graph.nodes.length === 0) {
		return <GraphEmptyState>No concept graph yet.</GraphEmptyState>
	}

	return (
		<div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-primary/80">
			<div
				aria-label="Paper concept graph"
				className="h-[22rem] w-full"
				ref={containerRef}
				role="img"
			/>
		</div>
	)
}

function GraphInspector({
	data,
	selection,
	onOpenBlock,
	onSelect,
}: {
	data: PaperConceptGraphPayload | undefined
	selection: Selection
	onOpenBlock: (blockId: string) => void
	onSelect: (selection: Selection) => void
}) {
	const selected = useMemo(() => {
		if (!data || !selection) return null
		if (selection.kind === "node") {
			return {
				title: data.graph.nodes.find((node) => node.id === selection.id)?.label ?? "Concept",
				meta: data.graph.nodes.find((node) => node.id === selection.id)?.kind ?? "node",
				blockIds: data.graph.nodes.find((node) => node.id === selection.id)?.evidenceBlockIds ?? [],
			}
		}
		const edge = data.graph.edges.find((candidate) => candidate.id === selection.id)
		if (!edge) return null
		const source = data.graph.nodes.find((node) => node.id === edge.source)?.label ?? edge.source
		const target = data.graph.nodes.find((node) => node.id === edge.target)?.label ?? edge.target
		return {
			title: `${source} → ${target}`,
			meta: edge.relationType,
			blockIds: edge.evidenceBlockIds,
		}
	}, [data, selection])
	const topNodes = useMemo(
		() =>
			[...(data?.graph.nodes ?? [])]
				.sort((a, b) => b.degree + b.salienceScore - (a.degree + a.salienceScore))
				.slice(0, 6),
		[data],
	)

	if (!data) {
		return (
			<div className="rounded-lg border border-border-subtle bg-bg-primary/70 p-3 text-sm text-text-tertiary">
				The graph will appear after paper compilation finishes.
			</div>
		)
	}

	return (
		<aside className="rounded-lg border border-border-subtle bg-bg-primary/80 p-3">
			<div className="text-[11px] uppercase tracking-[0.18em] text-text-tertiary">
				Graph Evidence
			</div>
			<div className="mt-2 text-sm font-medium text-text-primary">
				{selected?.title ?? "Select a node or edge"}
			</div>
			<div className="mt-1 text-xs text-text-tertiary">
				{selected?.meta ?? `${data.graph.nodeCount} concepts · ${data.graph.edgeCount} links`}
			</div>
			{selected ? (
				<div className="mt-3 flex flex-wrap gap-1.5">
					{selected.blockIds.length ? (
						selected.blockIds.map((blockId) => (
							<EvidenceButton blockId={blockId} key={blockId} onOpenBlock={onOpenBlock} />
						))
					) : (
						<span className="text-xs text-text-tertiary">No evidence blocks on this item.</span>
					)}
				</div>
			) : (
				<div className="mt-3 space-y-2">
					<div className="text-[11px] uppercase tracking-[0.16em] text-text-tertiary">
						Top Concepts
					</div>
					{topNodes.length > 0 ? (
						topNodes.map((node) => (
							<button
								className="block w-full rounded-lg border border-border-subtle bg-bg-secondary px-2.5 py-2 text-left transition-colors hover:bg-surface-hover"
								key={node.id}
								onClick={() => onSelect({ kind: "node", id: node.id })}
								type="button"
							>
								<span className="block truncate text-xs font-medium text-text-primary">
									{node.label}
								</span>
								<span className="mt-0.5 block text-[11px] text-text-tertiary">
									{node.kind} · degree {node.degree}
								</span>
							</button>
						))
					) : (
						<span className="text-xs text-text-tertiary">
							Turn filters back on to inspect concepts.
						</span>
					)}
				</div>
			)}
		</aside>
	)
}

function EvidenceButton({
	blockId,
	onOpenBlock,
}: {
	blockId: string
	onOpenBlock: (blockId: string) => void
}) {
	return (
		<button
			className="rounded-full border border-border-default bg-bg-secondary px-2 py-0.5 text-[11px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
			onClick={() => onOpenBlock(blockId)}
			type="button"
		>
			{blockId}
		</button>
	)
}

function GraphEmptyState({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex h-[22rem] items-center justify-center rounded-lg border border-border-subtle bg-bg-primary/70 text-sm text-text-tertiary">
			{children}
		</div>
	)
}

function buildGraphElements(data: PaperConceptGraphPayload): ElementDefinition[] {
	const nodes: ElementDefinition[] = data.graph.nodes.map((node) => ({
		data: {
			id: node.id,
			kind: node.kind,
			label: node.label,
			weight: Math.max(node.degree, node.salienceScore ?? 0),
		},
	}))

	const edges: ElementDefinition[] = data.graph.edges.map((edge) => ({
		data: {
			id: edge.id,
			label: edge.relationType,
			source: edge.source,
			target: edge.target,
			confidence: edge.confidence ?? 0.5,
		},
	}))

	return [...nodes, ...edges]
}

function filterChipClass(active: boolean) {
	return [
		"rounded-full border px-2 py-0.5 text-[11px] transition-colors",
		active
			? "border-border-default bg-bg-primary text-text-secondary hover:bg-surface-hover hover:text-text-primary"
			: "border-border-subtle bg-bg-secondary/50 text-text-tertiary opacity-70 hover:opacity-100",
	].join(" ")
}

function toggleSetValue(current: Set<string>, value: string) {
	const next = new Set(current)
	if (next.has(value)) {
		next.delete(value)
	} else {
		next.add(value)
	}
	return next
}

function filterGraph(
	data: PaperConceptGraphPayload | undefined,
	hiddenKinds: Set<string>,
	hiddenRelations: Set<string>,
) {
	if (!data) return undefined

	const nodes = data.graph.nodes.filter((node) => !hiddenKinds.has(node.kind))
	const nodeIds = new Set(nodes.map((node) => node.id))
	const edges = data.graph.edges.filter(
		(edge) =>
			nodeIds.has(edge.source) &&
			nodeIds.has(edge.target) &&
			!hiddenRelations.has(edge.relationType),
	)
	const relationCounts = edges.reduce<PaperConceptGraphPayload["graph"]["relationCounts"]>(
		(counts, edge) => {
			counts[edge.relationType] = (counts[edge.relationType] ?? 0) + 1
			return counts
		},
		{},
	)

	return {
		...data,
		graph: {
			...data.graph,
			nodeCount: nodes.length,
			edgeCount: edges.length,
			relationCounts,
			nodes,
			edges,
		},
	}
}

function cssVar(style: CSSStyleDeclaration, name: string, fallback: string) {
	const value = style.getPropertyValue(name).trim()
	return value || fallback
}
