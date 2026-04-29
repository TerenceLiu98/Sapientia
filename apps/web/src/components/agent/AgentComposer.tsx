import { type KeyboardEvent, type RefObject } from "react"

export function AgentComposer({
	disabled,
	input,
	inputRef,
	isSending,
	onChange,
	onSubmit,
}: {
	disabled?: boolean
	input: string
	inputRef?: RefObject<HTMLTextAreaElement | null>
	isSending: boolean
	onChange: (value: string) => void
	onSubmit: () => void
}) {
	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
			event.preventDefault()
			onSubmit()
		}
	}

	return (
		<div className="border-t border-border-subtle bg-bg-primary p-4">
			<textarea
				className="min-h-28 w-full resize-none rounded-lg border border-border-default bg-bg-primary px-3 py-3 text-sm leading-6 text-text-primary outline-none transition-colors focus:border-border-accent disabled:cursor-not-allowed disabled:text-text-disabled"
				disabled={disabled || isSending}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={handleKeyDown}
				placeholder="Ask about this paper…"
				ref={inputRef}
				value={input}
			/>
			<div className="mt-3 flex items-center justify-between gap-3">
				<p className="text-xs text-text-tertiary">Cmd/Ctrl-Enter to send</p>
				<button
					className="inline-flex h-9 items-center rounded-full bg-accent-600 px-4 text-sm font-medium text-text-inverse transition-colors hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-60"
					disabled={disabled || isSending || input.trim().length === 0}
					onClick={onSubmit}
					type="button"
				>
					{isSending ? "Sending…" : "Send"}
				</button>
			</div>
		</div>
	)
}
