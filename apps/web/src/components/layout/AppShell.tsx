import type { ReactNode } from "react"
import { useState } from "react"
import { LeftNav } from "./LeftNav"
import { RightPanel } from "./RightPanel"
import { TopBar } from "./TopBar"

// AppShell uses `h-screen` (not min-h-screen) so the page is exactly one
// viewport tall. The main slot inherits `min-h-0` and is responsible for
// its own scrolling: list pages opt in via `overflow-y-auto`, reader
// pages keep `overflow-hidden` and let an inner viewer scroll. Without
// this, nested overflow-auto containers (PDF viewer, blocks panel) end
// up scrolling the whole document instead of themselves.
export function AppShell(props: { title: string; children: ReactNode }) {
	const [isAgentPanelOpen, setIsAgentPanelOpen] = useState(false)

	return (
		<div
			className={`h-screen overflow-hidden bg-bg-primary lg:grid lg:grid-rows-[var(--shell-header-height)_minmax(0,1fr)] ${
				isAgentPanelOpen
					? "lg:grid-cols-[var(--shell-nav-width-expanded)_minmax(0,1fr)_var(--shell-rightpanel-width)]"
					: "lg:grid-cols-[var(--shell-nav-width-expanded)_minmax(0,1fr)]"
			}`}
		>
			<header
				className={`border-b border-border-subtle lg:row-start-1 ${
					isAgentPanelOpen ? "lg:col-span-3" : "lg:col-span-2"
				}`}
			>
				<TopBar
					isAgentPanelOpen={isAgentPanelOpen}
					onToggleAgentPanel={() => setIsAgentPanelOpen((open) => !open)}
					title={props.title}
				/>
			</header>

			<aside className="hidden overflow-y-auto border-r border-border-subtle bg-bg-secondary lg:col-start-1 lg:row-start-2 lg:block">
				<LeftNav />
			</aside>

			<main className="min-h-0 min-w-0 overflow-hidden bg-bg-primary lg:col-start-2 lg:row-start-2">
				{props.children}
			</main>

			{isAgentPanelOpen ? (
				<aside className="hidden overflow-y-auto border-l border-border-subtle bg-bg-secondary lg:col-start-3 lg:row-start-2 lg:block">
					<RightPanel />
				</aside>
			) : null}
		</div>
	)
}
