import { ApiError } from "../client"

export interface AskAgentForNoteInput {
	paperId: string
	workspaceId: string
	question: string
	selectionContext?: {
		blockIds: string[]
		selectedText?: string
	}
}

export interface StreamAskAgentForNoteCallbacks {
	onChunk?: (chunk: string, accumulated: string) => void
	onDone?: (answer: string) => void
	onError?: (error: Error) => void
	signal?: AbortSignal
}

export async function streamAskAgentForNote(
	input: AskAgentForNoteInput,
	callbacks: StreamAskAgentForNoteCallbacks = {},
) {
	let accumulated = ""
	try {
		const response = await fetch("/api/v1/agent/note-ask", {
			method: "POST",
			credentials: "include",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(input),
			signal: callbacks.signal,
		})

		if (!response.ok) {
			const body = await response.text().catch(() => undefined)
			throw new ApiError(response.status, response.statusText, body)
		}
		if (!response.body) {
			throw new ApiError(response.status, "Streaming response body missing")
		}

		const reader = response.body.getReader()
		const decoder = new TextDecoder()
		try {
			while (true) {
				const { done, value } = await reader.read()
				if (done) break
				const chunk = decoder.decode(value, { stream: true })
				if (!chunk) continue
				accumulated += chunk
				callbacks.onChunk?.(chunk, accumulated)
			}
			const tail = decoder.decode()
			if (tail) {
				accumulated += tail
				callbacks.onChunk?.(tail, accumulated)
			}
		} finally {
			reader.releaseLock()
		}

		callbacks.onDone?.(accumulated)
		return accumulated
	} catch (error) {
		const normalized = error instanceof Error ? error : new Error("Ask failed")
		callbacks.onError?.(normalized)
		throw normalized
	}
}
