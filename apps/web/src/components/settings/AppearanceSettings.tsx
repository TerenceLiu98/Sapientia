import type { ReactNode } from "react"
import { useTheme, type ThemePreference } from "@/lib/theme"

const THEME_OPTIONS: Array<{
	value: ThemePreference
	label: string
	icon: ReactNode
}> = [
	{ value: "light", label: "Light", icon: <MoonIcon /> },
	{ value: "dark", label: "Dark", icon: <SunIcon /> },
	{ value: "system", label: "System", icon: <MonitorIcon /> },
]

export function AppearanceSettings() {
	const { resolvedTheme, setThemePreference, themePreference } = useTheme()

	return (
		<section className="mb-10 space-y-3">
			<header>
				<div className="text-xs font-medium uppercase tracking-[0.16em] text-text-secondary">
					Appearance
				</div>
				<h2 className="font-serif text-xl text-text-primary">Theme</h2>
				<p className="mt-1 text-sm text-text-secondary">
					Choose light, dark, or follow your system appearance. PDF rendering follows this
					setting too.
				</p>
			</header>

			<div className="inline-flex rounded-xl border border-border-default bg-bg-primary p-1 shadow-[var(--shadow-popover)]">
				{THEME_OPTIONS.map((option) => {
					const isActive = option.value === themePreference
					return (
						<button
							aria-label={`Theme: ${option.label.toLowerCase()}`}
							aria-pressed={isActive}
							className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
								isActive
									? "bg-accent-600 text-text-inverse"
									: "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
							}`}
							key={option.value}
							onClick={() => setThemePreference(option.value)}
							title={option.label}
							type="button"
						>
							{option.icon}
						</button>
					)
				})}
			</div>
		</section>
	)
}

function SunIcon() {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="16"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.7"
			viewBox="0 0 24 24"
			width="16"
		>
			<circle cx="12" cy="12" r="4" />
			<path d="M12 2v2.5M12 19.5V22M4.93 4.93l1.77 1.77M17.3 17.3l1.77 1.77M2 12h2.5M19.5 12H22M4.93 19.07l1.77-1.77M17.3 6.7l1.77-1.77" />
		</svg>
	)
}

function MoonIcon() {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="16"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.7"
			viewBox="0 0 24 24"
			width="16"
		>
			<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
		</svg>
	)
}

function MonitorIcon() {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="16"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.7"
			viewBox="0 0 24 24"
			width="16"
		>
			<rect height="12" rx="2" width="18" x="3" y="4" />
			<path d="M8 20h8M12 16v4" />
		</svg>
	)
}
