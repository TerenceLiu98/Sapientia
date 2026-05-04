import { Link, useNavigate } from "@tanstack/react-router"
import { type FormEvent, useEffect, useState } from "react"
import { signIn, useSession } from "@/lib/auth-client"
import { useAuthProviders } from "@/lib/auth-providers"
import { useTheme } from "@/lib/theme"
import { PaperStarfieldCanvas } from "@/components/landing/PaperStarfieldCanvas"

export function SignInForm() {
	const { data: session, isPending } = useSession()
	const providers = useAuthProviders()
	const navigate = useNavigate()
	const { systemTheme } = useTheme()
	const isDark = systemTheme === "dark"
	const [email, setEmail] = useState("")
	const [password, setPassword] = useState("")
	const [error, setError] = useState<string | null>(null)
	const [submitting, setSubmitting] = useState(false)

	useEffect(() => {
		if (typeof document === "undefined") return
		const previousTheme = document.documentElement.dataset.theme
		document.documentElement.dataset.theme = systemTheme
		return () => {
			if (previousTheme) {
				document.documentElement.dataset.theme = previousTheme
			} else {
				delete document.documentElement.dataset.theme
			}
		}
	}, [systemTheme])

	if (!isPending && session) {
		return <div className="text-sm text-text-secondary">You are already signed in.</div>
	}

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setError(null)
		setSubmitting(true)

		try {
			const result = await signIn.email({
				email,
				password,
			})

			if (result.error) {
				setError(result.error.message ?? "Sign in failed")
				return
			}

			await navigate({ to: "/" })
		} catch {
			setError("Sign in failed")
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<div
			className={`relative h-dvh min-h-dvh overflow-hidden ${
				isDark ? "bg-black text-white" : "bg-bg-primary text-text-primary"
			}`}
		>
			<PaperStarfieldCanvas
				colorMode={systemTheme}
				isInputFocused={false}
				items={[]}
				onPaperSelect={() => {}}
			/>
			<div
				className={`pointer-events-none absolute inset-0 ${
					isDark
						? "bg-[radial-gradient(circle_at_center,rgb(255_255_255_/_0.05),transparent_24%,rgb(0_0_0_/_0.52)_72%)]"
						: "bg-[radial-gradient(circle_at_center,rgb(0_0_0_/_0.02),transparent_32%,rgb(0_0_0_/_0.08)_100%)]"
				}`}
			/>

			<div className="relative z-10 flex h-full items-center justify-center px-4">
				<form
					className={`w-full max-w-[28rem] rounded-xl border p-6 shadow-[var(--shadow-popover)] backdrop-blur-xl sm:p-8 ${
						isDark
							? "border-white/18 bg-black/20"
							: "border-white/56 bg-white/20"
					}`}
					onSubmit={handleSubmit}
				>
					<div className="mb-8">
						<div className="text-xs font-medium uppercase tracking-[0.18em] text-text-secondary">
							Sapientia
						</div>
						<h1 className="mt-3 font-serif text-4xl font-semibold tracking-[-0.035em] text-text-primary">
							Sign in
						</h1>
					</div>

					<div className="space-y-1.5">
						<label
							className="block text-sm font-medium text-text-primary"
							htmlFor="email"
						>
							Email
						</label>
						<input
							className="h-10 w-full rounded-md border border-border-default bg-bg-primary px-3 text-sm text-text-primary outline-none transition-colors focus:border-border-accent"
							id="email"
							name="email"
							onChange={(event) => setEmail(event.target.value)}
							required
							type="email"
							value={email}
						/>
					</div>

					<div className="mt-4 space-y-1.5">
						<label
							className="block text-sm font-medium text-text-primary"
							htmlFor="password"
						>
							Password
						</label>
						<input
							className="h-10 w-full rounded-md border border-border-default bg-bg-primary px-3 text-sm text-text-primary outline-none transition-colors focus:border-border-accent"
							id="password"
							name="password"
							onChange={(event) => setPassword(event.target.value)}
							required
							type="password"
							value={password}
						/>
					</div>

					{error ? <p className="mt-4 text-sm text-text-error">{error}</p> : null}

					<button
						className="mt-5 h-10 w-full rounded-md bg-accent-600 text-sm font-medium text-text-inverse transition-colors hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-60"
						disabled={submitting}
						type="submit"
					>
						{submitting ? "Signing in..." : "Sign in"}
					</button>

					{providers.google || providers.github ? (
						<div className="mt-5 grid gap-2">
							{providers.google ? (
								<button
									className="h-10 rounded-md border border-border-default bg-bg-primary text-sm font-medium text-text-primary transition-colors hover:bg-surface-hover"
									onClick={() => void signIn.social({ provider: "google" })}
									type="button"
								>
									Continue with Google
								</button>
							) : null}
							{providers.github ? (
								<button
									className="h-10 rounded-md border border-border-default bg-bg-primary text-sm font-medium text-text-primary transition-colors hover:bg-surface-hover"
									onClick={() => void signIn.social({ provider: "github" })}
									type="button"
								>
									Continue with GitHub
								</button>
							) : null}
						</div>
					) : null}

					<div className={`mt-5 text-center text-sm ${isDark ? "text-white/52" : "text-text-tertiary"}`}>
						No account yet?{" "}
						<Link
							className={isDark ? "text-white/82 hover:text-white" : "text-text-accent hover:underline"}
							to="/sign-up"
						>
							Create account
						</Link>
					</div>
				</form>
			</div>

			<div
				className={`pointer-events-none absolute right-6 bottom-5 left-6 z-10 flex items-center justify-center gap-3 text-center font-serif ${
					isDark ? "text-white/46" : "text-text-tertiary"
				}`}
			>
				<img
					alt=""
					aria-hidden="true"
					className="h-7 w-7 shrink-0 rounded-[7px]"
					src={isDark ? "/logo-light.svg" : "/logo-dark.svg"}
				/>
				<div className="text-lg leading-6 sm:text-xl">
					Perpetuis futuris temporibus duraturam
				</div>
			</div>
		</div>
	)
}
