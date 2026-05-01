import { createFileRoute } from "@tanstack/react-router"
import { ProtectedRoute } from "@/components/auth/ProtectedRoute"
import { AppShell } from "@/components/layout/AppShell"
import { AppearanceSettings } from "@/components/settings/AppearanceSettings"
import { CredentialsForm } from "@/components/settings/CredentialsForm"

export const Route = createFileRoute("/settings")({
	component: SettingsPage,
})

function SettingsPage() {
	return (
		<ProtectedRoute>
			<AppShell title="Settings">
				<div className="h-full overflow-y-auto">
					<div className="mx-auto max-w-[var(--content-default)] px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
						<header className="mb-8">
							<h1 className="font-serif text-3xl text-text-primary">Settings</h1>
							<p className="mt-2 text-text-secondary">
								Manage appearance and API credentials. Credentials are stored encrypted in your
								workspace and only decrypted at the moment we call the upstream service.
							</p>
						</header>
						<AppearanceSettings />
						<CredentialsForm />
					</div>
				</div>
			</AppShell>
		</ProtectedRoute>
	)
}
