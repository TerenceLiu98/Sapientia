import { Link, useNavigate } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { signIn, useSession } from "@/lib/auth-client"
import { useAuthProviders } from "@/lib/auth-providers"
import { AuthPageFrame } from "./AuthPageFrame"

export function SignInForm() {
	const { data: session, isPending } = useSession()
	const providers = useAuthProviders()
	const navigate = useNavigate()
	const [email, setEmail] = useState("")
	const [password, setPassword] = useState("")
	const [error, setError] = useState<string | null>(null)
	const [submitting, setSubmitting] = useState(false)

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
		<AuthPageFrame
			eyebrow="Sign in"
			title="Return to your reading desk"
			description="Use email and password for now. OAuth buttons are shown here too, so local development can exercise the same auth surface as production."
			footer={
				<>
					No account yet?{" "}
					<Link className="text-text-accent hover:underline" to="/sign-up">
						Create one
					</Link>
				</>
			}
		>
			<form className="space-y-4" onSubmit={handleSubmit}>
				<div className="space-y-1.5">
					<label className="block text-sm font-medium text-text-primary" htmlFor="email">
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

				<div className="space-y-1.5">
					<label className="block text-sm font-medium text-text-primary" htmlFor="password">
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

				{error ? <p className="text-sm text-text-error">{error}</p> : null}

				<button
					className="h-10 w-full rounded-md bg-accent-600 text-sm font-medium text-text-inverse transition-colors hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-60"
					disabled={submitting}
					type="submit"
				>
					{submitting ? "Signing in..." : "Sign in"}
				</button>
			</form>

			{providers.google || providers.github ? (
				<div className="mt-6 grid gap-2">
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
		</AuthPageFrame>
	)
}
