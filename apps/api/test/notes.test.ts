import { fileURLToPath } from "node:url"
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3"
import { createDbClient, notes, user, workspaces } from "@sapientia/db"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { and, eq } from "drizzle-orm"
import { Hono } from "hono"
import { GenericContainer, type StartedTestContainer } from "testcontainers"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const migrationsFolder = fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url))
const bucketName = "sapientia"

function toCookieHeader(setCookieHeaders: string[]) {
	const sessionTokenCookie = setCookieHeaders.find((cookie) =>
		cookie.startsWith("better-auth.session_token="),
	)
	return sessionTokenCookie?.split(";", 1)[0] ?? ""
}

async function ensureBucket(client: S3Client, bucket: string) {
	const { CreateBucketCommand } = await import("@aws-sdk/client-s3")
	for (let attempt = 0; attempt < 10; attempt += 1) {
		try {
			await client.send(new CreateBucketCommand({ Bucket: bucket }))
			return
		} catch (error) {
			if (
				error instanceof Error &&
				/BucketAlreadyOwnedByYou|BucketAlreadyExists/.test(error.name)
			) {
				return
			}
			if (attempt === 9) throw error
			await new Promise((r) => setTimeout(r, 250))
		}
	}
}

describe("notes", () => {
	let pg: StartedPostgreSqlContainer
	let minio: StartedTestContainer
	let dbClient: ReturnType<typeof createDbClient>
	let s3Client: S3Client
	let app: Hono

	beforeAll(async () => {
		pg = await new PostgreSqlContainer("pgvector/pgvector:pg16").start()
		minio = await new GenericContainer("minio/minio:latest")
			.withCommand(["server", "/data"])
			.withEnvironment({ MINIO_ROOT_USER: "test", MINIO_ROOT_PASSWORD: "testpassword" })
			.withExposedPorts(9000)
			.start()

		const s3Endpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`

		process.env.NODE_ENV = "test"
		process.env.DATABASE_URL = pg.getConnectionUri()
		process.env.BETTER_AUTH_SECRET = "test_secret_32_chars_minimum_aaaa"
		process.env.BETTER_AUTH_URL = "http://localhost:3000"
		process.env.ENCRYPTION_KEY = "vmJVlH/PNqbzZGyWB5INuG2ZhuM9Q4jK0r4zNLmUKQk="
		process.env.S3_ENDPOINT = s3Endpoint
		process.env.S3_ACCESS_KEY_ID = "test"
		process.env.S3_SECRET_ACCESS_KEY = "testpassword"
		process.env.S3_BUCKET = bucketName
		process.env.S3_REGION = "us-east-1"
		process.env.S3_FORCE_PATH_STYLE = "true"
		process.env.REDIS_URL = "redis://localhost:6379"
		process.env.LOG_LEVEL = "error"

		s3Client = new S3Client({
			endpoint: s3Endpoint,
			region: "us-east-1",
			credentials: { accessKeyId: "test", secretAccessKey: "testpassword" },
			forcePathStyle: true,
		})
		await ensureBucket(s3Client, bucketName)

		const { migrate } = await import("drizzle-orm/postgres-js/migrator")
		dbClient = createDbClient(pg.getConnectionUri())
		await migrate(dbClient.db, { migrationsFolder })

		vi.resetModules()
		const [{ auth }, { meRoutes }, { noteRoutes }] = await Promise.all([
			import("../src/auth"),
			import("../src/routes/me"),
			import("../src/routes/notes"),
		])

		app = new Hono()
		app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw))
		app.route("/api/v1", meRoutes)
		app.route("/api/v1", noteRoutes)
	})

	afterAll(async () => {
		await dbClient?.close()
		await pg?.stop()
		await minio?.stop()
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

	async function workspaceFor(email: string) {
		const [u] = await dbClient.db.select().from(user).where(eq(user.email, email)).limit(1)
		const [ws] = await dbClient.db
			.select()
			.from(workspaces)
			.where(and(eq(workspaces.ownerUserId, u.id), eq(workspaces.type, "personal")))
			.limit(1)
		return { userId: u.id, workspaceId: ws.id }
	}

	const sampleDoc = [{ type: "paragraph", content: [{ type: "text", text: "first thoughts" }] }]

	it("POST creates a note and stores v1 JSON + markdown in MinIO", async () => {
		await signUp("note-create@example.com")
		const cookie = await signIn("note-create@example.com")
		const { workspaceId } = await workspaceFor("note-create@example.com")

		const res = await app.request(`http://localhost/api/v1/workspaces/${workspaceId}/notes`, {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({ title: "First", blocknoteJson: sampleDoc }),
		})
		expect(res.status).toBe(201)
		const note = (await res.json()) as { id: string; currentVersion: number }
		expect(note.currentVersion).toBe(1)

		const list = await s3Client.send(
			new ListObjectsV2Command({
				Bucket: bucketName,
				Prefix: `workspaces/${workspaceId}/notes/${note.id}/`,
			}),
		)
		const keys = (list.Contents ?? []).map((o) => o.Key ?? "")
		expect(keys).toContain(`workspaces/${workspaceId}/notes/${note.id}/v1.json`)
		expect(keys).toContain(`workspaces/${workspaceId}/notes/${note.id}/v1.md`)

		const md = await s3Client.send(
			new GetObjectCommand({
				Bucket: bucketName,
				Key: `workspaces/${workspaceId}/notes/${note.id}/v1.md`,
			}),
		)
		expect(await md.Body!.transformToString()).toContain("first thoughts")
	})

	it("PUT replaces JSON, increments version, and keeps the old version readable", async () => {
		await signUp("note-update@example.com")
		const cookie = await signIn("note-update@example.com")
		const { workspaceId } = await workspaceFor("note-update@example.com")

		const create = await app.request(`http://localhost/api/v1/workspaces/${workspaceId}/notes`, {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({ blocknoteJson: sampleDoc }),
		})
		const { id } = (await create.json()) as { id: string }

		const newDoc = [{ type: "paragraph", content: [{ type: "text", text: "v2 body" }] }]
		const update = await app.request(`http://localhost/api/v1/notes/${id}`, {
			method: "PUT",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({ blocknoteJson: newDoc }),
		})
		expect(update.status).toBe(200)
		const updated = (await update.json()) as { currentVersion: number }
		expect(updated.currentVersion).toBe(2)

		// v1 must still be there (history is immutable)
		const v1 = await s3Client.send(
			new GetObjectCommand({
				Bucket: bucketName,
				Key: `workspaces/${workspaceId}/notes/${id}/v1.json`,
			}),
		)
		expect(await v1.Body!.transformToString()).toContain("first thoughts")
		const v2 = await s3Client.send(
			new GetObjectCommand({
				Bucket: bucketName,
				Key: `workspaces/${workspaceId}/notes/${id}/v2.json`,
			}),
		)
		expect(await v2.Body!.transformToString()).toContain("v2 body")
	})

	it("PUT title only does not bump version", async () => {
		await signUp("note-title@example.com")
		const cookie = await signIn("note-title@example.com")
		const { workspaceId } = await workspaceFor("note-title@example.com")

		const create = await app.request(`http://localhost/api/v1/workspaces/${workspaceId}/notes`, {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({ blocknoteJson: sampleDoc }),
		})
		const { id } = (await create.json()) as { id: string }

		const titleOnly = await app.request(`http://localhost/api/v1/notes/${id}`, {
			method: "PUT",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({ title: "Renamed" }),
		})
		expect(titleOnly.status).toBe(200)
		const updated = (await titleOnly.json()) as { currentVersion: number; title: string }
		expect(updated.currentVersion).toBe(1)
		expect(updated.title).toBe("Renamed")
	})

	it("DELETE soft-deletes; subsequent GET returns 404 and list excludes it", async () => {
		await signUp("note-delete@example.com")
		const cookie = await signIn("note-delete@example.com")
		const { workspaceId } = await workspaceFor("note-delete@example.com")

		const create = await app.request(`http://localhost/api/v1/workspaces/${workspaceId}/notes`, {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({ blocknoteJson: sampleDoc }),
		})
		const { id } = (await create.json()) as { id: string }

		const del = await app.request(`http://localhost/api/v1/notes/${id}`, {
			method: "DELETE",
			headers: { cookie },
		})
		expect(del.status).toBe(204)

		const get = await app.request(`http://localhost/api/v1/notes/${id}`, {
			headers: { cookie },
		})
		expect(get.status).toBe(404)

		const list = await app.request(`http://localhost/api/v1/workspaces/${workspaceId}/notes`, {
			headers: { cookie },
		})
		const items = (await list.json()) as Array<{ id: string }>
		expect(items.find((n) => n.id === id)).toBeUndefined()

		// Deleted row is still there with deletedAt set (soft).
		const [row] = await dbClient.db.select().from(notes).where(eq(notes.id, id)).limit(1)
		expect(row.deletedAt).not.toBeNull()
	})

	it("rejects cross-workspace access with 403 on GET/PUT/DELETE", async () => {
		await signUp("owner@example.com")
		await signUp("intruder@example.com")
		const ownerCookie = await signIn("owner@example.com")
		const intruderCookie = await signIn("intruder@example.com")
		const owner = await workspaceFor("owner@example.com")

		const created = await app.request(
			`http://localhost/api/v1/workspaces/${owner.workspaceId}/notes`,
			{
				method: "POST",
				headers: { cookie: ownerCookie, "content-type": "application/json" },
				body: JSON.stringify({ blocknoteJson: sampleDoc }),
			},
		)
		const { id } = (await created.json()) as { id: string }

		const get = await app.request(`http://localhost/api/v1/notes/${id}`, {
			headers: { cookie: intruderCookie },
		})
		expect(get.status).toBe(403)

		const put = await app.request(`http://localhost/api/v1/notes/${id}`, {
			method: "PUT",
			headers: { cookie: intruderCookie, "content-type": "application/json" },
			body: JSON.stringify({ title: "hi" }),
		})
		expect(put.status).toBe(403)

		const del = await app.request(`http://localhost/api/v1/notes/${id}`, {
			method: "DELETE",
			headers: { cookie: intruderCookie },
		})
		expect(del.status).toBe(403)
	})

	it("listNotes filters by paperId (?paperId=null isolates standalone notes)", async () => {
		await signUp("note-filter@example.com")
		const cookie = await signIn("note-filter@example.com")
		const { workspaceId } = await workspaceFor("note-filter@example.com")

		// Standalone note
		await app.request(`http://localhost/api/v1/workspaces/${workspaceId}/notes`, {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({ title: "scratch", blocknoteJson: sampleDoc }),
		})

		const standalone = await app.request(
			`http://localhost/api/v1/workspaces/${workspaceId}/notes?paperId=null`,
			{ headers: { cookie } },
		)
		const items = (await standalone.json()) as Array<{ paperId: string | null }>
		expect(items.length).toBe(1)
		expect(items[0].paperId).toBeNull()
	})
})
