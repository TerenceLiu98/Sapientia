import { relations, sql } from "drizzle-orm"
import {
	check,
	index,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core"
import { user } from "./auth"

export const workspaces = pgTable(
	"workspaces",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		name: text("name").notNull(),
		type: text("type").notNull(),
		ownerUserId: text("owner_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		check("workspaces_type_check", sql`${table.type} in ('personal', 'shared')`),
		index("idx_workspaces_owner_user_id").on(table.ownerUserId),
		uniqueIndex("workspaces_personal_owner_unq")
			.on(table.ownerUserId)
			.where(sql`${table.type} = 'personal'`),
	],
)

export const memberships = pgTable(
	"memberships",
	{
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: text("role").notNull(),
		joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		primaryKey({ name: "memberships_pkey", columns: [table.workspaceId, table.userId] }),
		check("memberships_role_check", sql`${table.role} in ('owner', 'editor', 'reader')`),
		index("idx_memberships_user_id").on(table.userId),
	],
)

export const workspacesRelations = relations(workspaces, ({ many, one }) => ({
	owner: one(user, {
		fields: [workspaces.ownerUserId],
		references: [user.id],
	}),
	memberships: many(memberships),
}))

export const membershipsRelations = relations(memberships, ({ one }) => ({
	workspace: one(workspaces, {
		fields: [memberships.workspaceId],
		references: [workspaces.id],
	}),
	user: one(user, {
		fields: [memberships.userId],
		references: [user.id],
	}),
}))

export type Workspace = typeof workspaces.$inferSelect
export type NewWorkspace = typeof workspaces.$inferInsert
export type Membership = typeof memberships.$inferSelect
export type Role = "owner" | "editor" | "reader"
export type WorkspaceType = "personal" | "shared"
