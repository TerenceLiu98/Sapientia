import { fileURLToPath } from "node:url"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis"
import { Queue, Worker } from "bullmq"
import { eq } from "drizzle-orm"
import { Redis } from "ioredis"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const migrationsFolder = fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url))

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 8000) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (await predicate()) return
		await new Promise((resolve) => setTimeout(resolve, 50))
	}
	throw new Error(`waitFor timed out after ${timeoutMs}ms`)
}

describe("BullMQ worker integration", () => {
	let pg: StartedPostgreSqlContainer
	let redisContainer: StartedRedisContainer
	let connection: Redis
	let dbClient: ReturnType<typeof import("@sapientia/db")["createDbClient"]>

	beforeAll(async () => {
		pg = await new PostgreSqlContainer("pgvector/pgvector:pg16").start()
		redisContainer = await new RedisContainer("redis:7-alpine").start()

		process.env.NODE_ENV = "test"
		process.env.LOG_LEVEL = "error"
		process.env.DATABASE_URL = pg.getConnectionUri()
		process.env.REDIS_URL = `redis://${redisContainer.getHost()}:${redisContainer.getFirstMappedPort()}`
		process.env.BETTER_AUTH_SECRET = "test_secret_32_chars_minimum_aaaa"
		process.env.BETTER_AUTH_URL = "http://localhost:3000"
		process.env.ENCRYPTION_KEY = "vmJVlH/PNqbzZGyWB5INuG2ZhuM9Q4jK0r4zNLmUKQk="
		process.env.S3_ENDPOINT = "http://localhost:9000"
		process.env.S3_ACCESS_KEY_ID = "test"
		process.env.S3_SECRET_ACCESS_KEY = "test"
		process.env.PAPER_PARSE_STUB_MS = "20"

		connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null })

		const { migrate } = await import("drizzle-orm/postgres-js/migrator")
		const { createDbClient } = await import("@sapientia/db")
		dbClient = createDbClient(pg.getConnectionUri())
		await migrate(dbClient.db, { migrationsFolder })

		vi.resetModules()
	})

	afterAll(async () => {
		await connection.quit()
		await dbClient?.close()
		await redisContainer.stop()
		await pg.stop()
	})

	it("enqueue + worker consume basic round trip", async () => {
		const queue = new Queue("test-basic", { connection })
		const seen: number[] = []

		const worker = new Worker(
			"test-basic",
			async (job) => {
				seen.push(job.data.value as number)
				return { processed: true }
			},
			{ connection, concurrency: 1 },
		)

		await queue.add("inc", { value: 1 })
		await queue.add("inc", { value: 2 })

		await waitFor(() => seen.length === 2, 5000)
		expect(seen).toEqual([1, 2])

		await worker.close()
		await queue.close()
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
	}

	async function readPaperStatus(
		paperId: string,
	): Promise<{ status: string; error: string | null }> {
		const { papers } = await import("@sapientia/db")
		const [row] = await dbClient.db
			.select({ status: papers.parseStatus, error: papers.parseError })
			.from(papers)
			.where(eq(papers.id, paperId))
			.limit(1)
		return { status: row.status, error: row.error }
	}

	// The end-to-end happy path (pending → parsing → done) for the real
	// MinerU worker lives in paper-parse.worker.test.ts because it needs
	// credentials + a mock MinerU + MinIO. This file just verifies the
	// generic BullMQ wiring around it.

	it("retries on error and marks failed after all attempts", async () => {
		const userId = "user-fail-1"
		const paperId = "00000000-0000-0000-0000-000000000002"
		await createUser(userId)
		await createPaper(paperId, userId)

		const { papers } = await import("@sapientia/db")
		const queueName = "paper-parse-fail-test"
		const queue = new Queue(queueName, {
			connection,
			defaultJobOptions: { attempts: 2, backoff: { type: "fixed", delay: 50 } },
		})

		const worker = new Worker(
			queueName,
			async () => {
				throw new Error("simulated permanent failure")
			},
			{ connection },
		)

		worker.on("failed", async (job, err) => {
			if (!job) return
			const totalAttempts = job.opts.attempts ?? 1
			if (job.attemptsMade >= totalAttempts) {
				await dbClient.db
					.update(papers)
					.set({ parseStatus: "failed", parseError: err.message.slice(0, 500) })
					.where(eq(papers.id, paperId))
			} else {
				await dbClient.db
					.update(papers)
					.set({ parseStatus: "pending" })
					.where(eq(papers.id, paperId))
			}
		})

		await queue.add("parse", { paperId, userId }, { jobId: `pp-${paperId}` })

		await waitFor(async () => (await readPaperStatus(paperId)).status === "failed", 8000)
		const final = await readPaperStatus(paperId)
		expect(final.status).toBe("failed")
		expect(final.error).toContain("simulated permanent failure")

		await worker.close()
		await queue.close()
	})

	it("transient error: status returns to done after a successful retry", async () => {
		const userId = "user-transient-1"
		const paperId = "00000000-0000-0000-0000-000000000003"
		await createUser(userId)
		await createPaper(paperId, userId)

		const { papers } = await import("@sapientia/db")
		const queueName = "paper-parse-transient-test"
		const queue = new Queue(queueName, {
			connection,
			defaultJobOptions: { attempts: 2, backoff: { type: "fixed", delay: 50 } },
		})

		let attempts = 0
		const worker = new Worker(
			queueName,
			async () => {
				attempts += 1
				if (attempts === 1) throw new Error("transient")
				await dbClient.db
					.update(papers)
					.set({ parseStatus: "done", parseError: null })
					.where(eq(papers.id, paperId))
				return { ok: true }
			},
			{ connection },
		)

		worker.on("failed", async (job, err) => {
			if (!job) return
			const totalAttempts = job.opts.attempts ?? 1
			if (job.attemptsMade >= totalAttempts) {
				await dbClient.db
					.update(papers)
					.set({ parseStatus: "failed", parseError: err.message })
					.where(eq(papers.id, paperId))
			} else {
				await dbClient.db
					.update(papers)
					.set({ parseStatus: "pending" })
					.where(eq(papers.id, paperId))
			}
		})

		await queue.add("parse", { paperId, userId }, { jobId: `pp-${paperId}` })

		await waitFor(async () => (await readPaperStatus(paperId)).status === "done", 8000)
		expect((await readPaperStatus(paperId)).status).toBe("done")
		expect(attempts).toBe(2)

		await worker.close()
		await queue.close()
	})
})
