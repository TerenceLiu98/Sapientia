import { fileURLToPath } from "node:url"
import { createDbClient, memberships, user, workspaces } from "@sapientia/db"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { and, count, eq } from "drizzle-orm"
import { Hono } from "hono"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const migrationsFolder = fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url))

function toCookieHeader(setCookieHeaders: string[]) {
	const sessionTokenCookie = setCookieHeaders.find((cookie) =>
		cookie.startsWith("better-auth.session_token="),
	)

	return sessionTokenCookie?.split(";", 1)[0] ?? ""
}

describe("workspaces", () => {
	let pg: StartedPostgreSqlContainer
	let dbClient: ReturnType<typeof createDbClient>
	let app: Hono
	let ensurePersonalWorkspace: typeof import("../src/services/workspace").ensurePersonalWorkspace
	let listWorkspacesForUser: typeof import("../src/services/workspace").listWorkspacesForUser

	beforeAll(async () => {
		pg = await new PostgreSqlContainer("pgvector/pgvector:pg16").start()

		process.env.NODE_ENV = "test"
		process.env.DATABASE_URL = pg.getConnectionUri()
		process.env.BETTER_AUTH_SECRET = "test_secret_32_chars_minimum_aaaa"
		process.env.BETTER_AUTH_URL = "http://localhost:3000"
		process.env.ENCRYPTION_KEY = "vmJVlH/PNqbzZGyWB5INuG2ZhuM9Q4jK0r4zNLmUKQk="
		process.env.S3_ENDPOINT = "http://localhost:9000"
		process.env.S3_ACCESS_KEY_ID = "test"
		process.env.S3_SECRET_ACCESS_KEY = "test"
		process.env.REDIS_URL = "redis://localhost:6379"
		process.env.LOG_LEVEL = "error"

		const { migrate } = await import("drizzle-orm/postgres-js/migrator")
		dbClient = createDbClient(pg.getConnectionUri())
		await migrate(dbClient.db, { migrationsFolder })

		vi.resetModules()
		const [
			{ auth },
			{ meRoutes },
			{ workspaceRoutes },
			authMiddleware,
			workspaceMiddleware,
			workspaceService,
		] = await Promise.all([
			import("../src/auth"),
			import("../src/routes/me"),
			import("../src/routes/workspaces"),
			import("../src/middleware/auth"),
			import("../src/middleware/workspace"),
			import("../src/services/workspace"),
		])

		ensurePersonalWorkspace = workspaceService.ensurePersonalWorkspace
		listWorkspacesForUser = workspaceService.listWorkspacesForUser

		app = new Hono()
		app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw))
		app.route("/api/v1", meRoutes)
		app.route("/api/v1", workspaceRoutes)
		app.get(
			"/api/v1/test/workspaces/:workspaceId/reader",
			authMiddleware.requireAuth,
			workspaceMiddleware.requireMembership("reader"),
			(c) => c.json({ ok: true, role: c.get("membershipRole") }),
		)
		app.get(
			"/api/v1/test/workspaces/:workspaceId/editor",
			authMiddleware.requireAuth,
			workspaceMiddleware.requireMembership("editor"),
			(c) => c.json({ ok: true, role: c.get("membershipRole") }),
		)
	})

	afterAll(async () => {
		await dbClient?.close()
		await pg?.stop()
	})

	async function signUp(email: string, name: string) {
		const res = await app.request("http://localhost/api/auth/sign-up/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				email,
				password: "test_password_123",
				name,
			}),
		})
		expect(res.status).toBe(200)
	}

	async function signIn(email: string) {
		const res = await app.request("http://localhost/api/auth/sign-in/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				email,
				password: "test_password_123",
			}),
		})
		expect(res.status).toBe(200)
		const cookies = res.headers.getSetCookie?.() ?? []
		const cookieHeader = toCookieHeader(cookies)
		expect(cookieHeader).not.toBe("")
		return cookieHeader
	}

	async function findUserByEmail(email: string) {
		const [record] = await dbClient.db.select().from(user).where(eq(user.email, email)).limit(1)
		expect(record).toBeDefined()
		return record
	}

	it("new user automatically gets personal workspace", async () => {
		await signUp("newuser@example.com", "New User")
		const cookieHeader = await signIn("newuser@example.com")

		const wsRes = await app.request("http://localhost/api/v1/workspaces", {
			headers: { cookie: cookieHeader },
		})
		expect(wsRes.status).toBe(200)
		const list = (await wsRes.json()) as Array<{ type: string; role: string; name: string }>
		expect(list).toHaveLength(1)
		expect(list[0]).toMatchObject({
			type: "personal",
			role: "owner",
			name: "My Research",
		})
	})

	it("ensurePersonalWorkspace is idempotent and lazy fallback restores owner membership", async () => {
		await signUp("idempotent@example.com", "Idempotent User")
		const createdUser = await findUserByEmail("idempotent@example.com")

		const first = await ensurePersonalWorkspace(createdUser.id, dbClient.db)
		const second = await ensurePersonalWorkspace(createdUser.id, dbClient.db)
		expect(second.id).toBe(first.id)

		const workspaceCount = await dbClient.db
			.select({ value: count() })
			.from(workspaces)
			.where(and(eq(workspaces.ownerUserId, createdUser.id), eq(workspaces.type, "personal")))
		expect(workspaceCount[0].value).toBe(1)

		await dbClient.db
			.delete(memberships)
			.where(and(eq(memberships.workspaceId, first.id), eq(memberships.userId, createdUser.id)))

		const items = await listWorkspacesForUser(createdUser.id, dbClient.db)
		expect(items).toHaveLength(1)
		expect(items[0].workspace.id).toBe(first.id)
		expect(items[0].role).toBe("owner")

		const restoredMemberships = await dbClient.db
			.select({ value: count() })
			.from(memberships)
			.where(and(eq(memberships.workspaceId, first.id), eq(memberships.userId, createdUser.id)))
		expect(restoredMemberships[0].value).toBe(1)
	})

	it("list endpoint returns correct workspace roles", async () => {
		await signUp("owner@example.com", "Owner User")
		await signUp("reader@example.com", "Reader User")

		const owner = await findUserByEmail("owner@example.com")
		const reader = await findUserByEmail("reader@example.com")

		const [sharedWorkspace] = await dbClient.db
			.insert(workspaces)
			.values({
				name: "Shared Lab",
				type: "shared",
				ownerUserId: owner.id,
			})
			.returning()

		await dbClient.db.insert(memberships).values([
			{ workspaceId: sharedWorkspace.id, userId: owner.id, role: "owner" },
			{ workspaceId: sharedWorkspace.id, userId: reader.id, role: "reader" },
		])

		const cookieHeader = await signIn("reader@example.com")
		const wsRes = await app.request("http://localhost/api/v1/workspaces", {
			headers: { cookie: cookieHeader },
		})
		expect(wsRes.status).toBe(200)
		const list = (await wsRes.json()) as Array<{ name: string; role: string; type: string }>
		expect(list).toHaveLength(2)
		expect(list).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "My Research", type: "personal", role: "owner" }),
				expect.objectContaining({ name: "Shared Lab", type: "shared", role: "reader" }),
			]),
		)
	})

	it("requireMembership accepts owner, rejects non-member, and enforces minRole", async () => {
		await signUp("owner-role@example.com", "Owner Role")
		await signUp("reader-role@example.com", "Reader Role")
		await signUp("outsider@example.com", "Outsider")

		const owner = await findUserByEmail("owner-role@example.com")
		const reader = await findUserByEmail("reader-role@example.com")

		const [sharedWorkspace] = await dbClient.db
			.insert(workspaces)
			.values({
				name: "Permissions Test",
				type: "shared",
				ownerUserId: owner.id,
			})
			.returning()

		await dbClient.db.insert(memberships).values([
			{ workspaceId: sharedWorkspace.id, userId: owner.id, role: "owner" },
			{ workspaceId: sharedWorkspace.id, userId: reader.id, role: "reader" },
		])

		const ownerCookie = await signIn("owner-role@example.com")
		const readerCookie = await signIn("reader-role@example.com")
		const outsiderCookie = await signIn("outsider@example.com")

		const ownerRes = await app.request(
			`http://localhost/api/v1/test/workspaces/${sharedWorkspace.id}/editor`,
			{
				headers: { cookie: ownerCookie },
			},
		)
		expect(ownerRes.status).toBe(200)

		const readerRes = await app.request(
			`http://localhost/api/v1/test/workspaces/${sharedWorkspace.id}/reader`,
			{
				headers: { cookie: readerCookie },
			},
		)
		expect(readerRes.status).toBe(200)

		const insufficientRoleRes = await app.request(
			`http://localhost/api/v1/test/workspaces/${sharedWorkspace.id}/editor`,
			{
				headers: { cookie: readerCookie },
			},
		)
		expect(insufficientRoleRes.status).toBe(403)

		const outsiderRes = await app.request(
			`http://localhost/api/v1/test/workspaces/${sharedWorkspace.id}/reader`,
			{
				headers: { cookie: outsiderCookie },
			},
		)
		expect(outsiderRes.status).toBe(403)
	})

	it("deleting a user cascades personal workspace and memberships", async () => {
		await signUp("cascade@example.com", "Cascade User")
		const createdUser = await findUserByEmail("cascade@example.com")

		const personalWorkspace = await ensurePersonalWorkspace(createdUser.id, dbClient.db)
		await dbClient.db.delete(user).where(eq(user.id, createdUser.id))

		const remainingWorkspaces = await dbClient.db
			.select({ value: count() })
			.from(workspaces)
			.where(eq(workspaces.id, personalWorkspace.id))
		const remainingMemberships = await dbClient.db
			.select({ value: count() })
			.from(memberships)
			.where(eq(memberships.workspaceId, personalWorkspace.id))

		expect(remainingWorkspaces[0].value).toBe(0)
		expect(remainingMemberships[0].value).toBe(0)
	})
})
