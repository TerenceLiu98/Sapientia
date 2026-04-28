import { fileURLToPath } from "node:url"
import {
	CreateBucketCommand,
	GetObjectCommand,
	ListObjectsV2Command,
	S3Client,
} from "@aws-sdk/client-s3"
import {
	blocks,
	createDbClient,
	memberships,
	papers,
	user,
	workspacePapers,
	workspaces,
} from "@sapientia/db"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { and, count, eq } from "drizzle-orm"
import { Hono } from "hono"
import { GenericContainer, type StartedTestContainer } from "testcontainers"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const migrationsFolder = fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url))
const bucketName = "sapientia"
const maxFileSizeBytes = 50 * 1024 * 1024

function createPdfBytes(label: string) {
	return new TextEncoder().encode(
		`%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n% ${label}\n%%EOF`,
	)
}

function toCookieHeader(setCookieHeaders: string[]) {
	const sessionTokenCookie = setCookieHeaders.find((cookie) =>
		cookie.startsWith("better-auth.session_token="),
	)

	return sessionTokenCookie?.split(";", 1)[0] ?? ""
}

async function ensureBucket(client: S3Client, bucket: string) {
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

			if (attempt === 9) {
				throw error
			}

			await new Promise((resolve) => setTimeout(resolve, 250))
		}
	}
}

describe("papers", () => {
	let pg: StartedPostgreSqlContainer
	let minio: StartedTestContainer
	let dbClient: ReturnType<typeof createDbClient>
	let s3Client: S3Client
	let app: Hono

	beforeAll(async () => {
		pg = await new PostgreSqlContainer("pgvector/pgvector:pg16").start()
		minio = await new GenericContainer("minio/minio:latest")
			.withCommand(["server", "/data"])
			.withEnvironment({
				MINIO_ROOT_USER: "test",
				MINIO_ROOT_PASSWORD: "testpassword",
			})
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
			credentials: {
				accessKeyId: "test",
				secretAccessKey: "testpassword",
			},
			forcePathStyle: true,
		})
		await ensureBucket(s3Client, bucketName)

		const { migrate } = await import("drizzle-orm/postgres-js/migrator")
		dbClient = createDbClient(pg.getConnectionUri())
		await migrate(dbClient.db, { migrationsFolder })

		vi.resetModules()
		const [{ auth }, { meRoutes }, { workspaceRoutes }, { paperRoutes }] = await Promise.all([
			import("../src/auth"),
			import("../src/routes/me"),
			import("../src/routes/workspaces"),
			import("../src/routes/papers"),
		])

		app = new Hono()
		app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw))
		app.route("/api/v1", meRoutes)
		app.route("/api/v1", workspaceRoutes)
		app.route("/api/v1", paperRoutes)
	})

	afterAll(async () => {
		await dbClient?.close()
		await pg?.stop()
		await minio?.stop()
	})

	async function signUp(email: string, name: string) {
		const response = await app.request("http://localhost/api/auth/sign-up/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				email,
				password: "test_password_123",
				name,
			}),
		})
		expect(response.status).toBe(200)
	}

	async function signIn(email: string) {
		const response = await app.request("http://localhost/api/auth/sign-in/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				email,
				password: "test_password_123",
			}),
		})
		expect(response.status).toBe(200)

		const cookieHeader = toCookieHeader(response.headers.getSetCookie?.() ?? [])
		expect(cookieHeader).not.toBe("")
		return cookieHeader
	}

	async function getUserByEmail(email: string) {
		const [record] = await dbClient.db.select().from(user).where(eq(user.email, email)).limit(1)
		expect(record).toBeDefined()
		return record
	}

	async function getPersonalWorkspaceId(userId: string) {
		const [workspace] = await dbClient.db
			.select()
			.from(workspaces)
			.where(and(eq(workspaces.ownerUserId, userId), eq(workspaces.type, "personal")))
			.limit(1)
		expect(workspace).toBeDefined()
		return workspace.id
	}

	async function uploadToWorkspace(cookieHeader: string, workspaceId: string, file: File) {
		const formData = new FormData()
		formData.set("file", file)

		return app.request(`http://localhost/api/v1/workspaces/${workspaceId}/papers`, {
			method: "POST",
			headers: { cookie: cookieHeader },
			body: formData,
		})
	}

	it("uploads a valid PDF and stores metadata plus object", async () => {
		await signUp("upload@example.com", "Upload User")
		const createdUser = await getUserByEmail("upload@example.com")
		const workspaceId = await getPersonalWorkspaceId(createdUser.id)
		const cookieHeader = await signIn("upload@example.com")
		const pdfBytes = createPdfBytes("upload-success")

		const response = await uploadToWorkspace(
			cookieHeader,
			workspaceId,
			new File([pdfBytes], "attention-is-all-you-need.pdf", {
				type: "application/pdf",
			}),
		)

		expect(response.status).toBe(200)
		const paper = (await response.json()) as {
			id: string
			title: string
			parseStatus: string
			pdfObjectKey: string
		}
		expect(paper.title).toBe("attention-is-all-you-need")
		expect(paper.parseStatus).toBe("pending")

		const object = await s3Client.send(
			new GetObjectCommand({ Bucket: bucketName, Key: paper.pdfObjectKey }),
		)
		const storedBytes = new Uint8Array(await object.Body!.transformToByteArray())
		expect(Array.from(storedBytes)).toEqual(Array.from(pdfBytes))
	})

	it("dedupes per user and links the existing paper into another workspace", async () => {
		await signUp("dedup@example.com", "Dedup User")
		const createdUser = await getUserByEmail("dedup@example.com")
		const personalWorkspaceId = await getPersonalWorkspaceId(createdUser.id)
		const cookieHeader = await signIn("dedup@example.com")
		const pdfBytes = createPdfBytes("dedup-shared")

		const [sharedWorkspace] = await dbClient.db
			.insert(workspaces)
			.values({
				name: "Shared Uploads",
				type: "shared",
				ownerUserId: createdUser.id,
			})
			.returning()
		await dbClient.db.insert(memberships).values({
			workspaceId: sharedWorkspace.id,
			userId: createdUser.id,
			role: "owner",
		})

		const firstResponse = await uploadToWorkspace(
			cookieHeader,
			personalWorkspaceId,
			new File([pdfBytes], "dedup.pdf", { type: "application/pdf" }),
		)
		const firstPaper = (await firstResponse.json()) as { id: string; pdfObjectKey: string }

		const secondResponse = await uploadToWorkspace(
			cookieHeader,
			sharedWorkspace.id,
			new File([pdfBytes], "dedup.pdf", { type: "application/pdf" }),
		)
		expect(secondResponse.status).toBe(200)
		const secondPaper = (await secondResponse.json()) as { id: string; pdfObjectKey: string }
		expect(secondPaper.id).toBe(firstPaper.id)
		expect(secondPaper.pdfObjectKey).toBe(firstPaper.pdfObjectKey)

		const paperCount = await dbClient.db
			.select({ value: count() })
			.from(papers)
			.where(eq(papers.ownerUserId, createdUser.id))
		expect(paperCount[0].value).toBe(1)

		const linksCount = await dbClient.db
			.select({ value: count() })
			.from(workspacePapers)
			.where(eq(workspacePapers.paperId, firstPaper.id))
		expect(linksCount[0].value).toBe(2)

		const objects = await s3Client.send(new ListObjectsV2Command({ Bucket: bucketName }))
		const dedupObjects =
			objects.Contents?.filter((item) => item.Key === firstPaper.pdfObjectKey) ?? []
		expect(dedupObjects).toHaveLength(1)
	})

	it("creates separate paper records for different users uploading identical content", async () => {
		await signUp("user-a@example.com", "User A")
		await signUp("user-b@example.com", "User B")

		const userA = await getUserByEmail("user-a@example.com")
		const userB = await getUserByEmail("user-b@example.com")
		const workspaceA = await getPersonalWorkspaceId(userA.id)
		const workspaceB = await getPersonalWorkspaceId(userB.id)
		const cookieA = await signIn("user-a@example.com")
		const cookieB = await signIn("user-b@example.com")
		const sharedBytes = createPdfBytes("same-content-different-users")

		const responseA = await uploadToWorkspace(
			cookieA,
			workspaceA,
			new File([sharedBytes], "shared.pdf", { type: "application/pdf" }),
		)
		const responseB = await uploadToWorkspace(
			cookieB,
			workspaceB,
			new File([sharedBytes], "shared.pdf", { type: "application/pdf" }),
		)

		const paperA = (await responseA.json()) as { id: string; pdfObjectKey: string }
		const paperB = (await responseB.json()) as { id: string; pdfObjectKey: string }

		expect(paperA.id).not.toBe(paperB.id)
		expect(paperA.pdfObjectKey).not.toBe(paperB.pdfObjectKey)

		const objects = await s3Client.send(
			new ListObjectsV2Command({
				Bucket: bucketName,
				Prefix: "papers/",
			}),
		)
		expect(objects.KeyCount).toBeGreaterThanOrEqual(2)
	})

	it("rejects files larger than 50MB", async () => {
		await signUp("large@example.com", "Large File")
		const createdUser = await getUserByEmail("large@example.com")
		const workspaceId = await getPersonalWorkspaceId(createdUser.id)
		const cookieHeader = await signIn("large@example.com")
		const bytes = new Uint8Array(maxFileSizeBytes + 1)
		bytes.set(new TextEncoder().encode("%PDF-"), 0)

		const response = await uploadToWorkspace(
			cookieHeader,
			workspaceId,
			new File([bytes], "too-large.pdf", { type: "application/pdf" }),
		)

		expect(response.status).toBe(413)
	})

	it("rejects wrong content type and invalid PDF magic bytes", async () => {
		await signUp("invalid@example.com", "Invalid File")
		const createdUser = await getUserByEmail("invalid@example.com")
		const workspaceId = await getPersonalWorkspaceId(createdUser.id)
		const cookieHeader = await signIn("invalid@example.com")

		const wrongTypeResponse = await uploadToWorkspace(
			cookieHeader,
			workspaceId,
			new File([createPdfBytes("wrong-type")], "wrong-type.txt", {
				type: "text/plain",
			}),
		)
		expect(wrongTypeResponse.status).toBe(415)

		const invalidPdfResponse = await uploadToWorkspace(
			cookieHeader,
			workspaceId,
			new File([new TextEncoder().encode("not a pdf")], "invalid.pdf", {
				type: "application/pdf",
			}),
		)
		expect(invalidPdfResponse.status).toBe(400)
	})

	it("returns metadata, presigned URL, and workspace list in descending created order", async () => {
		await signUp("list@example.com", "List User")
		const createdUser = await getUserByEmail("list@example.com")
		const workspaceId = await getPersonalWorkspaceId(createdUser.id)
		const cookieHeader = await signIn("list@example.com")

		const firstUpload = await uploadToWorkspace(
			cookieHeader,
			workspaceId,
			new File([createPdfBytes("first-paper")], "first-paper.pdf", {
				type: "application/pdf",
			}),
		)
		const firstPaper = (await firstUpload.json()) as { id: string; title: string }

		await new Promise((resolve) => setTimeout(resolve, 10))

		const secondBytes = createPdfBytes("second-paper")
		const secondUpload = await uploadToWorkspace(
			cookieHeader,
			workspaceId,
			new File([secondBytes], "second-paper.pdf", {
				type: "application/pdf",
			}),
		)
		const secondPaper = (await secondUpload.json()) as { id: string; title: string }

		const metadataResponse = await app.request(`http://localhost/api/v1/papers/${firstPaper.id}`, {
			headers: { cookie: cookieHeader },
		})
		expect(metadataResponse.status).toBe(200)
		const metadata = (await metadataResponse.json()) as {
			id: string
			title: string
			parseStatus: string
		}
		expect(metadata).toMatchObject({
			id: firstPaper.id,
			title: "first-paper",
			parseStatus: "pending",
		})

		const urlResponse = await app.request(
			`http://localhost/api/v1/papers/${secondPaper.id}/pdf-url`,
			{
				headers: { cookie: cookieHeader },
			},
		)
		expect(urlResponse.status).toBe(200)
		const { url } = (await urlResponse.json()) as { url: string }
		const downloaded = await fetch(url)
		expect(downloaded.status).toBe(200)
		const downloadedBytes = new Uint8Array(await downloaded.arrayBuffer())
		expect(Array.from(downloadedBytes)).toEqual(Array.from(secondBytes))

		const listResponse = await app.request(
			`http://localhost/api/v1/workspaces/${workspaceId}/papers`,
			{
				headers: { cookie: cookieHeader },
			},
		)
		expect(listResponse.status).toBe(200)
		const listed = (await listResponse.json()) as Array<{ id: string; title: string }>
		expect(listed.map((item) => item.id)).toEqual([secondPaper.id, firstPaper.id])
	})

	it("refreshes the /blocks etag when presigned image URLs roll into a new TTL bucket", async () => {
		await signUp("blocks@example.com", "Blocks User")
		const createdUser = await getUserByEmail("blocks@example.com")
		const workspaceId = await getPersonalWorkspaceId(createdUser.id)
		const cookieHeader = await signIn("blocks@example.com")

		const upload = await uploadToWorkspace(
			cookieHeader,
			workspaceId,
			new File([createPdfBytes("blocks-paper")], "blocks-paper.pdf", {
				type: "application/pdf",
			}),
		)
		expect(upload.status).toBe(200)
		const paper = (await upload.json()) as { id: string }

		await dbClient.db.insert(blocks).values({
			paperId: paper.id,
			blockId: "figure-1",
			blockIndex: 0,
			type: "figure",
			page: 1,
			text: "Figure 1",
			caption: "Figure 1",
			imageObjectKey: `papers/${createdUser.id}/${paper.id}/images/figure-1.png`,
		})

		const nowSpy = vi.spyOn(Date, "now")
		try {
			nowSpy.mockReturnValue(301_000)
			const firstResponse = await app.request(
				`http://localhost/api/v1/papers/${paper.id}/blocks`,
				{
					headers: { cookie: cookieHeader },
				},
			)
			expect(firstResponse.status).toBe(200)
			const firstEtag = firstResponse.headers.get("etag")
			expect(firstEtag).toBeTruthy()

			nowSpy.mockReturnValue(602_000)
			const secondResponse = await app.request(
				`http://localhost/api/v1/papers/${paper.id}/blocks`,
				{
					headers: {
						cookie: cookieHeader,
						"if-none-match": firstEtag ?? "",
					},
				},
			)
			expect(secondResponse.status).toBe(200)
			expect(secondResponse.headers.get("etag")).not.toBe(firstEtag)
		} finally {
			nowSpy.mockRestore()
		}
	})

	it("forbids cross-user metadata and pdf-url access", async () => {
		await signUp("owner-paper@example.com", "Owner Paper")
		await signUp("intruder@example.com", "Intruder")

		const owner = await getUserByEmail("owner-paper@example.com")
		const ownerWorkspaceId = await getPersonalWorkspaceId(owner.id)
		const ownerCookie = await signIn("owner-paper@example.com")
		const intruderCookie = await signIn("intruder@example.com")

		const uploadResponse = await uploadToWorkspace(
			ownerCookie,
			ownerWorkspaceId,
			new File([createPdfBytes("forbidden")], "forbidden.pdf", {
				type: "application/pdf",
			}),
		)
		const uploadedPaper = (await uploadResponse.json()) as { id: string }

		const metadataResponse = await app.request(
			`http://localhost/api/v1/papers/${uploadedPaper.id}`,
			{
				headers: { cookie: intruderCookie },
			},
		)
		expect(metadataResponse.status).toBe(403)

		const urlResponse = await app.request(
			`http://localhost/api/v1/papers/${uploadedPaper.id}/pdf-url`,
			{
				headers: { cookie: intruderCookie },
			},
		)
		expect(urlResponse.status).toBe(403)
	})
})
