import { beforeEach, describe, expect, it, vi } from "vitest"

const baseEnv = {
	NODE_ENV: "test",
	PORT: "3000",
	LOG_LEVEL: "info",
	DATABASE_URL: "postgresql://sapientia:dev_password@localhost:5432/sapientia_dev",
	REDIS_URL: "redis://localhost:6379",
	S3_ENDPOINT: "http://minio:9000",
	S3_ACCESS_KEY_ID: "test",
	S3_SECRET_ACCESS_KEY: "testpassword",
	S3_BUCKET: "sapientia",
	S3_REGION: "us-east-1",
	S3_FORCE_PATH_STYLE: "true",
	BETTER_AUTH_SECRET: "test_secret_32_chars_minimum_aaaa",
	BETTER_AUTH_URL: "http://localhost:3000",
	ENCRYPTION_KEY: "vmJVlH/PNqbzZGyWB5INuG2ZhuM9Q4jK0r4zNLmUKQk=",
} satisfies NodeJS.ProcessEnv

describe("s3 presigned URLs", () => {
	beforeEach(() => {
		vi.resetModules()
		for (const key of Object.keys(baseEnv)) {
			process.env[key] = baseEnv[key as keyof typeof baseEnv]
		}
		delete process.env.S3_PUBLIC_ENDPOINT
	})

	it("falls back to S3_ENDPOINT when no public endpoint is configured", async () => {
		const { generatePresignedGetUrl } = await import("../src/services/s3-client")
		const url = await generatePresignedGetUrl("papers/u/p/source.pdf", 60)
		const parsed = new URL(url)

		expect(parsed.origin).toBe("http://minio:9000")
		expect(parsed.pathname).toBe("/sapientia/papers/u/p/source.pdf")
	})

	it("uses S3_PUBLIC_ENDPOINT for browser-facing presigned URLs", async () => {
		process.env.S3_PUBLIC_ENDPOINT = "https://minio.example.com"

		const { generatePresignedGetUrl } = await import("../src/services/s3-client")
		const url = await generatePresignedGetUrl("papers/u/p/source.pdf", 60)
		const parsed = new URL(url)

		expect(parsed.origin).toBe("https://minio.example.com")
		expect(parsed.pathname).toBe("/sapientia/papers/u/p/source.pdf")
	})
})
