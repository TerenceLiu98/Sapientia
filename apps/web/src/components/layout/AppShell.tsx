import type { ReactNode } from "react"
import { useState } from "react"
import { LeftNav } from "./LeftNav"
import { RightPanel } from "./RightPanel"
import { TopBar } from "./TopBar"

export function AppShell(props: { title: string; children: ReactNode }) {
	const [isAgentPanelOpen, setIsAgentPanelOpen] = useState(false)

	return (
		<div
			className={`min-h-screen bg-bg-primary lg:grid lg:grid-rows-[56px_1fr] ${
				isAgentPanelOpen
					? "lg:grid-cols-[240px_minmax(0,1fr)_380px]"
					: "lg:grid-cols-[240px_minmax(0,1fr)]"
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

			<aside className="hidden border-r border-border-subtle bg-bg-secondary lg:col-start-1 lg:row-start-2 lg:block">
				<LeftNav />
			</aside>

			<main className="min-w-0 bg-bg-primary lg:col-start-2 lg:row-start-2">{props.children}</main>

			{isAgentPanelOpen ? (
				<aside className="hidden border-l border-border-subtle bg-bg-secondary lg:col-start-3 lg:row-start-2 lg:block">
					<RightPanel />
				</aside>
			) : null}
		</div>
	)
}
