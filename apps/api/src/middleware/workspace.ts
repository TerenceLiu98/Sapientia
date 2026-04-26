import type { Role } from "@sapientia/db"
import { memberships } from "@sapientia/db"
import { and, eq } from "drizzle-orm"
import { createMiddleware } from "hono/factory"
import { db } from "../db"
import type { AuthContext } from "./auth"

const ROLE_RANK: Record<Role, number> = {
	reader: 1,
	editor: 2,
	owner: 3,
}

export type WorkspaceContext = AuthContext & {
	Variables: AuthContext["Variables"] & {
		membershipRole: Role
	}
}

export function requireMembership(minRole: Role = "reader") {
	return createMiddleware<WorkspaceContext>(async (c, next) => {
		const workspaceId = c.req.param("workspaceId") ?? c.req.param("wid")
		if (!workspaceId) {
			return c.json({ error: "workspaceId param required" }, 400)
		}

		const user = c.get("user")
		const result = await db
			.select()
			.from(memberships)
			.where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, user.id)))
			.limit(1)

		if (result.length === 0) {
			return c.json({ error: "not a member of this workspace" }, 403)
		}

		const role = result[0].role as Role
		if (ROLE_RANK[role] < ROLE_RANK[minRole]) {
			return c.json({ error: `insufficient role: need ${minRole}, have ${role}` }, 403)
		}

		c.set("membershipRole", role)
		await next()
	})
}
