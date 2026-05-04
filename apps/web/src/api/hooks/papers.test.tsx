import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { usePaper, usePapers, useRetryPaperKnowledge, useRetryPaperParse } from "./papers"

function makeWrapper() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	})
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	)
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe("useRetryPaperParse", () => {
	it("posts a parse retry and invalidates paper queries", async () => {
		const paper = {
			id: "paper-1",
			title: "Paper",
			authors: [],
			year: null,
			doi: null,
			arxivId: null,
			venue: null,
			displayFilename: "Paper.pdf",
			fileSizeBytes: 12_345,
			parseStatus: "pending",
			parseError: null,
			parseProgressExtracted: null,
			parseProgressTotal: null,
			enrichmentStatus: "pending",
			enrichmentSource: null,
			metadataEditedByUser: {},
			createdAt: "2026-04-26T00:00:00Z",
			updatedAt: "2026-04-26T00:00:00Z",
		}
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					ok: true,
					status: "queued",
					paper,
					queue: "paper-parse",
				}),
				{ status: 202, headers: { "content-type": "application/json" } },
			),
		)

		const { result } = renderHook(() => useRetryPaperParse("ws-1"), {
			wrapper: makeWrapper(),
		})

		let response: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined
		await act(async () => {
			response = await result.current.mutateAsync("paper-1")
		})

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/v1/papers/paper-1/retry-parse",
			expect.objectContaining({
				credentials: "include",
				method: "POST",
			}),
		)
		expect(response?.paper.parseStatus).toBe("pending")
	})
})

describe("useRetryPaperKnowledge", () => {
	it("posts a knowledge retry", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					ok: true,
					status: "queued",
					paperId: "paper-1",
					queue: "paper-summarize",
				}),
				{ status: 202, headers: { "content-type": "application/json" } },
			),
		)

		const { result } = renderHook(() => useRetryPaperKnowledge("ws-1"), {
			wrapper: makeWrapper(),
		})

		let response: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined
		await act(async () => {
			response = await result.current.mutateAsync("paper-1")
		})

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/v1/papers/paper-1/retry-knowledge",
			expect.objectContaining({
				credentials: "include",
				method: "POST",
			}),
		)
		expect(response?.queue).toBe("paper-summarize")
	})
})

describe("usePapers", () => {
	it("fetches the workspace papers list", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify([
					{
						id: "p1",
						title: "Paper",
						authors: ["Ada Lovelace"],
						year: 2024,
						doi: null,
						arxivId: null,
						venue: "ICLR",
						displayFilename: "Lovelace-2024-Paper.pdf",
						fileSizeBytes: 12_345,
						parseStatus: "pending",
						parseError: null,
						parseProgressExtracted: null,
						parseProgressTotal: null,
						enrichmentStatus: "enriching",
						enrichmentSource: null,
						metadataEditedByUser: {},
						createdAt: "2026-04-26T00:00:00Z",
						updatedAt: "2026-04-26T00:00:00Z",
					},
				]),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		)

		const { result } = renderHook(() => usePapers("ws-1"), { wrapper: makeWrapper() })

		await waitFor(() => expect(result.current.isSuccess).toBe(true))
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/v1/workspaces/ws-1/papers",
			expect.objectContaining({ credentials: "include" }),
		)
		expect(result.current.data).toHaveLength(1)
		expect(result.current.data?.[0]?.title).toBe("Paper")
		expect(result.current.data?.[0]?.displayFilename).toBe("Lovelace-2024-Paper.pdf")
	})

	it("does not fire without a workspaceId", () => {
		const fetchMock = vi.spyOn(globalThis, "fetch")
		const { result } = renderHook(() => usePapers(""), { wrapper: makeWrapper() })
		expect(fetchMock).not.toHaveBeenCalled()
		expect(result.current.fetchStatus).toBe("idle")
	})
})

describe("usePaper", () => {
	it("surfaces the API error when the response is not ok", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ error: "forbidden" }), {
				status: 403,
				statusText: "Forbidden",
				headers: { "content-type": "application/json" },
			}),
		)

		const { result } = renderHook(() => usePaper("paper-x"), { wrapper: makeWrapper() })

		await waitFor(() => expect(result.current.isError).toBe(true))
		expect(result.current.error).toBeInstanceOf(Error)
	})
})
