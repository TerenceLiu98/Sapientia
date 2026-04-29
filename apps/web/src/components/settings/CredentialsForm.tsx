import { type FormEvent, useState } from "react"
import {
	type LlmProvider,
	useCredentialsStatus,
	useUpdateCredentials,
} from "@/api/hooks/credentials"

export function CredentialsForm() {
	const status = useCredentialsStatus()
	const update = useUpdateCredentials()

	const [mineruToken, setMineruToken] = useState("")
	const [showMineru, setShowMineru] = useState(false)
	const [llmProvider, setLlmProvider] = useState<LlmProvider>("anthropic")
	const [llmApiKey, setLlmApiKey] = useState("")
	const [llmBaseUrl, setLlmBaseUrl] = useState("")
	const [llmModel, setLlmModel] = useState("")
	const [showLlm, setShowLlm] = useState(false)
	const [savedMessage, setSavedMessage] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	async function onSubmit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault()
		setError(null)
		setSavedMessage(null)

		const updates: Parameters<typeof update.mutateAsync>[0] = {}
		const llmApiKeyValue = llmApiKey.trim()
		const llmBaseUrlValue = llmBaseUrl.trim()
		const llmModelValue = llmModel.trim()

		if (mineruToken.trim()) updates.mineruToken = mineruToken.trim()
		if (llmApiKeyValue && !llmModelValue && !data?.llmModel) {
			setError("Model name is required when saving an LLM key.")
			return
		}
		if (llmApiKeyValue) {
			updates.llmProvider = llmProvider
			updates.llmApiKey = llmApiKeyValue
		}
		if (llmBaseUrlValue) {
			updates.llmBaseUrl = llmBaseUrlValue
		}
		if (llmModelValue) {
			updates.llmModel = llmModelValue
		}

		if (Object.keys(updates).length === 0) {
			setError("Nothing to save — fill in at least one field.")
			return
		}

		try {
			await update.mutateAsync(updates)
			setMineruToken("")
			setLlmApiKey("")
			setLlmBaseUrl("")
			setLlmModel("")
			setSavedMessage("Saved.")
		} catch (err) {
			setError(err instanceof Error ? err.message : "Save failed")
		}
	}

	const data = status.data

	return (
		<form className="space-y-8" onSubmit={onSubmit}>
			<section className="space-y-3">
				<header>
					<div className="text-xs font-medium uppercase tracking-[0.16em] text-text-secondary">
						MinerU
					</div>
					<h2 className="font-serif text-xl text-text-primary">PDF parsing token</h2>
					<p className="mt-1 text-sm text-text-secondary">
						Sapientia calls{" "}
						<a className="text-text-accent hover:underline" href="https://mineru.net">
							mineru.net
						</a>{" "}
						with your token to parse uploaded PDFs into block-level structure. Generate one in
						MinerU's API console.
					</p>
				</header>
				<div className="space-y-1.5">
					<label className="block text-sm font-medium text-text-primary" htmlFor="mineru-token">
						API token{" "}
						<span className="text-xs text-text-tertiary">
							{data?.hasMineruToken ? "configured" : "not configured"}
						</span>
					</label>
					<div className="flex gap-2">
						<input
							className="h-10 flex-1 rounded-md border border-border-default bg-bg-primary px-3 text-sm text-text-primary outline-none transition-colors focus:border-border-accent"
							id="mineru-token"
							onChange={(e) => setMineruToken(e.target.value)}
							placeholder={data?.hasMineruToken ? "•••••• (leave blank to keep)" : "Paste token"}
							type={showMineru ? "text" : "password"}
							value={mineruToken}
						/>
						<button
							className="h-10 rounded-md border border-border-default px-3 text-xs hover:bg-surface-hover"
							onClick={() => setShowMineru((v) => !v)}
							type="button"
						>
							{showMineru ? "Hide" : "Show"}
						</button>
					</div>
				</div>
			</section>

			<section className="space-y-3">
				<header>
					<div className="text-xs font-medium uppercase tracking-[0.16em] text-text-secondary">
						LLM
					</div>
					<h2 className="font-serif text-xl text-text-primary">Reading assistant API key</h2>
					<p className="mt-1 text-sm text-text-secondary">
						Used by the agent and the wiki ingestion pipeline. Save the provider, exact model
						name, and API key your endpoint expects. Sapientia never sends your key anywhere
						except the provider you choose.
					</p>
				</header>
				<div className="grid gap-4 sm:grid-cols-[180px_1fr]">
					<div className="space-y-1.5">
						<label className="block text-sm font-medium text-text-primary" htmlFor="llm-provider">
							Provider
						</label>
						<select
							className="h-10 w-full rounded-md border border-border-default bg-bg-primary px-3 text-sm text-text-primary outline-none transition-colors focus:border-border-accent"
							id="llm-provider"
							onChange={(e) => setLlmProvider(e.target.value as LlmProvider)}
							value={llmProvider}
						>
							<option value="anthropic">Anthropic</option>
							<option value="openai">OpenAI</option>
						</select>
					</div>
					<div className="space-y-1.5">
						<label className="block text-sm font-medium text-text-primary" htmlFor="llm-api-key">
							API key{" "}
							<span className="text-xs text-text-tertiary">
								{data?.hasLlmKey
									? `configured (${data.llmProvider ?? "unknown provider"})`
									: "not configured"}
							</span>
						</label>
						<div className="flex gap-2">
							<input
								className="h-10 flex-1 rounded-md border border-border-default bg-bg-primary px-3 text-sm text-text-primary outline-none transition-colors focus:border-border-accent"
								id="llm-api-key"
								onChange={(e) => setLlmApiKey(e.target.value)}
								placeholder={data?.hasLlmKey ? "•••••• (leave blank to keep)" : "Paste key"}
								type={showLlm ? "text" : "password"}
								value={llmApiKey}
							/>
							<button
								className="h-10 rounded-md border border-border-default px-3 text-xs hover:bg-surface-hover"
								onClick={() => setShowLlm((v) => !v)}
								type="button"
							>
								{showLlm ? "Hide" : "Show"}
							</button>
						</div>
					</div>
				</div>
				<div className="space-y-1.5">
					<label className="block text-sm font-medium text-text-primary" htmlFor="llm-base-url">
						Base URL{" "}
						<span className="text-xs text-text-tertiary">
							{data?.llmBaseUrl ? `configured (${data.llmBaseUrl})` : "optional"}
						</span>
					</label>
					<input
						className="h-10 w-full rounded-md border border-border-default bg-bg-primary px-3 text-sm text-text-primary outline-none transition-colors focus:border-border-accent"
						id="llm-base-url"
						onChange={(e) => setLlmBaseUrl(e.target.value)}
						placeholder={data?.llmBaseUrl ?? "https://api.openai.com/v1"}
						type="url"
						value={llmBaseUrl}
					/>
					<p className="text-xs leading-5 text-text-secondary">
						Optional. Use this for OpenAI-compatible endpoints or self-hosted Anthropic-compatible
						proxies.
					</p>
				</div>
				<div className="space-y-1.5">
					<label className="block text-sm font-medium text-text-primary" htmlFor="llm-model">
						Model name{" "}
						<span className="text-xs text-text-tertiary">
							{data?.llmModel ? `configured (${data.llmModel})` : "required for BYOK"}
						</span>
					</label>
					<input
						className="h-10 w-full rounded-md border border-border-default bg-bg-primary px-3 text-sm text-text-primary outline-none transition-colors focus:border-border-accent"
						id="llm-model"
						onChange={(e) => setLlmModel(e.target.value)}
						placeholder={data?.llmModel ?? "claude-sonnet-4-5 / gpt-4o / your-deployment-name"}
						type="text"
						value={llmModel}
					/>
					<p className="text-xs leading-5 text-text-secondary">
						Required. Enter the exact model or deployment name your provider endpoint expects.
					</p>
				</div>
			</section>

			{error ? <p className="text-sm text-text-error">{error}</p> : null}
			{savedMessage ? <p className="text-sm text-text-accent">{savedMessage}</p> : null}

			<button
				className="h-10 rounded-md bg-accent-600 px-4 text-sm font-medium text-text-inverse transition-colors hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-60"
				disabled={update.isPending}
				type="submit"
			>
				{update.isPending ? "Saving…" : "Save credentials"}
			</button>
		</form>
	)
}
