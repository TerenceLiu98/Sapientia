import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis"
import { GenericContainer, type StartedTestContainer } from "testcontainers"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

describe("healthcheck infrastructure", () => {
	let pg: StartedPostgreSqlContainer
	let redis: StartedRedisContainer
	let minio: StartedTestContainer

	beforeAll(async () => {
		pg = await new PostgreSqlContainer("pgvector/pgvector:pg16").start()
		redis = await new RedisContainer("redis:7-alpine").start()
		minio = await new GenericContainer("minio/minio:latest")
			.withCommand(["server", "/data"])
			.withEnvironment({
				MINIO_ROOT_USER: "test",
				MINIO_ROOT_PASSWORD: "testpassword",
			})
			.withExposedPorts(9000)
			.start()

		process.env.DATABASE_URL = pg.getConnectionUri()
		process.env.REDIS_URL = `redis://${redis.getHost()}:${redis.getFirstMappedPort()}`
		process.env.S3_ENDPOINT = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`
		process.env.S3_ACCESS_KEY_ID = "test"
		process.env.S3_SECRET_ACCESS_KEY = "testpassword"
	})

	afterAll(async () => {
		await pg?.stop()
		await redis?.stop()
		await minio?.stop()
	})

	it("spins up Postgres + Redis + MinIO via testcontainers", () => {
		expect(process.env.DATABASE_URL).toBeDefined()
		expect(process.env.REDIS_URL).toBeDefined()
		expect(process.env.S3_ENDPOINT).toBeDefined()
	})
})
