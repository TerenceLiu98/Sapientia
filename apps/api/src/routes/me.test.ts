import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"

const getCredentialsStatusMock = vi.fn()
const updateCredentialsMock = vi.fn()

type MockAuthContext = {
	set: (key: string, value: unknown) => void
}

vi.mock("../middleware/auth", () => ({
	requireAuth: async (c: MockAuthContext, next: () => Promise<void>) => {
		c.set("user", {
			id: "user-1",
			email: "reader@example.test",
			name: "Reader",
			createdAt: new Date("2026-05-02T10:00:00.000Z"),
		})
		await next()
	},
}))

vi.mock("../services/credentials", () => ({
	getCredentialsStatus: (...args: unknown[]) => getCredentialsStatusMock(...args),
	updateCredentials: (...args: unknown[]) => updateCredentialsMock(...args),
}))

describe("me routes", () => {
	beforeEach(() => {
		getCredentialsStatusMock.mockReset()
		updateCredentialsMock.mockReset()
	})

	it("accepts embedding credentials independently from chat credentials", async () => {
		const { meRoutes } = await import("./me")
		const app = new Hono()
		app.route("/", meRoutes)

		const response = await app.request("/me/credentials", {
			method: "PATCH",
			body: JSON.stringify({
				embeddingProvider: "openai-compatible",
				embeddingApiKey: "embed-key",
				embeddingBaseUrl: "https://embeddings.example.test/v1",
				embeddingModel: "text-embedding-test",
			}),
			headers: { "content-type": "application/json" },
		})

		expect(response.status).toBe(200)
		expect(updateCredentialsMock).toHaveBeenCalledWith("user-1", {
			embeddingProvider: "openai-compatible",
			embeddingApiKey: "embed-key",
			embeddingBaseUrl: "https://embeddings.example.test/v1",
			embeddingModel: "text-embedding-test",
		})
	})
})
