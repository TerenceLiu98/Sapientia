import { Buffer } from "node:buffer"
import { fileURLToPath } from "node:url"
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis"
import { eq } from "drizzle-orm"
import { Redis } from "ioredis"
import { GenericContainer, type StartedTestContainer } from "testcontainers"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import yazl from "yazl"

const migrationsFolder = fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url))

function buildMineruZip(contentListJson: string): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const zipfile = new yazl.ZipFile()
		zipfile.addBuffer(Buffer.from(contentListJson), "abc_content_list.json")
		zipfile.addBuffer(Buffer.from("# pretend markdown"), "abc.md")
		zipfile.end()

		const chunks: Buffer[] = []
		zipfile.outputStream.on("data", (c: Buffer) => chunks.push(c))
		zipfile.outputStream.on("end", () => resolve(Buffer.concat(chunks)))
		zipfile.outputStream.on("error", reject)
	})
}

async function waitFor(predicate: () => Promise<boolean> | boolean, timeoutMs = 15_000) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (await predicate()) return
		await new Promise((r) => setTimeout(r, 50))
	}
	throw new Error(`waitFor timed out after ${timeoutMs}ms`)
}

describe("paper-parse worker (real MinerU integration)", () => {
	let pg: StartedPostgreSqlContainer
	let redisContainer: StartedRedisContainer
	let minio: StartedTestContainer
	let connection: Redis
	let dbClient: ReturnType<typeof import("@sapientia/db")["createDbClient"]>
	let s3Test: S3Client
	let bucket: string
	let zipBytes: Buffer
	let mineruZipUrl: string

	beforeAll(async () => {
		;[pg, redisContainer, minio] = await Promise.all([
			new PostgreSqlContainer("pgvector/pgvector:pg16").start(),
			new RedisContainer("redis:7-alpine").start(),
			new GenericContainer("minio/minio:latest")
				.withCommand(["server", "/data"])
				.withEnvironment({
					MINIO_ROOT_USER: "test",
					MINIO_ROOT_PASSWORD: "testpassword",
				})
				.withExposedPorts(9000)
				.start(),
		])

		const s3Endpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`
		bucket = "sapientia-test"

		process.env.NODE_ENV = "test"
		process.env.LOG_LEVEL = "error"
		process.env.DATABASE_URL = pg.getConnectionUri()
		process.env.REDIS_URL = `redis://${redisContainer.getHost()}:${redisContainer.getFirstMappedPort()}`
		process.env.S3_ENDPOINT = s3Endpoint
		process.env.S3_ACCESS_KEY_ID = "test"
		process.env.S3_SECRET_ACCESS_KEY = "testpassword"
		process.env.S3_BUCKET = bucket
		process.env.S3_REGION = "us-east-1"
		process.env.S3_FORCE_PATH_STYLE = "true"
		process.env.BETTER_AUTH_SECRET = "test_secret_32_chars_minimum_aaaa"
		process.env.BETTER_AUTH_URL = "http://localhost:3000"
		process.env.ENCRYPTION_KEY = "vmJVlH/PNqbzZGyWB5INuG2ZhuM9Q4jK0r4zNLmUKQk="
		process.env.MINERU_BASE_URL = "https://mineru.mock"
		process.env.MINERU_POLL_INTERVAL_MS = "10"
		process.env.MINERU_POLL_TIMEOUT_MS = "5000"

		connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null })

		const { migrate } = await import("drizzle-orm/postgres-js/migrator")
		const { createDbClient } = await import("@sapientia/db")
		dbClient = createDbClient(pg.getConnectionUri())
		await migrate(dbClient.db, { migrationsFolder })

		// Provision the bucket so s3Client.send(PutObject) works.
		s3Test = new S3Client({
			endpoint: s3Endpoint,
			region: "us-east-1",
			credentials: { accessKeyId: "test", secretAccessKey: "testpassword" },
			forcePathStyle: true,
		})
		const { CreateBucketCommand } = await import("@aws-sdk/client-s3")
		await s3Test.send(new CreateBucketCommand({ Bucket: bucket }))

		zipBytes = await buildMineruZip(JSON.stringify([{ type: "text", text: "Hello.", page_idx: 0 }]))
		mineruZipUrl = "https://cdn-mineru.mock/result.zip"
	})

	afterAll(async () => {
		await connection?.quit()
		await dbClient?.close()
		await Promise.all([pg?.stop(), redisContainer?.stop(), minio?.stop()])
	})

	async function createUser(id: string) {
		const { user: userTable } = await import("@sapientia/db")
		await dbClient.db
			.insert(userTable)
			.values({
				id,
				name: id,
				email: `${id}@example.test`,
				emailVerified: false,
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.onConflictDoNothing()
	}

	async function createPaper(paperId: string, userId: string) {
		const { papers } = await import("@sapientia/db")
		await dbClient.db
			.insert(papers)
			.values({
				id: paperId,
				ownerUserId: userId,
				contentHash: `hash-${paperId}`,
				title: "Test Paper",
				fileSizeBytes: 100,
				pdfObjectKey: `papers/${userId}/${paperId}/source.pdf`,
				parseStatus: "pending",
			})
			.onConflictDoNothing()

		// Drop a tiny PDF blob into MinIO so the presigned URL works in case the
		// worker ever actually fetches it (it doesn't, since we mock fetch).
		const { PutObjectCommand } = await import("@aws-sdk/client-s3")
		await s3Test.send(
			new PutObjectCommand({
				Bucket: bucket,
				Key: `papers/${userId}/${paperId}/source.pdf`,
				Body: Buffer.from("%PDF-1.4\n%%EOF\n"),
				ContentType: "application/pdf",
			}),
		)
	}

	async function readPaper(paperId: string) {
		const { papers } = await import("@sapientia/db")
		const [row] = await dbClient.db.select().from(papers).where(eq(papers.id, paperId)).limit(1)
		return row
	}

	async function setMineruToken(userId: string, token: string) {
		const { updateCredentials } = await import("../src/services/credentials")
		await updateCredentials(userId, { mineruToken: token })
	}

	function mockMineruFetch() {
		// New batch-upload flow:
		//   POST /api/v4/file-urls/batch       → { batch_id, file_urls }
		//   PUT  <file_url>                    → 200 (we ignore the body)
		//   GET  /api/v4/extract-results/batch → { extract_result: [{ state: 'done', full_zip_url }] }
		//   GET  <full_zip_url>                → zip bytes
		const presignedPutUrl = "https://mineru.mock/upload/abc"

		return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url = typeof input === "string" ? input : (input as Request).url
			const method = (init?.method ?? (input as Request).method ?? "GET").toUpperCase()

			if (method === "POST" && url === "https://mineru.mock/api/v4/file-urls/batch") {
				return new Response(
					JSON.stringify({
						code: 0,
						msg: "ok",
						data: { batch_id: "batch-1", file_urls: [presignedPutUrl] },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				)
			}
			if (method === "PUT" && url === presignedPutUrl) {
				return new Response(null, { status: 200 })
			}
			if (method === "GET" && url.startsWith("https://mineru.mock/api/v4/extract-results/batch/")) {
				return new Response(
					JSON.stringify({
						code: 0,
						msg: "ok",
						data: {
							batch_id: "batch-1",
							extract_result: [{ file_name: "x.pdf", state: "done", full_zip_url: mineruZipUrl }],
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				)
			}
			if (url === mineruZipUrl) {
				return new Response(zipBytes, {
					status: 200,
					headers: { "content-type": "application/zip" },
				})
			}
			throw new Error(`unexpected fetch in test: ${method} ${url}`)
		})
	}

	it("happy path: pending → parsing → done with blocks.json + zip uploaded", async () => {
		const userId = "user-mineru-1"
		const paperId = "00000000-0000-0000-0000-00000000aaaa"
		await createUser(userId)
		await createPaper(paperId, userId)
		await setMineruToken(userId, "fake-mineru-token")

		const fetchMock = mockMineruFetch()

		const { enqueuePaperParse } = await import("../src/queues/paper-parse")
		const { createPaperParseWorker } = await import("../src/workers/paper-parse.worker")
		const worker = createPaperParseWorker()

		await enqueuePaperParse({ paperId, userId })

		await waitFor(async () => (await readPaper(paperId)).parseStatus === "done")

		const final = await readPaper(paperId)
		expect(final.parseStatus).toBe("done")
		expect(final.blocksObjectKey).toBe(`papers/${userId}/${paperId}/blocks.json`)

		// Verify both objects in MinIO.
		const blocks = await s3Test.send(
			new GetObjectCommand({
				Bucket: bucket,
				Key: `papers/${userId}/${paperId}/blocks.json`,
			}),
		)
		const blocksText = await blocks.Body!.transformToString()
		expect(JSON.parse(blocksText)[0].text).toBe("Hello.")

		await s3Test.send(
			new GetObjectCommand({
				Bucket: bucket,
				Key: `papers/${userId}/${paperId}/mineru-result.zip`,
			}),
		)

		// And the blocks parser should have populated the blocks table.
		const { blocks: blocksTable } = await import("@sapientia/db")
		const rows = await dbClient.db
			.select()
			.from(blocksTable)
			.where(eq(blocksTable.paperId, paperId))
		expect(rows.length).toBe(1)
		expect(rows[0].text).toBe("Hello.")
		expect(rows[0].page).toBe(1)
		expect(rows[0].type).toBe("text")

		await worker.close()
		fetchMock.mockRestore()
	})

	it("missing credential surfaces a friendly error and short-circuits without retries", async () => {
		const userId = "user-mineru-2"
		const paperId = "00000000-0000-0000-0000-00000000bbbb"
		await createUser(userId)
		await createPaper(paperId, userId)
		// no setMineruToken

		const { paperParseQueue } = await import("../src/queues/paper-parse")
		const { createPaperParseWorker } = await import("../src/workers/paper-parse.worker")
		const worker = createPaperParseWorker()

		await paperParseQueue.add(
			"parse",
			{ paperId, userId },
			{ jobId: `pp-no-cred-${paperId}`, attempts: 3, backoff: { type: "fixed", delay: 50 } },
		)

		await waitFor(async () => (await readPaper(paperId)).parseStatus === "failed", 8000)
		const final = await readPaper(paperId)
		expect(final.parseStatus).toBe("failed")
		expect(final.parseError).toContain("MinerU API token not configured")

		await worker.close()
	})
})
