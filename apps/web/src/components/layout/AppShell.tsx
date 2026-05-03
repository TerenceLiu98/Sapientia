import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react"
import { LeftNav } from "./LeftNav"
import { RightPanel } from "./RightPanel"
import { TopBar } from "./TopBar"

const LEFT_NAV_VISIBLE_KEY = "appShell.leftNavVisible"

function loadLeftNavVisible() {
	if (typeof window === "undefined") return true
	const value = window.localStorage.getItem(LEFT_NAV_VISIBLE_KEY)
	return value === null ? true : value !== "false"
}

const AppShellLayoutContext = createContext<{
	isLeftNavOpen: boolean
	toggleLeftNav: () => void
}>({
	isLeftNavOpen: true,
	toggleLeftNav: () => {},
})

AppShellLayoutContext.displayName = "AppShellLayoutContext"

export function useAppShellLayout() {
	return useContext(AppShellLayoutContext)
}

// AppShell uses `h-screen` (not min-h-screen) so the page is exactly one
// viewport tall. The main slot inherits `min-h-0` and is responsible for
// its own scrolling: list pages opt in via `overflow-y-auto`, reader
// pages keep `overflow-hidden` and let an inner viewer scroll. Without
// this, nested overflow-auto containers (PDF viewer, blocks panel) end
// up scrolling the whole document instead of themselves.
export function AppShell(props: {
	title: string
	children: ReactNode
	isAgentPanelOpen?: boolean
	onAgentPanelOpenChange?: (open: boolean) => void
	rightPanel?: ReactNode
}) {
	const [isLeftNavOpen, setIsLeftNavOpen] = useState(() => loadLeftNavVisible())
	const isAgentPanelOpen = props.isAgentPanelOpen ?? false

	useEffect(() => {
		if (typeof window !== "undefined") {
			window.localStorage.setItem(LEFT_NAV_VISIBLE_KEY, String(isLeftNavOpen))
		}
	}, [isLeftNavOpen])

	const layoutValue = useMemo(
		() => ({
			isLeftNavOpen,
			toggleLeftNav: () => setIsLeftNavOpen((open) => !open),
		}),
		[isLeftNavOpen],
	)

	return (
		<AppShellLayoutContext.Provider value={layoutValue}>
			<div
				className={`h-screen overflow-hidden bg-bg-primary lg:grid lg:grid-rows-[var(--shell-header-height)_minmax(0,1fr)] ${
					isLeftNavOpen
						? isAgentPanelOpen
							? "lg:grid-cols-[var(--shell-nav-width-expanded)_minmax(0,1fr)_var(--shell-rightpanel-width)]"
							: "lg:grid-cols-[var(--shell-nav-width-expanded)_minmax(0,1fr)]"
						: isAgentPanelOpen
							? "lg:grid-cols-[minmax(0,1fr)_var(--shell-rightpanel-width)]"
							: "lg:grid-cols-[minmax(0,1fr)]"
				}`}
			>
				<header
					className={`border-b border-border-subtle lg:row-start-1 ${
						isLeftNavOpen
							? isAgentPanelOpen
								? "lg:col-span-3"
								: "lg:col-span-2"
							: isAgentPanelOpen
								? "lg:col-span-2"
								: "lg:col-span-1"
					}`}
				>
					<TopBar
						title={props.title}
					/>
				</header>

				{isLeftNavOpen ? (
					<aside className="hidden overflow-y-auto border-r border-border-subtle bg-bg-secondary lg:col-start-1 lg:row-start-2 lg:block">
						<LeftNav />
					</aside>
				) : null}

				<main
					className={`min-h-0 min-w-0 overflow-hidden bg-bg-primary lg:row-start-2 ${
						isLeftNavOpen ? "lg:col-start-2" : "lg:col-start-1"
					}`}
				>
					{props.children}
				</main>

				{isAgentPanelOpen ? (
					<aside
						className={`hidden overflow-y-auto border-l border-border-subtle bg-bg-secondary lg:row-start-2 lg:block ${
							isLeftNavOpen ? "lg:col-start-3" : "lg:col-start-2"
						}`}
					>
						{props.rightPanel ?? <RightPanel />}
					</aside>
				) : null}
			</div>
		</AppShellLayoutContext.Provider>
	)
}
