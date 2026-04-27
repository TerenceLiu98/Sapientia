import { fileURLToPath } from "node:url"
import { S3Client } from "@aws-sdk/client-s3"
import {
	blocks,
	createDbClient,
	noteBlockRefs,
	papers,
	user,
	workspacePapers,
	workspaces,
} from "@sapientia/db"
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

describe("citations (note ↔ block refs)", () => {
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
		const [{ auth }, { meRoutes }, { noteRoutes }, { paperRoutes }] = await Promise.all([
			import("../src/auth"),
			import("../src/routes/me"),
			import("../src/routes/notes"),
			import("../src/routes/papers"),
		])

		app = new Hono()
		app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw))
		app.route("/api/v1", meRoutes)
		app.route("/api/v1", noteRoutes)
		app.route("/api/v1", paperRoutes)
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

	// Insert a paper + 3 fake blocks directly. We don't need MinerU for this
	// test — the citation system only depends on (paperId, blockId) tuples
	// existing somewhere addressable.
	async function seedPaper(userId: string, workspaceId: string) {
		const [p] = await dbClient.db
			.insert(papers)
			.values({
				ownerUserId: userId,
				contentHash: `hash-${userId}-${Date.now()}`,
				title: "Cited Paper",
				fileSizeBytes: 100,
				pdfObjectKey: `papers/${userId}/x/source.pdf`,
				parseStatus: "done",
			})
			.returning()
		await dbClient.db.insert(workspacePapers).values({
			paperId: p.id,
			workspaceId,
			grantedBy: userId,
		})
		await dbClient.db.insert(blocks).values([
			{
				paperId: p.id,
				blockId: "aaaa1111",
				blockIndex: 0,
				type: "text",
				page: 1,
				bbox: null,
				text: "Block A",
			},
			{
				paperId: p.id,
				blockId: "bbbb2222",
				blockIndex: 1,
				type: "heading",
				page: 1,
				bbox: null,
				text: "Block B",
				headingLevel: 1,
			},
		])
		return p
	}

	const docCiting = (paperId: string, blockId: string, snapshot: string) => [
		{
			type: "paragraph",
			content: [
				{ type: "text", text: "see " },
				{ type: "blockCitation", props: { paperId, blockId, snapshot } },
				{ type: "text", text: " for context" },
			],
		},
	]

	it("creating a note with citations populates note_block_refs", async () => {
		await signUp("cite-create@example.com")
		const cookie = await signIn("cite-create@example.com")
		const { userId, workspaceId } = await workspaceFor("cite-create@example.com")
		const paper = await seedPaper(userId, workspaceId)

		const created = await app.request(`http://localhost/api/v1/workspaces/${workspaceId}/notes`, {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({
				paperId: paper.id,
				blocknoteJson: docCiting(paper.id, "aaaa1111", "Block A"),
			}),
		})
		expect(created.status).toBe(201)
		const { id: noteId } = (await created.json()) as { id: string }

		const refs = await dbClient.db
			.select()
			.from(noteBlockRefs)
			.where(eq(noteBlockRefs.noteId, noteId))
		expect(refs).toEqual([
			expect.objectContaining({
				noteId,
				paperId: paper.id,
				blockId: "aaaa1111",
				citationCount: 1,
			}),
		])
	})

	it("re-saving a note rebuilds refs idempotently and reflects added/removed citations", async () => {
		await signUp("cite-update@example.com")
		const cookie = await signIn("cite-update@example.com")
		const { userId, workspaceId } = await workspaceFor("cite-update@example.com")
		const paper = await seedPaper(userId, workspaceId)

		const created = await app.request(`http://localhost/api/v1/workspaces/${workspaceId}/notes`, {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({
				paperId: paper.id,
				blocknoteJson: docCiting(paper.id, "aaaa1111", "A"),
			}),
		})
		const { id: noteId } = (await created.json()) as { id: string }

		// Re-save with the same citation twice + a new one.
		const updated = await app.request(`http://localhost/api/v1/notes/${noteId}`, {
			method: "PUT",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({
				blocknoteJson: [
					{
						type: "paragraph",
						content: [
							{
								type: "blockCitation",
								props: { paperId: paper.id, blockId: "aaaa1111", snapshot: "A" },
							},
							{ type: "text", text: " and " },
							{
								type: "blockCitation",
								props: { paperId: paper.id, blockId: "aaaa1111", snapshot: "A" },
							},
							{ type: "text", text: " plus " },
							{
								type: "blockCitation",
								props: { paperId: paper.id, blockId: "bbbb2222", snapshot: "B" },
							},
						],
					},
				],
			}),
		})
		expect(updated.status).toBe(200)

		const refs = await dbClient.db
			.select()
			.from(noteBlockRefs)
			.where(eq(noteBlockRefs.noteId, noteId))
			.orderBy(noteBlockRefs.blockId)
		expect(refs.length).toBe(2)
		expect(refs[0]).toMatchObject({ blockId: "aaaa1111", citationCount: 2 })
		expect(refs[1]).toMatchObject({ blockId: "bbbb2222", citationCount: 1 })

		// Save again with no citations — refs should be empty.
		await app.request(`http://localhost/api/v1/notes/${noteId}`, {
			method: "PUT",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({
				blocknoteJson: [{ type: "paragraph", content: [{ type: "text", text: "no refs" }] }],
			}),
		})

		const empty = await dbClient.db
			.select()
			.from(noteBlockRefs)
			.where(eq(noteBlockRefs.noteId, noteId))
		expect(empty).toEqual([])
	})

	it("title-only updates do not touch refs", async () => {
		await signUp("cite-title@example.com")
		const cookie = await signIn("cite-title@example.com")
		const { userId, workspaceId } = await workspaceFor("cite-title@example.com")
		const paper = await seedPaper(userId, workspaceId)

		const created = await app.request(`http://localhost/api/v1/workspaces/${workspaceId}/notes`, {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({
				paperId: paper.id,
				blocknoteJson: docCiting(paper.id, "aaaa1111", "A"),
			}),
		})
		const { id: noteId } = (await created.json()) as { id: string }

		await app.request(`http://localhost/api/v1/notes/${noteId}`, {
			method: "PUT",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({ title: "Renamed" }),
		})

		const refs = await dbClient.db
			.select()
			.from(noteBlockRefs)
			.where(eq(noteBlockRefs.noteId, noteId))
		expect(refs.length).toBe(1)
	})

	it("GET /papers/:id/citation-counts aggregates across the caller's notes", async () => {
		await signUp("cite-counts@example.com")
		const cookie = await signIn("cite-counts@example.com")
		const { userId, workspaceId } = await workspaceFor("cite-counts@example.com")
		const paper = await seedPaper(userId, workspaceId)

		// One paper-side note (per the one-note-per-paper rule) plus a
		// standalone note in the same workspace, both citing the same block
		// — three references total.
		await app.request(`http://localhost/api/v1/workspaces/${workspaceId}/notes`, {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({
				paperId: paper.id,
				blocknoteJson: [
					{
						type: "paragraph",
						content: [
							{
								type: "blockCitation",
								props: { paperId: paper.id, blockId: "aaaa1111", snapshot: "A" },
							},
							{
								type: "blockCitation",
								props: { paperId: paper.id, blockId: "aaaa1111", snapshot: "A" },
							},
						],
					},
				],
			}),
		})
		// Standalone note (no paperId) — separate row, same blockId.
		await app.request(`http://localhost/api/v1/workspaces/${workspaceId}/notes`, {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({
				blocknoteJson: docCiting(paper.id, "aaaa1111", "A"),
			}),
		})

		const res = await app.request(`http://localhost/api/v1/papers/${paper.id}/citation-counts`, {
			headers: { cookie },
		})
		expect(res.status).toBe(200)
		const rows = (await res.json()) as Array<{ blockId: string; count: number }>
		expect(rows).toEqual([{ blockId: "aaaa1111", count: 3 }])
	})

	it("GET /papers/:id/blocks/:blockId/notes returns only notes the caller can see", async () => {
		await signUp("cite-reverse@example.com")
		const cookie = await signIn("cite-reverse@example.com")
		const { userId, workspaceId } = await workspaceFor("cite-reverse@example.com")
		const paper = await seedPaper(userId, workspaceId)

		const create = await app.request(`http://localhost/api/v1/workspaces/${workspaceId}/notes`, {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({
				paperId: paper.id,
				title: "My citing note",
				blocknoteJson: docCiting(paper.id, "bbbb2222", "B"),
			}),
		})
		const { id: noteId } = (await create.json()) as { id: string }

		const res = await app.request(
			`http://localhost/api/v1/papers/${paper.id}/blocks/bbbb2222/notes`,
			{ headers: { cookie } },
		)
		expect(res.status).toBe(200)
		const items = (await res.json()) as Array<{
			noteId: string
			title: string
			citationCount: number
		}>
		expect(items.length).toBe(1)
		expect(items[0].noteId).toBe(noteId)
		expect(items[0].title).toBe("My citing note")
		expect(items[0].citationCount).toBe(1)

		// Outsider gets neither the counts nor the reverse list (paper not
		// shared with their workspace).
		await signUp("cite-outsider@example.com")
		const outsider = await signIn("cite-outsider@example.com")
		const denied = await app.request(
			`http://localhost/api/v1/papers/${paper.id}/blocks/bbbb2222/notes`,
			{ headers: { cookie: outsider } },
		)
		expect(denied.status).toBe(403)
	})
})
