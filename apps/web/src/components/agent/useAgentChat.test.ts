import { describe, expect, it, vi } from "vitest"

const useChatMock = vi.fn()
const defaultChatTransportMock = vi.fn()

class MockChat {
	options: Record<string, unknown>

	constructor(options: Record<string, unknown>) {
		this.options = options
	}
}

class MockDefaultChatTransport {
	options: Record<string, unknown>

	constructor(options: Record<string, unknown>) {
		this.options = options
		defaultChatTransportMock(options)
	}
}

vi.mock("@ai-sdk/react", () => ({
	Chat: MockChat,
	useChat: (...args: Array<unknown>) => useChatMock(...args),
}))

vi.mock("ai", () => ({
	DefaultChatTransport: MockDefaultChatTransport,
}))

describe("useAgentChat session transport", () => {
	it("memoizes chat sessions by session key", async () => {
		const { getOrCreateAgentChatSession } = await import("./useAgentChat")

		const first = getOrCreateAgentChatSession({
			sessionKey: "workspace-1:paper-1",
			paperId: "paper-1",
			workspaceId: "workspace-1",
		})
		const second = getOrCreateAgentChatSession({
			sessionKey: "workspace-1:paper-1",
			paperId: "paper-1",
			workspaceId: "workspace-1",
		})

		expect(second).toBe(first)
		expect(defaultChatTransportMock).toHaveBeenCalledTimes(1)
	})

	it("sends paper/workspace ids, prunes empty messages, and forwards selection context", async () => {
		const { getOrCreateAgentChatSession } = await import("./useAgentChat")

		const session = getOrCreateAgentChatSession({
			sessionKey: "workspace-2:paper-2",
			paperId: "paper-2",
			workspaceId: "workspace-2",
		})

		session.selectionContextRef.current = {
			blockIds: ["blk-1", "blk-2"],
			selectedText: "selected snippet",
		}

		const transport = (session.chat as unknown as MockChat).options.transport as {
			options: {
				prepareSendMessagesRequest: (args: {
					messages: Array<{ id: string; role: string; parts: Array<unknown> }>
				}) => { body: Record<string, unknown> }
			}
		}

		const request = transport.options.prepareSendMessagesRequest({
			messages: [
				{
					id: "msg-1",
					role: "user",
					parts: [{ type: "text", text: "Question one" }],
				},
				{
					id: "msg-2",
					role: "assistant",
					parts: [],
				},
			],
		})

		expect(request.body).toEqual({
			paperId: "paper-2",
			workspaceId: "workspace-2",
			messages: [
				{
					id: "msg-1",
					role: "user",
					parts: [{ type: "text", text: "Question one" }],
				},
			],
			selectionContext: {
				blockIds: ["blk-1", "blk-2"],
				selectedText: "selected snippet",
			},
		})
	})
})
