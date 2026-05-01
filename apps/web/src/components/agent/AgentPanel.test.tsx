import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Chat } from "@ai-sdk/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AgentPanel } from "./AgentPanel"
import type { AgentUIMessage } from "./types"

const useCredentialsStatusMock = vi.fn()
const useAgentChatMock = vi.fn()

vi.mock("@/api/hooks/credentials", () => ({
	useCredentialsStatus: () => useCredentialsStatusMock(),
}))

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		...props
	}: {
		children?: ReactNode
		to?: unknown
	} & Record<string, unknown>) => (
		<a href={typeof to === "string" ? to : "#"} {...props}>
			{children}
		</a>
	),
}))

vi.mock("./useAgentChat", () => ({
	useAgentChat: (...args: Array<unknown>) => useAgentChatMock(...args),
}))

describe("AgentPanel", () => {
	beforeEach(() => {
		useCredentialsStatusMock.mockReset()
		useAgentChatMock.mockReset()
	})

	it("shows the settings empty state when no LLM key is configured", () => {
		useCredentialsStatusMock.mockReturnValue({
			data: { hasLlmKey: false, llmProvider: null, llmBaseUrl: null, llmModel: null },
		})
		useAgentChatMock.mockReturnValue({
			messages: [],
			sendMessage: vi.fn(),
			regenerate: vi.fn(),
			stop: vi.fn(),
			status: "ready",
			error: undefined,
			clearError: vi.fn(),
		})

		render(
			<AgentPanel
				chat={new Chat<AgentUIMessage>({})}
				blockNumberByBlockId={new Map()}
				isOpen
				onClose={() => {}}
				onOpenBlock={() => {}}
				paperTitle="A Paper"
				summonNonce={0}
			/>,
		)

		expect(screen.getByText("No LLM interface configured.")).toBeInTheDocument()
		expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument()
	})

	it("shows the settings empty state when the model name is missing", () => {
		useCredentialsStatusMock.mockReturnValue({
			data: { hasLlmKey: true, llmProvider: "anthropic", llmBaseUrl: null, llmModel: null },
		})
		useAgentChatMock.mockReturnValue({
			messages: [],
			sendMessage: vi.fn(),
			regenerate: vi.fn(),
			stop: vi.fn(),
			status: "ready",
			error: undefined,
			clearError: vi.fn(),
		})

		render(
			<AgentPanel
				chat={new Chat<AgentUIMessage>({})}
				blockNumberByBlockId={new Map()}
				isOpen
				onClose={() => {}}
				onOpenBlock={() => {}}
				paperTitle="A Paper"
				summonNonce={0}
			/>,
		)

		expect(screen.getByText("No LLM interface configured.")).toBeInTheDocument()
	})

	it("keeps the composer empty on summon and sends only the user message", async () => {
		useCredentialsStatusMock.mockReturnValue({
			data: {
				hasLlmKey: true,
				llmProvider: "anthropic",
				llmBaseUrl: null,
				llmModel: "claude-sonnet-4-5",
			},
		})

		const sendMessage = vi.fn().mockResolvedValue(undefined)
		const stop = vi.fn().mockResolvedValue(undefined)
		useAgentChatMock.mockReturnValue({
			messages: [],
			sendMessage,
			regenerate: vi.fn(),
			stop,
			status: "ready",
			error: undefined,
			clearError: vi.fn(),
		})

		const onClose = vi.fn()
		render(
			<AgentPanel
				chat={new Chat<AgentUIMessage>({})}
				blockNumberByBlockId={new Map()}
				isOpen
				onClose={onClose}
				onOpenBlock={() => {}}
				paperTitle="A Paper"
				summonNonce={1}
			/>,
		)

		const input = screen.getByPlaceholderText("Ask about this paper…")
		expect(input).toHaveValue("")

		await userEvent.type(input, "What is the key claim?")
		await userEvent.click(screen.getByRole("button", { name: "Send" }))

		expect(sendMessage).toHaveBeenCalledWith({
			text: "What is the key claim?",
		})
	})

	it("stops the upstream stream before closing when the panel is closed mid-response", async () => {
		useCredentialsStatusMock.mockReturnValue({
			data: {
				hasLlmKey: true,
				llmProvider: "anthropic",
				llmBaseUrl: null,
				llmModel: "claude-sonnet-4-5",
			},
		})

		const stop = vi.fn().mockResolvedValue(undefined)
		const onClose = vi.fn()
		useAgentChatMock.mockReturnValue({
			messages: [],
			sendMessage: vi.fn(),
			regenerate: vi.fn(),
			stop,
			status: "streaming",
			error: undefined,
			clearError: vi.fn(),
		})

		render(
			<AgentPanel
				chat={new Chat<AgentUIMessage>({})}
				blockNumberByBlockId={new Map()}
				isOpen
				onClose={onClose}
				onOpenBlock={() => {}}
				paperTitle="A Paper"
				summonNonce={0}
			/>,
		)

		await userEvent.click(screen.getByRole("button", { name: "Close" }))

		expect(stop).toHaveBeenCalledOnce()
		expect(onClose).toHaveBeenCalledOnce()
	})

	it("shows invalid-key copy and allows one retry for failed turns", async () => {
		useCredentialsStatusMock.mockReturnValue({
			data: {
				hasLlmKey: true,
				llmProvider: "anthropic",
				llmBaseUrl: null,
				llmModel: "claude-sonnet-4-5",
			},
		})

		const regenerate = vi.fn().mockResolvedValue(undefined)
		useAgentChatMock.mockReturnValue({
			messages: [
				{
					id: "user-1",
					role: "user",
					parts: [{ type: "text", text: "What does this claim mean?" }],
				},
			],
			sendMessage: vi.fn(),
			regenerate,
			stop: vi.fn(),
			status: "error",
			error: new Error("invalid api key"),
			clearError: vi.fn(),
		})

		render(
			<AgentPanel
				chat={new Chat<AgentUIMessage>({})}
				blockNumberByBlockId={new Map()}
				isOpen
				onClose={() => {}}
				onOpenBlock={() => {}}
				paperTitle="A Paper"
				summonNonce={0}
			/>,
		)

		expect(screen.getByText("API key invalid. Update your interface settings and retry.")).toBeInTheDocument()
		expect(screen.getByRole("link", { name: "Open Settings" })).toBeInTheDocument()

		const retryButton = screen.getByRole("button", { name: "Retry once" })
		await userEvent.click(retryButton)

		expect(regenerate).toHaveBeenCalledOnce()
		expect(screen.queryByRole("button", { name: "Retry once" })).not.toBeInTheDocument()
	})
})
