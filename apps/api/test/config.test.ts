import { beforeAll, describe, expect, it, vi } from "vitest"
import { ZodError } from "zod"

const baseEnv = {
	NODE_ENV: "test",
	PORT: "3000",
	LOG_LEVEL: "info",
	DATABASE_URL: "postgresql://sapientia:dev_password@localhost:5432/sapientia_dev",
	REDIS_URL: "redis://localhost:6379",
	S3_ENDPOINT: "http://localhost:9000",
	S3_ACCESS_KEY_ID: "test",
	S3_SECRET_ACCESS_KEY: "test",
	S3_BUCKET: "sapientia",
	S3_REGION: "us-east-1",
	S3_FORCE_PATH_STYLE: "true",
	BETTER_AUTH_SECRET: "test_secret_32_chars_minimum_aaaa",
	BETTER_AUTH_URL: "http://localhost:3000",
} satisfies NodeJS.ProcessEnv

describe("config parsing", () => {
	let parseConfig: (env: NodeJS.ProcessEnv) => Record<string, unknown>

	beforeAll(async () => {
		vi.resetModules()
		Object.assign(process.env, baseEnv)
		const configModule = await import("../src/config")
		parseConfig = configModule.parseConfig as typeof parseConfig
	})

	it("accepts email-only auth without OAuth providers", () => {
		const config = parseConfig(baseEnv)
		expect(config.BETTER_AUTH_URL).toBe("http://localhost:3000")
		expect(config.FRONTEND_ORIGIN).toBe("http://localhost:5173")
		expect(config.GOOGLE_CLIENT_ID).toBeUndefined()
		expect(config.GITHUB_CLIENT_ID).toBeUndefined()
	})

	it("requires Google OAuth env vars to be set together", () => {
		expect(() =>
			parseConfig({
				...baseEnv,
				GOOGLE_CLIENT_ID: "google-client-id",
			}),
		).toThrowError(ZodError)
	})

	it("requires GitHub OAuth env vars to be set together", () => {
		expect(() =>
			parseConfig({
				...baseEnv,
				GITHUB_CLIENT_SECRET: "github-client-secret",
			}),
		).toThrowError(ZodError)
	})

	it("accepts complete Google and GitHub OAuth config", () => {
		const config = parseConfig({
			...baseEnv,
			GOOGLE_CLIENT_ID: "google-client-id",
			GOOGLE_CLIENT_SECRET: "google-client-secret",
			GITHUB_CLIENT_ID: "github-client-id",
			GITHUB_CLIENT_SECRET: "github-client-secret",
		})

		expect(config.GOOGLE_CLIENT_ID).toBe("google-client-id")
		expect(config.GITHUB_CLIENT_ID).toBe("github-client-id")
	})
})
