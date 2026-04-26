import { Navigate } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { useSession } from "@/lib/auth-client"

export function ProtectedRoute({ children }: { children: ReactNode }) {
	const { data: session, isPending } = useSession()

	if (isPending) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-bg-primary px-6">
				<div className="rounded-xl border border-border-subtle bg-bg-overlay px-6 py-4 text-sm text-text-tertiary shadow-[var(--shadow-popover)]">
					Loading your workspace...
				</div>
			</div>
		)
	}

	if (!session) {
		return <Navigate to="/sign-in" />
	}

	return <>{children}</>
}
