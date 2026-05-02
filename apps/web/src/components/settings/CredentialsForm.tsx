import { type FormEvent, useState } from "react"
import {
	type EmbeddingProvider,
	type LlmProvider,
	useCredentialsStatus,
	useUpdateCredentials,
} from "@/api/hooks/credentials"

function providerLabel(provider: LlmProvider | null | undefined) {
	if (provider === "anthropic") return "Anthropic"
	if (provider === "openai") return "OpenAI"
	return "unknown interface"
}

function embeddingProviderLabel(provider: EmbeddingProvider | null | undefined) {
	if (provider === "openai-compatible") return "OpenAI-compatible"
	if (provider === "local") return "Local"
	return "unknown provider"
}

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
	const [embeddingProvider, setEmbeddingProvider] =
		useState<EmbeddingProvider>("openai-compatible")
	const [embeddingApiKey, setEmbeddingApiKey] = useState("")
	const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState("")
	const [embeddingModel, setEmbeddingModel] = useState("")
	const [showEmbedding, setShowEmbedding] = useState(false)
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
		const embeddingApiKeyValue = embeddingApiKey.trim()
		const embeddingBaseUrlValue = embeddingBaseUrl.trim()
		const embeddingModelValue = embeddingModel.trim()

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
		if (embeddingApiKeyValue && !embeddingModelValue && !data?.embeddingModel) {
			setError("Embedding model name is required when saving an embedding API key.")
			return
		}
		if (embeddingProvider === "local" && embeddingBaseUrlValue && !embeddingModelValue && !data?.embeddingModel) {
			setError("Embedding model name is required when saving a local embedding endpoint.")
			return
		}
		if (embeddingApiKeyValue || embeddingBaseUrlValue || embeddingModelValue) {
			updates.embeddingProvider = embeddingProvider
		}
		if (embeddingApiKeyValue) {
			updates.embeddingApiKey = embeddingApiKeyValue
		}
		if (embeddingBaseUrlValue) {
			updates.embeddingBaseUrl = embeddingBaseUrlValue
		}
		if (embeddingModelValue) {
			updates.embeddingModel = embeddingModelValue
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
			setEmbeddingApiKey("")
			setEmbeddingBaseUrl("")
			setEmbeddingModel("")
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
						Used by the agent and the wiki ingestion pipeline. Choose the API interface
						family, then save the exact base URL, model name, and API key your endpoint
						expects. Sapientia never sends your key anywhere except the interface endpoint
						you configure.
					</p>
				</header>
				<div className="grid gap-4 sm:grid-cols-[180px_1fr]">
					<div className="space-y-1.5">
						<label className="block text-sm font-medium text-text-primary" htmlFor="llm-provider">
							Interface
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
									? `configured (${providerLabel(data.llmProvider)})`
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
						Optional. Override this when your key should hit a custom OpenAI or Anthropic
						base URL instead of the default official endpoint.
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
						Required. Enter the exact model or deployment name your configured interface
						endpoint expects.
					</p>
				</div>
			</section>

			<section className="space-y-3">
				<header>
					<div className="text-xs font-medium uppercase tracking-[0.16em] text-text-secondary">
						Embeddings
					</div>
					<h2 className="font-serif text-xl text-text-primary">Concept similarity backend</h2>
					<p className="mt-1 text-sm text-text-secondary">
						Used for cross-paper concept candidate retrieval. This is configured separately
						from the reading assistant model, because embedding endpoints and chat endpoints
						are often different.
					</p>
				</header>
				<div className="grid gap-4 sm:grid-cols-[180px_1fr]">
					<div className="space-y-1.5">
						<label
							className="block text-sm font-medium text-text-primary"
							htmlFor="embedding-provider"
						>
							Provider
						</label>
						<select
							className="h-10 w-full rounded-md border border-border-default bg-bg-primary px-3 text-sm text-text-primary outline-none transition-colors focus:border-border-accent"
							id="embedding-provider"
							onChange={(e) => setEmbeddingProvider(e.target.value as EmbeddingProvider)}
							value={embeddingProvider}
						>
							<option value="openai-compatible">OpenAI-compatible</option>
							<option value="local">Local</option>
						</select>
					</div>
					<div className="space-y-1.5">
						<label
							className="block text-sm font-medium text-text-primary"
							htmlFor="embedding-api-key"
						>
							API key{" "}
							<span className="text-xs text-text-tertiary">
								{data?.hasEmbeddingKey
									? `configured (${embeddingProviderLabel(data.embeddingProvider)})`
									: embeddingProvider === "local"
										? "optional for local"
										: "not configured"}
							</span>
						</label>
						<div className="flex gap-2">
							<input
								className="h-10 flex-1 rounded-md border border-border-default bg-bg-primary px-3 text-sm text-text-primary outline-none transition-colors focus:border-border-accent"
								id="embedding-api-key"
								onChange={(e) => setEmbeddingApiKey(e.target.value)}
								placeholder={
									data?.hasEmbeddingKey ? "•••••• (leave blank to keep)" : "Paste key"
								}
								type={showEmbedding ? "text" : "password"}
								value={embeddingApiKey}
							/>
							<button
								className="h-10 rounded-md border border-border-default px-3 text-xs hover:bg-surface-hover"
								onClick={() => setShowEmbedding((v) => !v)}
								type="button"
							>
								{showEmbedding ? "Hide" : "Show"}
							</button>
						</div>
					</div>
				</div>
				<div className="space-y-1.5">
					<label
						className="block text-sm font-medium text-text-primary"
						htmlFor="embedding-base-url"
					>
						Base URL{" "}
						<span className="text-xs text-text-tertiary">
							{data?.embeddingBaseUrl ? `configured (${data.embeddingBaseUrl})` : "optional"}
						</span>
					</label>
					<input
						className="h-10 w-full rounded-md border border-border-default bg-bg-primary px-3 text-sm text-text-primary outline-none transition-colors focus:border-border-accent"
						id="embedding-base-url"
						onChange={(e) => setEmbeddingBaseUrl(e.target.value)}
						placeholder={
							data?.embeddingBaseUrl ??
							(embeddingProvider === "local"
								? "http://localhost:11434/v1"
								: "https://api.siliconflow.cn/v1")
						}
						type="url"
						value={embeddingBaseUrl}
					/>
					<p className="text-xs leading-5 text-text-secondary">
						Any OpenAI-compatible embedding endpoint that accepts Bearer auth and
						`POST /embeddings`, for example SiliconFlow, OpenAI, or a compatible proxy.
						You can paste either the API base URL like `/v1` or the full embeddings URL
						like `/v1/embeddings`.
					</p>
				</div>
				<div className="space-y-1.5">
					<label
						className="block text-sm font-medium text-text-primary"
						htmlFor="embedding-model"
					>
						Model name{" "}
						<span className="text-xs text-text-tertiary">
							{data?.embeddingModel
								? `configured (${data.embeddingModel})`
								: "required for embeddings"}
						</span>
					</label>
					<input
						className="h-10 w-full rounded-md border border-border-default bg-bg-primary px-3 text-sm text-text-primary outline-none transition-colors focus:border-border-accent"
						id="embedding-model"
						onChange={(e) => setEmbeddingModel(e.target.value)}
						placeholder={
							data?.embeddingModel ?? "Qwen/Qwen3-VL-Embedding-8B / text-embedding-3-small"
						}
						type="text"
						value={embeddingModel}
					/>
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
