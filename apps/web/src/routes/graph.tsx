import { createFileRoute } from "@tanstack/react-router"
import { useCurrentWorkspace } from "@/api/hooks/workspaces"
import { ProtectedRoute } from "@/components/auth/ProtectedRoute"
import { WorkspaceGraphView } from "@/components/graph/WorkspaceGraphView"
import { AppShell } from "@/components/layout/AppShell"

export const Route = createFileRoute("/graph")({
	component: GraphPage,
})

function GraphPage() {
	const { data: workspace } = useCurrentWorkspace()

	return (
		<ProtectedRoute>
			<AppShell title="Paper Map">
				<WorkspaceGraphView workspace={workspace} />
			</AppShell>
		</ProtectedRoute>
	)
}
