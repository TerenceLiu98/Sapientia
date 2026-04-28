import { fileURLToPath } from "node:url"
import { createDbClient, papers, user, workspacePapers, workspaces } from "@sapientia/db"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { and, eq } from "drizzle-orm"
import { Hono } from "hono"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const migrationsFolder = fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url))

function toCookieHeader(setCookieHeaders: string[]) {
	const sessionTokenCookie = setCookieHeaders.find((cookie) =>
		cookie.startsWith("better-auth.session_token="),
	)
	return sessionTokenCookie?.split(";", 1)[0] ?? ""
}

describe("reader annotations", () => {
	let pg: StartedPostgreSqlContainer
	let dbClient: ReturnType<typeof createDbClient>
	let app: Hono

	beforeAll(async () => {
		pg = await new PostgreSqlContainer("pgvector/pgvector:pg16").start()

		process.env.NODE_ENV = "test"
		process.env.DATABASE_URL = pg.getConnectionUri()
		process.env.BETTER_AUTH_SECRET = "test_secret_32_chars_minimum_aaaa"
		process.env.BETTER_AUTH_URL = "http://localhost:3000"
		process.env.ENCRYPTION_KEY = "vmJVlH/PNqbzZGyWB5INuG2ZhuM9Q4jK0r4zNLmUKQk="
		process.env.S3_ENDPOINT = "http://localhost:9000"
		process.env.S3_ACCESS_KEY_ID = "test"
		process.env.S3_SECRET_ACCESS_KEY = "testpassword"
		process.env.S3_BUCKET = "sapientia"
		process.env.S3_REGION = "us-east-1"
		process.env.S3_FORCE_PATH_STYLE = "true"
		process.env.REDIS_URL = "redis://localhost:6379"
		process.env.LOG_LEVEL = "error"

		const { migrate } = await import("drizzle-orm/postgres-js/migrator")
		dbClient = createDbClient(pg.getConnectionUri())
		await migrate(dbClient.db, { migrationsFolder })

		vi.resetModules()
		const [{ auth }, { readerAnnotationRoutes }] = await Promise.all([
			import("../src/auth"),
			import("../src/routes/reader-annotations"),
		])

		app = new Hono()
		app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw))
		app.route("/api/v1", readerAnnotationRoutes)
	})

	afterAll(async () => {
		await dbClient?.close()
		await pg?.stop()
	})

	async function signUp(email: string) {
		const res = await app.request("http://localhost/api/auth/sign-up/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email, password: "test_password_123", name: email }),
		})
		expect(res.status).toBe(200)
	}

	async function signIn(email: string) {
		const res = await app.request("http://localhost/api/auth/sign-in/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email, password: "test_password_123" }),
		})
		expect(res.status).toBe(200)
		return toCookieHeader(res.headers.getSetCookie?.() ?? [])
	}

	async function userAndWorkspace(email: string) {
		const [u] = await dbClient.db.select().from(user).where(eq(user.email, email)).limit(1)
		const [ws] = await dbClient.db
			.select()
			.from(workspaces)
			.where(and(eq(workspaces.ownerUserId, u.id), eq(workspaces.type, "personal")))
			.limit(1)
		return { userId: u.id, workspaceId: ws.id }
	}

	it("creates, lists, and deletes page-relative reader annotations", async () => {
		await signUp("reader-annotations@example.com")
		const cookie = await signIn("reader-annotations@example.com")
		const { userId, workspaceId } = await userAndWorkspace("reader-annotations@example.com")

		const [paper] = await dbClient.db
			.insert(papers)
			.values({
				ownerUserId: userId,
				contentHash: "reader-annotations-hash",
				title: "Annotated Paper",
				displayFilename: "annotated-paper.pdf",
				fileSizeBytes: 1024,
				pdfObjectKey: "papers/test/source.pdf",
				parseStatus: "done",
				enrichmentStatus: "pending",
			})
			.returning()
		await dbClient.db.insert(workspacePapers).values({
			workspaceId,
			paperId: paper.id,
			grantedBy: userId,
		})

		const create = await app.request(`http://localhost/api/v1/papers/${paper.id}/reader-annotations`, {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({
				workspaceId,
				page: 1,
				kind: "highlight",
				color: "#f4c84f",
				body: {
					rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
				},
			}),
		})
		expect(create.status).toBe(201)
		const created = (await create.json()) as { id: string; kind: string }
		expect(created.kind).toBe("highlight")

		const list = await app.request(
			`http://localhost/api/v1/papers/${paper.id}/reader-annotations?workspaceId=${workspaceId}`,
			{ headers: { cookie } },
		)
		expect(list.status).toBe(200)
		const rows = (await list.json()) as Array<{ id: string; page: number }>
		expect(rows).toHaveLength(1)
		expect(rows[0]?.id).toBe(created.id)
		expect(rows[0]?.page).toBe(1)

		const remove = await app.request(`http://localhost/api/v1/reader-annotations/${created.id}`, {
			method: "DELETE",
			headers: { cookie },
		})
		expect(remove.status).toBe(204)
	})
})
