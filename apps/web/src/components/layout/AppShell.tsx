import {
	type CSSProperties,
	createContext,
	type KeyboardEvent,
	type PointerEvent,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import { LeftNav } from "./LeftNav"
import { TopBar } from "./TopBar"

const LEFT_NAV_VISIBLE_KEY = "appShell.leftNavVisible"
const LEFT_NAV_WIDTH_KEY = "appShell.leftNavWidth"
const DEFAULT_LEFT_NAV_WIDTH = 280
const MIN_LEFT_NAV_WIDTH = 240
const MAX_LEFT_NAV_WIDTH = 380
const COLLAPSE_DRAG_WIDTH = 180

type LeftNavDragState = {
	pointerId: number
	startX: number
	startWidth: number
	lastRawWidth: number
	didDrag: boolean
	wasOpen: boolean
}

function loadLeftNavVisible() {
	if (typeof window === "undefined") return true
	const value = window.localStorage.getItem(LEFT_NAV_VISIBLE_KEY)
	return value === null ? true : value !== "false"
}

function clampLeftNavWidth(width: number) {
	return Math.min(Math.max(width, MIN_LEFT_NAV_WIDTH), MAX_LEFT_NAV_WIDTH)
}

function loadLeftNavWidth() {
	if (typeof window === "undefined") return DEFAULT_LEFT_NAV_WIDTH
	const value = Number(window.localStorage.getItem(LEFT_NAV_WIDTH_KEY))
	return Number.isFinite(value) ? clampLeftNavWidth(value) : DEFAULT_LEFT_NAV_WIDTH
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
	chrome?: "workspace" | "minimal"
}) {
	const chrome = props.chrome ?? "workspace"
	const isMinimalChrome = chrome === "minimal"
	const [isLeftNavOpen, setIsLeftNavOpen] = useState(() => loadLeftNavVisible())
	const [leftNavWidth, setLeftNavWidth] = useState(() => loadLeftNavWidth())
	const [isResizingLeftNav, setIsResizingLeftNav] = useState(false)
	const leftNavDragRef = useRef<LeftNavDragState | null>(null)

	useEffect(() => {
		if (typeof window !== "undefined") {
			window.localStorage.setItem(LEFT_NAV_VISIBLE_KEY, String(isLeftNavOpen))
		}
	}, [isLeftNavOpen])

	useEffect(() => {
		if (typeof window !== "undefined") {
			window.localStorage.setItem(LEFT_NAV_WIDTH_KEY, String(Math.round(leftNavWidth)))
		}
	}, [leftNavWidth])

	const toggleLeftNav = useCallback(() => setIsLeftNavOpen((open) => !open), [])

	const layoutValue = useMemo(
		() => ({
			isLeftNavOpen,
			toggleLeftNav,
		}),
		[isLeftNavOpen, toggleLeftNav],
	)

	const handleLeftNavPointerDown = useCallback(
		(event: PointerEvent<HTMLElement>) => {
			if (event.button !== 0) return
			event.preventDefault()
			event.currentTarget.setPointerCapture(event.pointerId)
			leftNavDragRef.current = {
				pointerId: event.pointerId,
				startX: event.clientX,
				startWidth: leftNavWidth,
				lastRawWidth: leftNavWidth,
				didDrag: false,
				wasOpen: isLeftNavOpen,
			}
			setIsResizingLeftNav(true)
		},
		[isLeftNavOpen, leftNavWidth],
	)

	const handleLeftNavPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
		const drag = leftNavDragRef.current
		if (!drag || drag.pointerId !== event.pointerId) return
		const delta = event.clientX - drag.startX
		const rawWidth = drag.startWidth + delta
		drag.lastRawWidth = rawWidth
		if (Math.abs(delta) > 3) drag.didDrag = true
		if (!drag.didDrag) return

		setLeftNavWidth(clampLeftNavWidth(rawWidth))
		if (!drag.wasOpen && delta > 8) {
			setIsLeftNavOpen(true)
		}
	}, [])

	const finishLeftNavDrag = useCallback((event: PointerEvent<HTMLElement>) => {
		const drag = leftNavDragRef.current
		if (!drag || drag.pointerId !== event.pointerId) return
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId)
		}
		leftNavDragRef.current = null
		setIsResizingLeftNav(false)

		if (!drag.didDrag) {
			setIsLeftNavOpen((open) => !open)
			return
		}

		setIsLeftNavOpen(drag.lastRawWidth >= COLLAPSE_DRAG_WIDTH)
	}, [])

	const handleLeftNavKeyDown = useCallback(
		(event: KeyboardEvent<HTMLElement>) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault()
				setIsLeftNavOpen((open) => !open)
				return
			}
			if (event.key === "ArrowLeft") {
				event.preventDefault()
				if (!isLeftNavOpen) return
				setLeftNavWidth((width) => {
					const nextWidth = width - 24
					if (nextWidth < MIN_LEFT_NAV_WIDTH) {
						setIsLeftNavOpen(false)
						return MIN_LEFT_NAV_WIDTH
					}
					return clampLeftNavWidth(nextWidth)
				})
				return
			}
			if (event.key === "ArrowRight") {
				event.preventDefault()
				setIsLeftNavOpen(true)
				setLeftNavWidth((width) => clampLeftNavWidth(width + 24))
			}
		},
		[isLeftNavOpen],
	)

	const shellStyle = {
		"--app-left-nav-width": `${Math.round(leftNavWidth)}px`,
	} as CSSProperties

	if (isMinimalChrome) {
		return (
			<AppShellLayoutContext.Provider value={layoutValue}>
				<div className="fixed inset-0 overflow-hidden bg-bg-primary" style={shellStyle}>
					<main className="h-dvh min-h-dvh min-w-0 overflow-hidden bg-bg-primary">
						{props.children}
					</main>
				</div>
			</AppShellLayoutContext.Provider>
		)
	}

	return (
		<AppShellLayoutContext.Provider value={layoutValue}>
			<div
				className={`relative h-screen overflow-hidden bg-bg-primary lg:grid lg:grid-rows-[var(--shell-header-height)_minmax(0,1fr)] ${
					isLeftNavOpen
						? "lg:grid-cols-[var(--app-left-nav-width)_minmax(0,1fr)]"
						: "lg:grid-cols-[minmax(0,1fr)]"
				}`}
				style={shellStyle}
			>
				<header
					className={`border-b border-border-subtle lg:row-start-1 ${
						isLeftNavOpen ? "lg:col-span-2" : "lg:col-span-1"
					}`}
				>
					<TopBar title={props.title} />
				</header>

				{isLeftNavOpen ? (
					<aside
						className={`relative hidden border-r border-border-subtle bg-bg-secondary lg:col-start-1 lg:row-start-2 lg:block ${
							isResizingLeftNav ? "select-none" : ""
						}`}
					>
						<div className="h-full overflow-y-auto">
							<LeftNav />
						</div>
						<LeftNavResizeHandle
							isOpen={isLeftNavOpen}
							isResizing={isResizingLeftNav}
							onKeyDown={handleLeftNavKeyDown}
							onPointerCancel={finishLeftNavDrag}
							onPointerDown={handleLeftNavPointerDown}
							onPointerMove={handleLeftNavPointerMove}
							onPointerUp={finishLeftNavDrag}
							width={leftNavWidth}
						/>
					</aside>
				) : null}

				<main
					className={`h-full min-h-0 min-w-0 overflow-hidden bg-bg-primary lg:row-start-2 ${
						isLeftNavOpen ? "lg:col-start-2" : "lg:col-start-1"
					}`}
				>
					{props.children}
				</main>

				{!isLeftNavOpen ? (
					<LeftNavCollapsedHandle
						isResizing={isResizingLeftNav}
						onKeyDown={handleLeftNavKeyDown}
						onPointerCancel={finishLeftNavDrag}
						onPointerDown={handleLeftNavPointerDown}
						onPointerMove={handleLeftNavPointerMove}
						onPointerUp={finishLeftNavDrag}
						width={leftNavWidth}
					/>
				) : null}
			</div>
		</AppShellLayoutContext.Provider>
	)
}

function LeftNavResizeHandle({
	isOpen,
	isResizing,
	onKeyDown,
	onPointerCancel,
	onPointerDown,
	onPointerMove,
	onPointerUp,
	width,
}: {
	isOpen: boolean
	isResizing: boolean
	onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
	onPointerCancel: (event: PointerEvent<HTMLElement>) => void
	onPointerDown: (event: PointerEvent<HTMLElement>) => void
	onPointerMove: (event: PointerEvent<HTMLElement>) => void
	onPointerUp: (event: PointerEvent<HTMLElement>) => void
	width: number
}) {
	return (
		<hr
			aria-label={isOpen ? "Resize or collapse workspace sidebar" : "Expand workspace sidebar"}
			aria-orientation="vertical"
			aria-valuemax={MAX_LEFT_NAV_WIDTH}
			aria-valuemin={MIN_LEFT_NAV_WIDTH}
			aria-valuenow={Math.round(width)}
			className={`group absolute top-0 right-[-7px] z-[var(--z-elevated)] m-0 hidden h-full w-3 cursor-col-resize touch-none border-0 bg-transparent p-0 before:absolute before:top-1/2 before:left-1/2 before:block before:h-14 before:w-1 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:border before:border-border-subtle before:bg-bg-primary before:shadow-[var(--shadow-sm)] before:transition-colors lg:block ${
				isResizing
					? "before:border-border-accent before:bg-accent-100"
					: "hover:before:border-border-strong hover:before:bg-surface-hover"
			}`}
			onKeyDown={onKeyDown}
			onPointerCancel={onPointerCancel}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			tabIndex={0}
			title="Drag to resize. Click to collapse."
		/>
	)
}

function LeftNavCollapsedHandle({
	isResizing,
	onKeyDown,
	onPointerCancel,
	onPointerDown,
	onPointerMove,
	onPointerUp,
	width,
}: {
	isResizing: boolean
	onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
	onPointerCancel: (event: PointerEvent<HTMLElement>) => void
	onPointerDown: (event: PointerEvent<HTMLElement>) => void
	onPointerMove: (event: PointerEvent<HTMLElement>) => void
	onPointerUp: (event: PointerEvent<HTMLElement>) => void
	width: number
}) {
	return (
		<hr
			aria-label="Expand workspace sidebar"
			aria-orientation="vertical"
			aria-valuemax={MAX_LEFT_NAV_WIDTH}
			aria-valuemin={MIN_LEFT_NAV_WIDTH}
			aria-valuenow={Math.round(width)}
			className={`group absolute top-[calc(var(--shell-header-height)+50%)] left-0 z-[var(--z-elevated)] m-0 hidden h-20 w-4 -translate-y-1/2 cursor-col-resize touch-none border-0 bg-transparent p-0 before:absolute before:top-1/2 before:left-1/2 before:block before:h-14 before:w-1 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:border before:border-border-subtle before:bg-bg-primary before:shadow-[var(--shadow-sm)] before:transition-colors lg:block ${
				isResizing
					? "before:border-border-accent before:bg-accent-100"
					: "hover:before:border-border-strong hover:before:bg-surface-hover"
			}`}
			onKeyDown={onKeyDown}
			onPointerCancel={onPointerCancel}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			tabIndex={0}
			title="Click to expand. Drag right to resize."
		/>
	)
}
