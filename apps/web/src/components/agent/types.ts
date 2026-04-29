import type { UIMessage } from "ai"

export interface AgentSelectionContext {
	blockIds: string[]
	selectedText?: string
}

export interface AgentMessageMetadata {
	model?: string
	promptId?: string
	inputTokens?: number
	outputTokens?: number
}

export type AgentUIMessage = UIMessage<AgentMessageMetadata>
