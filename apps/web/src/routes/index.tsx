import { createFileRoute } from "@tanstack/react-router"
import { LandingResearchPortal } from "@/components/landing/LandingResearchPortal"
import { AppShell } from "@/components/layout/AppShell"

export const Route = createFileRoute("/")({
	component: IndexPage,
})

function IndexPage() {
	return (
		<AppShell chrome="minimal" title="Sapientia">
			<LandingResearchPortal />
		</AppShell>
	)
}
