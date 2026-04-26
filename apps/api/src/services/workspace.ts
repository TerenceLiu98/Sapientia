import type { Database, Role, Workspace } from "@sapientia/db"
import { memberships, workspaces } from "@sapientia/db"
import { and, asc, eq } from "drizzle-orm"

const PERSONAL_WORKSPACE_NAME = "My Research"

async function ensureOwnerMembership(userId: string, workspaceId: string, db: Database) {
	await db
		.insert(memberships)
		.values({
			workspaceId,
			userId,
			role: "owner",
		})
		.onConflictDoNothing()
}

export async function ensurePersonalWorkspace(userId: string, db: Database): Promise<Workspace> {
	const existing = await db
		.select()
		.from(workspaces)
		.where(and(eq(workspaces.ownerUserId, userId), eq(workspaces.type, "personal")))
		.limit(1)

	if (existing.length > 0) {
		await ensureOwnerMembership(userId, existing[0].id, db)
		return existing[0]
	}

	const [workspace] = await db
		.insert(workspaces)
		.values({
			name: PERSONAL_WORKSPACE_NAME,
			type: "personal",
			ownerUserId: userId,
		})
		.returning()

	await ensureOwnerMembership(userId, workspace.id, db)
	return workspace
}

export async function listWorkspacesForUser(
	userId: string,
	db: Database,
): Promise<Array<{ workspace: Workspace; role: Role }>> {
	const rows = await db
		.select({
			workspace: workspaces,
			role: memberships.role,
		})
		.from(memberships)
		.innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
		.where(eq(memberships.userId, userId))
		.orderBy(asc(workspaces.createdAt))

	if (rows.length === 0) {
		await ensurePersonalWorkspace(userId, db)
		return listWorkspacesForUser(userId, db)
	}

	return rows.map((row) => ({
		workspace: row.workspace,
		role: row.role as Role,
	}))
}
