import { createFileRoute } from "@tanstack/react-router"
import { ProtectedRoute } from "@/components/auth/ProtectedRoute"
import { AppShell } from "@/components/layout/AppShell"
import { LibraryView } from "@/components/library/LibraryView"

export const Route = createFileRoute("/library")({
	component: LibraryPage,
})

function LibraryPage() {
	return (
		<ProtectedRoute>
			<AppShell title="Library">
				<LibraryView />
			</AppShell>
		</ProtectedRoute>
	)
}
