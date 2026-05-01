import {
	createContext,
	type PropsWithChildren,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react"

export type ThemePreference = "light" | "dark" | "system"

const DOCUMENT_THEME_KEY = "app.theme"

function loadThemePreference(): ThemePreference {
	if (typeof window === "undefined") return "system"
	const saved = window.localStorage.getItem(DOCUMENT_THEME_KEY)
	if (saved === "light" || saved === "dark" || saved === "system") return saved
	return "system"
}

function resolveTheme(preference: ThemePreference): "light" | "dark" {
	if (preference === "light" || preference === "dark") return preference
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light"
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

const ThemeContext = createContext<{
	themePreference: ThemePreference
	resolvedTheme: "light" | "dark"
	setThemePreference: (preference: ThemePreference) => void
} | null>(null)

ThemeContext.displayName = "ThemeContext"

export function ThemeProvider({ children }: PropsWithChildren) {
	const [themePreference, setThemePreference] = useState<ThemePreference>(() => loadThemePreference())
	const [systemTheme, setSystemTheme] = useState<"light" | "dark">(() => resolveTheme("system"))
	const resolvedTheme = useMemo(
		() => (themePreference === "system" ? systemTheme : themePreference),
		[systemTheme, themePreference],
	)

	useEffect(() => {
		if (typeof document !== "undefined") {
			document.documentElement.dataset.theme = resolvedTheme
		}
		if (typeof window !== "undefined") {
			window.localStorage.setItem(DOCUMENT_THEME_KEY, themePreference)
		}
	}, [resolvedTheme, themePreference])

	useEffect(() => {
		if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
		const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
		const handleChange = () => {
			setSystemTheme(resolveTheme("system"))
		}
		handleChange()
		if (typeof mediaQuery.addEventListener === "function") {
			mediaQuery.addEventListener("change", handleChange)
			return () => mediaQuery.removeEventListener("change", handleChange)
		}
		mediaQuery.addListener(handleChange)
		return () => mediaQuery.removeListener(handleChange)
	}, [])

	const value = useMemo(
		() => ({
			themePreference,
			resolvedTheme,
			setThemePreference,
		}),
		[resolvedTheme, themePreference],
	)

	return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
	const value = useContext(ThemeContext)
	if (!value) {
		throw new Error("useTheme must be used within ThemeProvider")
	}
	return value
}
