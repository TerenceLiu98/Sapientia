import { Link, useNavigate } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { signUp, useSession } from "@/lib/auth-client"
import { AuthPageFrame } from "./AuthPageFrame"

export function SignUpForm() {
	const { data: session, isPending } = useSession()
	const navigate = useNavigate()
	const [name, setName] = useState("")
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
			const result = await signUp.email({
				name,
				email,
				password,
			})

			if (result.error) {
				setError(result.error.message ?? "Sign up failed")
				return
			}

			await navigate({ to: "/" })
		} catch {
			setError("Sign up failed")
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<AuthPageFrame
			eyebrow="Create account"
			title="Set up your first workspace"
			description="Every new account gets a personal workspace automatically. Shared workspaces come later; for now we keep the table ready and the room quiet."
			footer={
				<>
					Already have an account?{" "}
					<Link className="text-text-accent hover:underline" to="/sign-in">
						Sign in
					</Link>
				</>
			}
		>
			<form className="space-y-4" onSubmit={handleSubmit}>
				<div className="space-y-1.5">
					<label className="block text-sm font-medium text-text-primary" htmlFor="name">
						Name
					</label>
					<input
						className="h-10 w-full rounded-md border border-border-default bg-bg-primary px-3 text-sm text-text-primary outline-none transition-colors focus:border-border-accent"
						id="name"
						name="name"
						onChange={(event) => setName(event.target.value)}
						required
						type="text"
						value={name}
					/>
				</div>

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
					{submitting ? "Creating account..." : "Create account"}
				</button>
			</form>
		</AuthPageFrame>
	)
}
