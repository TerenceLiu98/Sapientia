import { Link } from "@tanstack/react-router"
import { useEffect, useMemo, useRef, useState } from "react"
import type { Chat } from "@ai-sdk/react"
import { useCredentialsStatus } from "@/api/hooks/credentials"
import { AgentComposer } from "./AgentComposer"
import { AgentMessage } from "./AgentMessage"
import { useAgentChat } from "./useAgentChat"
import type { AgentUIMessage } from "./types"

export function AgentPanel({
	chat,
	blockNumberByBlockId,
	isOpen,
	onClose,
	onOpenBlock,
	paperTitle,
	summonNonce,
}: {
	chat: Chat<AgentUIMessage>
	blockNumberByBlockId?: Map<string, number>
	isOpen: boolean
	onClose: () => void
	onOpenBlock: (blockId: string) => void
	paperTitle: string
	summonNonce: number
}) {
	const credentials = useCredentialsStatus()
	const llmConfigured =
		Boolean(credentials.data?.hasLlmKey) &&
		Boolean(credentials.data?.llmProvider) &&
		Boolean(credentials.data?.llmModel)
	const inputRef = useRef<HTMLTextAreaElement | null>(null)
	const messagesRef = useRef<HTMLDivElement | null>(null)
	const shouldStickToBottomRef = useRef(true)
	const { messages, sendMessage, regenerate, stop, status, error, clearError } = useAgentChat(chat)
	const [input, setInput] = useState("")
	const [retryCount, setRetryCount] = useState(0)
	const visibleMessages = useMemo(() => messages.filter((message) => message.parts.length > 0), [messages])

	useEffect(() => {
		if (summonNonce === 0) return
		clearError()
		shouldStickToBottomRef.current = true
		window.setTimeout(() => inputRef.current?.focus(), 0)
	}, [clearError, summonNonce])

	useEffect(() => {
		if (!isOpen) return
		shouldStickToBottomRef.current = true
		window.setTimeout(() => inputRef.current?.focus(), 0)
	}, [isOpen])

	useEffect(() => {
		if (status === "ready") setRetryCount(0)
	}, [status])

	useEffect(() => {
		if (!isOpen || !shouldStickToBottomRef.current) return
		window.setTimeout(() => {
			scrollMessagesToBottom(messagesRef.current)
		}, 0)
	}, [isOpen, status, visibleMessages])

	const helperText = useMemo(() => {
		if (!error) return null
		if (/api key|invalid/i.test(error.message)) {
			return "API key invalid. Update your interface settings and retry."
		}
		return error.message
	}, [error])

	const handleSubmit = async () => {
		const next = input.trim()
		if (!next || status === "submitted" || status === "streaming") return
		shouldStickToBottomRef.current = true
		await sendMessage({ text: next })
		setInput("")
	}

	return (
		<div className="flex h-full flex-col">
			<div className="border-b border-border-subtle bg-bg-primary px-4 py-4">
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0">
						<div className="text-xs font-medium uppercase tracking-[0.16em] text-text-secondary">
							Agent
						</div>
						<div className="mt-1 truncate font-serif text-lg text-text-primary">{paperTitle}</div>
						<div className="mt-1 text-xs text-text-tertiary">Paper-scoped context only</div>
					</div>
					<button
						className="inline-flex h-8 items-center rounded-full border border-border-default px-3 text-sm text-text-secondary transition-colors hover:bg-surface-hover"
						onClick={() => {
							if (status === "submitted" || status === "streaming") void stop()
							onClose()
						}}
						type="button"
					>
						Close
					</button>
				</div>
			</div>

			{!llmConfigured ? (
				<div className="m-4 rounded-2xl border border-dashed border-border-default bg-bg-primary p-4">
					<p className="font-serif text-lg text-text-primary">No LLM interface configured.</p>
					<p className="mt-2 text-sm leading-6 text-text-secondary">
						Configure your LLM interface, model name, and API key in{" "}
						<Link className="text-text-accent hover:underline" to="/settings">
							Settings
						</Link>{" "}
						before asking the agent.
					</p>
				</div>
			) : (
				<>
					<div
						className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
						onScroll={() => {
							shouldStickToBottomRef.current = isNearBottom(messagesRef.current)
						}}
						ref={messagesRef}
					>
						<div className="space-y-3">
							{visibleMessages.length === 0 ? (
								<div className="rounded-2xl border border-dashed border-border-default bg-bg-primary p-4 text-sm leading-6 text-text-secondary">
									Summon the agent with a block, or ask any question about this paper.
								</div>
							) : null}
							{visibleMessages.map((message) => (
								<AgentMessage
									key={message.id}
									message={message}
									onOpenBlock={onOpenBlock}
									blockNumberByBlockId={blockNumberByBlockId}
								/>
							))}
							{helperText ? (
								<div className="rounded-2xl border border-[var(--color-status-error-text)]/15 bg-status-error-bg px-4 py-3 text-sm text-status-error-text">
									<p>{helperText}</p>
									<div className="mt-3 flex items-center gap-3">
										{retryCount < 1 && visibleMessages.length > 0 ? (
											<button
												className="inline-flex h-8 items-center rounded-full border border-border-default bg-bg-primary px-3 text-sm text-text-primary hover:bg-surface-hover"
												onClick={() => {
													setRetryCount(1)
													void regenerate()
												}}
												type="button"
											>
												Retry once
											</button>
										) : null}
										<Link className="text-sm text-text-accent hover:underline" to="/settings">
											Open Settings
										</Link>
									</div>
								</div>
							) : null}
						</div>
					</div>

					<AgentComposer
						disabled={!llmConfigured}
						input={input}
						inputRef={inputRef}
						isSending={status === "submitted" || status === "streaming"}
						onChange={setInput}
						onSubmit={() => void handleSubmit()}
					/>
				</>
			)}
		</div>
	)
}

function isNearBottom(container: HTMLDivElement | null) {
	if (!container) return true
	return container.scrollHeight - container.scrollTop - container.clientHeight < 48
}

function scrollMessagesToBottom(container: HTMLDivElement | null) {
	if (!container) return
	if (typeof container.scrollTo === "function") {
		container.scrollTo({ top: container.scrollHeight, behavior: "smooth" })
		return
	}
	container.scrollTop = container.scrollHeight
}
