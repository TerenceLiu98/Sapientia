import { createFileRoute } from "@tanstack/react-router"
import { ProtectedRoute } from "@/components/auth/ProtectedRoute"
import { AppShell } from "@/components/layout/AppShell"

export const Route = createFileRoute("/")({
	component: IndexPage,
})

function IndexPage() {
	return (
		<ProtectedRoute>
			<AppShell title="Welcome">
				<div className="h-full overflow-y-auto">
					<section className="mx-auto max-w-[var(--content-default)] px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
						<div className="rounded-xl border border-border-subtle bg-bg-overlay p-6 shadow-[var(--shadow-popover)]">
							<div className="text-xs font-medium uppercase tracking-[0.16em] text-text-secondary">
								Reading foundation
							</div>
							<h1 className="mt-3 font-serif text-4xl font-semibold tracking-[-0.035em] text-text-primary">
								Welcome to Sapientia
							</h1>
							<p className="mt-4 font-serif text-[1.125rem] leading-8 text-text-secondary">
								Your library is empty for now. The shell is in place, auth is working, and the next
								task can start putting papers on the desk.
							</p>
						</div>
					</section>
				</div>
			</AppShell>
		</ProtectedRoute>
	)
}
