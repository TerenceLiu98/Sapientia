import { Hono } from "hono"
import { db } from "../db"
import { type AuthContext, requireAuth } from "../middleware/auth"
import { listWorkspacesForUser } from "../services/workspace"

export const workspaceRoutes = new Hono<AuthContext>()

workspaceRoutes.get("/workspaces", requireAuth, async (c) => {
	const user = c.get("user")
	const items = await listWorkspacesForUser(user.id, db)

	return c.json(
		items.map(({ workspace, role }) => ({
			id: workspace.id,
			name: workspace.name,
			type: workspace.type,
			role,
			createdAt: workspace.createdAt,
		})),
	)
})
