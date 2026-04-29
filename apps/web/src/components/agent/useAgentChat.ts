import { Chat, useChat } from "@ai-sdk/react"
import { DefaultChatTransport, type UIMessage } from "ai"
import { useMemo } from "react"
import type { AgentSelectionContext, AgentUIMessage } from "./types"

interface AgentChatSession {
	chat: Chat<AgentUIMessage>
	selectionContextRef: { current: AgentSelectionContext | undefined }
}

const agentChatSessions = new Map<string, AgentChatSession>()

export function getOrCreateAgentChatSession(args: {
	sessionKey: string
	paperId: string
	workspaceId: string
}): AgentChatSession {
	const existing = agentChatSessions.get(args.sessionKey)
	if (existing) return existing

	const selectionContextRef: AgentChatSession["selectionContextRef"] = { current: undefined }
	const chat = new Chat<AgentUIMessage>({
		transport: new DefaultChatTransport<AgentUIMessage>({
			api: "/api/v1/agent/ask",
			credentials: "include",
			prepareSendMessagesRequest: ({ messages }) => ({
				body: {
					paperId: args.paperId,
					workspaceId: args.workspaceId,
					messages: pruneEmptyMessages(messages),
					selectionContext: selectionContextRef.current,
				},
			}),
		}),
	})

	const session = { chat, selectionContextRef }
	agentChatSessions.set(args.sessionKey, session)
	return session
}

export function useAgentChat(chat: Chat<AgentUIMessage>) {
	return useChat<AgentUIMessage>({
		chat: useMemo(() => chat, [chat]),
	})
}

function pruneEmptyMessages<T extends UIMessage>(messages: T[]) {
	return messages.filter((message) => message.parts.length > 0)
}
