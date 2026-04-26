import { createDbClient } from "@sapientia/db"
import { Hono } from "hono"
import { config } from "../config"
import { type AuthContext, requireAuth } from "../middleware/auth"
import { listWorkspacesForUser } from "../services/workspace"

const { db } = createDbClient(config.DATABASE_URL)

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
