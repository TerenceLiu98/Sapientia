import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "../client"
import { streamAskAgentForNote } from "./agent"

afterEach(() => {
	vi.restoreAllMocks()
})

function textStream(chunks: string[]) {
	const encoder = new TextEncoder()
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
			controller.close()
		},
	})
}

describe("streamAskAgentForNote", () => {
	it("streams visible chunks and resolves the accumulated answer", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(textStream(["First ", "second."]), {
				status: 200,
				headers: { "content-type": "text/plain; charset=utf-8" },
			}),
		)
		const onChunk = vi.fn()
		const onDone = vi.fn()

		const answer = await streamAskAgentForNote(
			{
				paperId: "paper-1",
				workspaceId: "workspace-1",
				question: "Explain",
				selectionContext: { blockIds: ["blk-1"], selectedText: "Selected" },
			},
			{ onChunk, onDone },
		)

		expect(answer).toBe("First second.")
		expect(onChunk).toHaveBeenNthCalledWith(1, "First ", "First ")
		expect(onChunk).toHaveBeenNthCalledWith(2, "second.", "First second.")
		expect(onDone).toHaveBeenCalledWith("First second.")
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/v1/agent/note-ask",
			expect.objectContaining({
				method: "POST",
				credentials: "include",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					paperId: "paper-1",
					workspaceId: "workspace-1",
					question: "Explain",
					selectionContext: { blockIds: ["blk-1"], selectedText: "Selected" },
				}),
			}),
		)
	})

	it("surfaces non-ok responses through onError", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("missing credential", {
				status: 400,
				statusText: "Bad Request",
			}),
		)
		const onError = vi.fn()

		await expect(
			streamAskAgentForNote(
				{ paperId: "paper-1", workspaceId: "workspace-1", question: "Explain" },
				{ onError },
			),
		).rejects.toBeInstanceOf(ApiError)
		expect(onError).toHaveBeenCalledWith(expect.any(ApiError))
	})

	it("passes abort signals to fetch", async () => {
		const controller = new AbortController()
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(textStream(["answer"]), {
				status: 200,
			}),
		)

		await streamAskAgentForNote(
			{ paperId: "paper-1", workspaceId: "workspace-1", question: "Explain" },
			{ signal: controller.signal },
		)

		expect(fetchMock).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ signal: controller.signal }),
		)
	})
})
