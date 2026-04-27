import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

const baseEnv = {
	NODE_ENV: "test",
	LOG_LEVEL: "error",
	DATABASE_URL: "postgresql://sapientia:dev_password@localhost:5432/sapientia_dev",
	REDIS_URL: "redis://localhost:6379",
	S3_ENDPOINT: "http://localhost:9000",
	S3_ACCESS_KEY_ID: "test",
	S3_SECRET_ACCESS_KEY: "test",
	BETTER_AUTH_SECRET: "test_secret_32_chars_minimum_aaaa",
	BETTER_AUTH_URL: "http://localhost:3000",
	ENCRYPTION_KEY: "vmJVlH/PNqbzZGyWB5INuG2ZhuM9Q4jK0r4zNLmUKQk=",
	MINERU_BASE_URL: "https://mineru.test",
} satisfies NodeJS.ProcessEnv

let mineru: typeof import("../src/services/mineru-client")

beforeAll(async () => {
	Object.assign(process.env, baseEnv)
	mineru = await import("../src/services/mineru-client")
})

afterEach(() => {
	vi.restoreAllMocks()
})

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }) {
	return new Response(JSON.stringify(body), {
		...init,
		headers: { "content-type": "application/json", ...(init.headers ?? {}) },
	})
}

describe("submitParseTask", () => {
	it("returns the task_id on success", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(jsonResponse({ code: 0, msg: "ok", data: { task_id: "abc-123" } }))

		const taskId = await mineru.submitParseTask({
			token: "fake-token",
			pdfUrl: "https://minio.test/sapientia/papers/x.pdf",
			modelVersion: "vlm",
			dataId: "paper-1",
		})
		expect(taskId).toBe("abc-123")

		const [url, init] = fetchMock.mock.calls[0]
		expect(url).toBe("https://mineru.test/api/v4/extract/task")
		expect(init?.method).toBe("POST")
		expect(JSON.parse(init?.body as string)).toMatchObject({
			url: "https://minio.test/sapientia/papers/x.pdf",
			model_version: "vlm",
			data_id: "paper-1",
			enable_formula: true,
			enable_table: true,
		})
	})

	it("throws MineruApiError on non-zero code", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			jsonResponse({ code: -10001, msg: "invalid token" }),
		)

		await expect(
			mineru.submitParseTask({ token: "bad", pdfUrl: "https://x/y.pdf" }),
		).rejects.toMatchObject({ code: -10001 })
	})

	it("throws MineruApiError on HTTP failure", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("server error", { status: 500, statusText: "Internal Server Error" }),
		)

		await expect(
			mineru.submitParseTask({ token: "tok", pdfUrl: "https://x/y.pdf" }),
		).rejects.toBeInstanceOf(mineru.MineruApiError)
	})
})

describe("getTaskStatus", () => {
	it("parses the done response with full_zip_url", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			jsonResponse({
				code: 0,
				msg: "ok",
				data: {
					task_id: "abc-123",
					state: "done",
					full_zip_url: "https://cdn-mineru.openxlab.org.cn/pdf/abc.zip",
				},
			}),
		)

		const status = await mineru.getTaskStatus({ token: "tok", taskId: "abc-123" })
		expect(status.state).toBe("done")
		expect(status.zipUrl).toBe("https://cdn-mineru.openxlab.org.cn/pdf/abc.zip")
	})

	it("parses the running response with progress", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			jsonResponse({
				code: 0,
				msg: "ok",
				data: {
					task_id: "abc-123",
					state: "running",
					extract_progress: { extracted_pages: 3, total_pages: 12 },
				},
			}),
		)

		const status = await mineru.getTaskStatus({ token: "tok", taskId: "abc-123" })
		expect(status.state).toBe("running")
		expect(status.extractedPages).toBe(3)
		expect(status.totalPages).toBe(12)
	})
})

describe("waitForCompletion", () => {
	it("polls until done", async () => {
		const responses = [
			jsonResponse({ code: 0, msg: "ok", data: { task_id: "t", state: "running" } }),
			jsonResponse({ code: 0, msg: "ok", data: { task_id: "t", state: "running" } }),
			jsonResponse({
				code: 0,
				msg: "ok",
				data: { task_id: "t", state: "done", full_zip_url: "https://cdn/zip" },
			}),
		]
		vi.spyOn(globalThis, "fetch").mockImplementation(async () => responses.shift()!)

		const status = await mineru.waitForCompletion({
			token: "tok",
			taskId: "t",
			intervalMs: 1,
			timeoutMs: 5000,
		})
		expect(status.state).toBe("done")
		expect(status.zipUrl).toBe("https://cdn/zip")
	})

	it("returns failed state without throwing", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			jsonResponse({
				code: 0,
				msg: "ok",
				data: { task_id: "t", state: "failed", err_msg: "page count exceeds limit" },
			}),
		)

		const status = await mineru.waitForCompletion({
			token: "tok",
			taskId: "t",
			intervalMs: 1,
			timeoutMs: 1000,
		})
		expect(status.state).toBe("failed")
		expect(status.errorMessage).toContain("page count")
	})

	it("throws on timeout", async () => {
		// Return a fresh Response each call — Response bodies are single-use,
		// and waitForCompletion polls repeatedly.
		vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
			jsonResponse({ code: 0, msg: "ok", data: { task_id: "t", state: "running" } }),
		)

		await expect(
			mineru.waitForCompletion({ token: "tok", taskId: "t", intervalMs: 1, timeoutMs: 50 }),
		).rejects.toThrow(/did not complete/)
	})
})
