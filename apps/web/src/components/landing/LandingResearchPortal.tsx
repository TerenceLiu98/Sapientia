import {
	ArrowRight,
	BookOpen,
	FileText,
	Library,
	LogIn,
	type LucideIcon,
	Map,
	ScrollText,
	Settings,
	UserPlus,
	Upload,
} from "lucide-react"
import {
	type FormEvent,
	type ReactNode,
	useCallback,
	useMemo,
	useRef,
	useState,
} from "react"
import { useNavigate } from "@tanstack/react-router"
import { usePapers, type Paper } from "@/api/hooks/papers"
import { useCurrentWorkspace } from "@/api/hooks/workspaces"
import { useSession } from "@/lib/auth-client"
import { useTheme } from "@/lib/theme"
import { PaperStarfieldCanvas, type PaperStarItem } from "./PaperStarfieldCanvas"

const MAX_VISIBLE_RESULTS = 6
const COMMAND_PLACEHOLDER = "Interroga Sapientiam..."
type CommandRoute = "/library" | "/graph" | "/settings" | "/sign-in" | "/sign-up"
type CommandActionDefinition = {
	icon: LucideIcon
	label: string
	to: CommandRoute
}
const COMMAND_ACTIONS: CommandActionDefinition[] = [
	{ icon: Upload, label: "Upload paper", to: "/library" as const },
	{ icon: Map, label: "Open paper map", to: "/graph" as const },
	{ icon: Settings, label: "Settings", to: "/settings" as const },
]
const AUTH_ACTIONS: CommandActionDefinition[] = [
	{ icon: LogIn, label: "Sign in", to: "/sign-in" as const },
	{ icon: UserPlus, label: "Create account", to: "/sign-up" as const },
]

export function LandingResearchPortal() {
	const navigate = useNavigate()
	const { resolvedTheme } = useTheme()
	const isDark = resolvedTheme === "dark"
	const { data: session } = useSession()
	const isAuthenticated = Boolean(session)
	const { data: workspace } = useCurrentWorkspace({ enabled: isAuthenticated })
	const { data: papers = [] } = usePapers(workspace?.id ?? "")
	const [query, setQuery] = useState("")
	const [isFocused, setIsFocused] = useState(false)
	const [emptyPanelSeed, setEmptyPanelSeed] = useState(0)
	const inputRef = useRef<HTMLInputElement | null>(null)

	const paperItems = useMemo(
		() => (isAuthenticated ? papers.map(toPaperStarItem) : []),
		[isAuthenticated, papers],
	)
	const normalizedQuery = normalizeQuery(query)
	const matchingPapers = useMemo(() => {
		if (!isAuthenticated) return []
		if (!normalizedQuery) return shuffledPapers(papers, emptyPanelSeed)
		return papers
			.filter((paper) => paperMatchesQuery(paper, normalizedQuery))
			.slice(0, MAX_VISIBLE_RESULTS)
	}, [emptyPanelSeed, isAuthenticated, normalizedQuery, papers])
	const matchingActions = useMemo(() => {
		const availableActions = isAuthenticated ? COMMAND_ACTIONS : AUTH_ACTIONS
		if (!normalizedQuery) {
			return seededShuffle(availableActions, emptyPanelSeed + 0.53).slice(
				0,
				randomActionCount(emptyPanelSeed, availableActions.length, isAuthenticated),
			)
		}
		return availableActions.filter((action) =>
			normalizeQuery([action.label, action.to.replace("/", "")].join(" ")).includes(normalizedQuery),
		)
	}, [emptyPanelSeed, isAuthenticated, normalizedQuery])

	const shouldShowPanel = isFocused || Boolean(query)
	const handleFocus = useCallback(() => {
		setIsFocused(true)
		if (!query) setEmptyPanelSeed(Math.random())
	}, [query])

	const navigateToPaper = useCallback(
		(paperId: string) => {
			void navigate({
				to: "/papers/$paperId",
				params: { paperId },
				search: { blockId: undefined },
			})
		},
		[navigate],
	)

	const openPaper = useCallback(
		(paperId: string) => {
			navigateToPaper(paperId)
		},
		[navigateToPaper],
	)

	const openRoute = useCallback(
		(to: CommandRoute) => {
			void navigate({ to })
		},
		[navigate],
	)

	const handleSubmit = useCallback(
		(event: FormEvent<HTMLFormElement>) => {
			event.preventDefault()
			if (matchingPapers.length > 0) {
				openPaper(matchingPapers[0].id)
				return
			}
			openRoute(matchingActions[0]?.to ?? (isAuthenticated ? "/library" : "/sign-in"))
		},
		[isAuthenticated, matchingActions, matchingPapers, openPaper, openRoute],
	)

	return (
		<div
			className={`relative h-full min-h-0 overflow-hidden ${
				isDark ? "bg-black text-white" : "bg-bg-primary text-text-primary"
			}`}
		>
			<PaperStarfieldCanvas
				colorMode={resolvedTheme}
				isInputFocused={shouldShowPanel}
				items={paperItems}
				onPaperSelect={openPaper}
			/>
			<div
				className={`pointer-events-none absolute inset-0 ${
					isDark
						? "bg-[radial-gradient(circle_at_center,rgb(255_255_255_/_0.05),transparent_24%,rgb(0_0_0_/_0.52)_72%)]"
						: "bg-[radial-gradient(circle_at_center,rgb(0_0_0_/_0.02),transparent_32%,rgb(0_0_0_/_0.08)_100%)]"
				}`}
			/>

			<div className="relative z-10 flex h-full items-center justify-center px-4">
				<div className="relative w-full max-w-[46rem]">
					<form
						className={`group relative flex h-14 items-center overflow-hidden rounded-[22px] border backdrop-blur-md transition-colors ${
							isDark
								? "border-white/42 bg-black/38 shadow-[0_0_42px_rgb(255_255_255_/_0.10),0_24px_80px_rgb(0_0_0_/_0.46)] focus-within:border-white/68"
								: "border-border-default bg-bg-overlay shadow-[var(--shadow-popover)] focus-within:border-border-strong"
						}`}
						onClick={() => inputRef.current?.focus()}
						onSubmit={handleSubmit}
					>
						<div className="relative min-w-0 flex-1 self-stretch">
							<input
								aria-label="Ask anything"
								autoComplete="off"
								className="absolute inset-0 z-20 h-full w-full appearance-none border-0 bg-transparent pr-20 pl-6 text-xl text-transparent caret-transparent opacity-0 outline-none selection:bg-transparent placeholder:text-transparent focus:outline-none focus:ring-0 focus-visible:outline-none [-webkit-appearance:none]"
								onBlur={() => window.setTimeout(() => setIsFocused(false), 120)}
								onChange={(event) => setQuery(event.target.value)}
								onFocus={handleFocus}
								placeholder={COMMAND_PLACEHOLDER}
								ref={inputRef}
								spellCheck={false}
								value={query}
							/>
							<div className="pointer-events-none absolute inset-0 z-10 flex items-center overflow-hidden px-6 text-xl">
								<span
									className={`truncate ${
										query
											? isDark
												? "text-white"
												: "text-text-primary"
											: isDark
												? "text-white/42"
												: "text-text-tertiary"
									}`}
								>
									{query || (isFocused ? "" : COMMAND_PLACEHOLDER)}
								</span>
								{isFocused ? (
									<span
										className={`ml-0.5 h-7 w-px shrink-0 animate-pulse ${
											isDark ? "bg-white/70" : "bg-text-primary"
										}`}
									/>
								) : null}
							</div>
						</div>
						<button
							aria-label="Submit research command"
							className={`absolute top-0 right-0 z-30 grid h-full w-16 place-items-center transition-colors ${
								isDark
									? "text-white/86 hover:text-white"
									: "text-text-secondary hover:text-text-primary"
							}`}
							type="submit"
						>
							<ArrowRight className="h-6 w-6" strokeWidth={1.5} />
						</button>
					</form>

					{shouldShowPanel ? (
						<div
							className={`absolute top-[calc(100%+1rem)] right-0 left-0 rounded-[28px] border p-2 backdrop-blur-xl ${
								isDark
									? "border-white/16 bg-black/44 shadow-[0_18px_70px_rgb(0_0_0_/_0.42)]"
									: "border-border-subtle bg-bg-overlay shadow-[var(--shadow-popover)]"
							}`}
						>
							{matchingPapers.length > 0 ? (
								<div className="space-y-1">
									{matchingPapers.map((paper) => (
										<button
											aria-label={`Open paper ${paper.title}`}
											className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left transition-colors ${
												isDark ? "hover:bg-white/10" : "hover:bg-surface-hover"
											}`}
											key={paper.id}
											onMouseDown={(event) => event.preventDefault()}
											onClick={() => openPaper(paper.id)}
											type="button"
										>
											<span className="flex min-w-0 items-center gap-3">
												<PaperResultIcon isDark={isDark} paper={paper} />
												<span className="min-w-0">
													<span
														className={`block truncate text-sm font-medium ${
															isDark ? "text-white" : "text-text-primary"
														}`}
													>
														{paper.title}
													</span>
													<span
														className={`mt-1 block truncate text-xs ${
															isDark ? "text-white/48" : "text-text-tertiary"
														}`}
													>
														{paperMetaLine(paper) || "Paper"}
													</span>
												</span>
											</span>
											<ArrowRight
												className={`ml-4 h-4 w-4 shrink-0 ${
													isDark ? "text-white/42" : "text-text-tertiary"
												}`}
											/>
										</button>
									))}
								</div>
							) : null}

							{matchingActions.length > 0 ? (
								<div className={matchingPapers.length > 0 ? "mt-2 space-y-1" : "space-y-1"}>
									{matchingActions.map((action) => (
										<CommandAction
											isDark={isDark}
											icon={<action.icon className="h-4 w-4" />}
											key={action.to}
											label={action.label}
											onClick={() => openRoute(action.to)}
										/>
									))}
								</div>
							) : null}

							{matchingPapers.length === 0 && matchingActions.length === 0 && normalizedQuery ? (
								<div
									className={`px-4 py-3 text-sm ${
										isDark ? "text-white/50" : "text-text-tertiary"
									}`}
								>
									No paper match yet.
								</div>
							) : null}
						</div>
					) : null}
				</div>
			</div>
			<div
				className={`pointer-events-none absolute right-6 bottom-5 left-6 z-10 text-center font-serif ${
					isDark ? "text-white/46" : "text-text-tertiary"
				}`}
			>
				<div className="text-lg leading-6 sm:text-xl">
					Humans do Marginalia, AIs do Zettelkasten
				</div>
			</div>
		</div>
	)
}

function PaperResultIcon({ isDark, paper }: { isDark: boolean; paper: Paper }) {
	const Icon = iconForPublicationType(paper.publicationType)
	return (
		<span
			className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${
				isDark ? "bg-white/10 text-white/58" : "bg-surface-hover text-text-tertiary"
			}`}
		>
			<Icon className="h-4 w-4" />
		</span>
	)
}

function iconForPublicationType(type: Paper["publicationType"]) {
	switch (type) {
		case "book":
		case "chapter":
			return Library
		case "conference":
			return BookOpen
		case "journal":
			return ScrollText
		default:
			return FileText
	}
}

function CommandAction({
	icon,
	isDark,
	label,
	onClick,
}: {
	icon: ReactNode
	isDark: boolean
	label: string
	onClick: () => void
}) {
	return (
		<button
			className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm transition-colors ${
				isDark
					? "text-white/68 hover:bg-white/10 hover:text-white"
					: "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
			}`}
			onMouseDown={(event) => event.preventDefault()}
			onClick={onClick}
			type="button"
		>
			<span className="flex min-w-0 items-center gap-2">
				<span className="shrink-0">{icon}</span>
				<span className="truncate">{label}</span>
			</span>
			<ArrowRight
				className={`ml-4 h-4 w-4 shrink-0 ${isDark ? "text-white/42" : "text-text-tertiary"}`}
			/>
		</button>
	)
}

function toPaperStarItem(paper: Paper): PaperStarItem {
	return {
		id: paper.id,
		title: paper.title,
		authors: paper.authors,
		year: paper.year,
		venue: paper.venue,
		parseStatus: paper.parseStatus,
		summaryStatus: paper.summaryStatus,
	}
}

function shuffledPapers(papers: Paper[], seed: number) {
	return seededShuffle(papers, seed + 0.17).slice(0, MAX_VISIBLE_RESULTS)
}

function randomActionCount(seed: number, maxCount: number, isAuthenticated: boolean) {
	const value = seededUnit(seed + 0.79)
	if (!isAuthenticated) return value < 0.52 ? 1 : maxCount
	if (value < 0.28) return 0
	if (value < 0.72) return 1
	if (value < 0.92) return 2
	return maxCount
}

function seededShuffle<T>(items: readonly T[], seed: number) {
	return [...items]
		.map((item, index) => ({
			item,
			sort: seededUnit(seed * 997 + index * 37.17),
		}))
		.sort((a, b) => a.sort - b.sort)
		.map(({ item }) => item)
}

function seededUnit(value: number) {
	const x = Math.sin(value * 12.9898) * 43758.5453
	return x - Math.floor(x)
}

function paperMatchesQuery(paper: Paper, normalizedQuery: string) {
	const haystack = normalizeQuery(
		[paper.title, paper.venue, paper.year, paper.authors?.join(" ")].filter(Boolean).join(" "),
	)
	return haystack.includes(normalizedQuery)
}

function normalizeQuery(value: unknown) {
	return String(value ?? "")
		.trim()
		.toLowerCase()
}

function paperMetaLine(paper: Pick<Paper, "authors" | "year" | "venue">) {
	const firstAuthor = paper.authors?.[0]
	return [paper.year, paper.venue, firstAuthor].filter(Boolean).join(" · ")
}
