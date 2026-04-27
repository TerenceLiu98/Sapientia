import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { usePaper, usePapers } from "./papers"

function makeWrapper() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	)
}

afterEach(() => {
	vi.restoreAllMocks()
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
