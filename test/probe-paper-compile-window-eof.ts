/**
 * Probe paper-compile-window-v1 for one paper and persist raw model output.
 *
 * Run:
 *   set -a && source apps/api/.env && set +a && bun test/probe-paper-compile-window-eof.ts
 *
 * Useful options:
 *   --paper 2c1e8723-312d-44b1-9805-7cd16cf33d90
 *   --window page-0004
 *   --max-tokens 16000
 *   --out test/output/my-probe
 */
import { mkdir, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import type { LanguageModel } from "ai"
import type { LlmProvider } from "../apps/api/src/services/credentials"
import type { PaperCompileWindow } from "../apps/api/src/services/paper-compile-windows"

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url))
const { createAnthropic } = await import(requireFromApi.resolve("@ai-sdk/anthropic"))
const { createOpenAICompatible } = await import(
	requireFromApi.resolve("@ai-sdk/openai-compatible")
)
const { blocks: blocksTable, papers } = await import(requireFromApi.resolve("@sapientia/db"))
const { fillPrompt, formatBlocksForAgent, loadPrompt } = await import(
	requireFromApi.resolve("@sapientia/shared")
)
const { generateText } = await import(requireFromApi.resolve("ai"))
const { asc, eq } = await import(requireFromApi.resolve("drizzle-orm"))
const { z } = await import(requireFromApi.resolve("zod"))
const { closeDb, db } = await import("../apps/api/src/db")
const { getLlmCredential } = await import("../apps/api/src/services/credentials")
const { buildPaperCompileWindows } = await import(
	"../apps/api/src/services/paper-compile-windows"
)

const DEFAULT_PAPER_ID = "2c1e8723-312d-44b1-9805-7cd16cf33d90"
const WINDOW_PROMPT_ID = "paper-compile-window-v1"
const OPENAI_COMPATIBLE_PROVIDER_NAME = "sapientia-openai-compatible"
const DEFAULT_ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1"
const DEFAULT_OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"

const windowResultSchema = z.object({
	windowSummary: z.string().min(1),
	referenceBlockIds: z.array(z.string()).default([]),
	concepts: z
		.array(
			z.object({
				kind: z.enum(["concept", "method", "task", "metric", "dataset"]),
				canonicalName: z.string().min(1),
				displayName: z.string().min(1),
				evidenceBlockIds: z.array(z.string()).default([]),
			}),
		)
		.default([]),
})

type CliOptions = {
	paperId: string
	windowSelector: string | null
	maxTokens: number
	outDir: string | null
	listOnly: boolean
}

async function main() {
	const options = parseCli(process.argv.slice(2))
	const [paper] = await db.select().from(papers).where(eq(papers.id, options.paperId)).limit(1)
	if (!paper) throw new Error(`paper not found: ${options.paperId}`)

	const paperBlocks = await db
		.select({
			blockId: blocksTable.blockId,
			blockIndex: blocksTable.blockIndex,
			type: blocksTable.type,
			page: blocksTable.page,
			text: blocksTable.text,
			headingLevel: blocksTable.headingLevel,
		})
		.from(blocksTable)
		.where(eq(blocksTable.paperId, options.paperId))
		.orderBy(asc(blocksTable.blockIndex))

	const windows = buildPaperCompileWindows(paperBlocks)
	if (windows.length === 0) throw new Error(`paper has no compile windows: ${options.paperId}`)

	const credential = await getLlmCredential(paper.ownerUserId)
	if (!credential) throw new Error(`paper owner has no LLM credential: ${paper.ownerUserId}`)

	const outDir =
		options.outDir ??
		path.join(
			"test",
			"output",
			"paper-compile-window-probe",
			`${options.paperId}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
		)
	await mkdir(outDir, { recursive: true })

	console.log("paper compile window probe")
	console.table([
		{
			paperId: paper.id,
			title: paper.title,
			ownerUserId: paper.ownerUserId,
			provider: credential.provider,
			model: credential.model,
			blockCount: paperBlocks.length,
			windowCount: windows.length,
			outDir,
		},
	])

	const windowRows = windows.map((window, index) => ({
		index,
		windowId: window.windowId,
		pageRange: `${window.pageRange[0]}-${window.pageRange[1]}`,
		primaryBlocks: window.primaryBlockIds.length,
		contextBlocks: window.contextBlockIds.length,
		promptChars: buildWindowPrompt(paper, window).length,
	}))
	console.table(windowRows)
	if (options.listOnly) {
		console.log("list complete; no LLM calls were made.")
		return
	}

	const selectedWindows = selectWindows(windows, options.windowSelector)
	for (const window of selectedWindows) {
		await probeWindow({
			paper,
			window,
			credential,
			maxTokens: options.maxTokens,
			outDir,
		})
	}

	console.log(`probe complete: ${outDir}`)
}

async function probeWindow(args: {
	paper: typeof papers.$inferSelect
	window: PaperCompileWindow
	credential: {
		provider: LlmProvider
		apiKey: string
		baseURL: string | null
		model: string
	}
	maxTokens: number
	outDir: string
}) {
	const prompt = buildWindowPrompt(args.paper, args.window)
	const promptPath = path.join(args.outDir, `${args.window.windowId}.prompt.txt`)
	await writeFile(promptPath, prompt)

	console.log(`\n=== probing ${args.window.windowId} pages ${args.window.pageRange.join("-")} ===`)
	console.log(`promptChars=${prompt.length} primaryBlocks=${args.window.primaryBlockIds.length}`)

	const model = resolveLanguageModel(args.credential)
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const repairAttempt = attempt > 0
		const startedAt = Date.now()
		const result = await generateText({
			model,
			system: buildJsonObjectSystem({ repairAttempt }),
			messages: [{ role: "user", content: prompt }],
			maxOutputTokens: repairAttempt ? Math.ceil(args.maxTokens * 1.25) : args.maxTokens,
			temperature: repairAttempt ? 0 : 0.2,
			maxRetries: 0,
			providerOptions:
				args.credential.provider === "openai"
					? {
							[OPENAI_COMPATIBLE_PROVIDER_NAME]: {
								response_format: { type: "json_object" },
							},
						}
					: undefined,
		})

		const rawPath = path.join(args.outDir, `${args.window.windowId}.attempt-${attempt + 1}.raw.txt`)
		await writeFile(rawPath, result.text)

		const parseResult = parseWindowObject(result.text)
		const totalUsage = result.totalUsage
		console.table([
			{
				windowId: args.window.windowId,
				attempt: attempt + 1,
				ok: parseResult.ok,
				error: parseResult.ok ? "" : parseResult.error,
				rawChars: result.text.length,
				endsWithBrace: result.text.trimEnd().endsWith("}"),
				finishReason: result.finishReason,
				inputTokens: totalUsage.inputTokens ?? 0,
				outputTokens: totalUsage.outputTokens ?? 0,
				latencyMs: Date.now() - startedAt,
				rawPath,
			},
		])

		if (parseResult.ok) {
			console.log(
				`parsed concepts=${parseResult.object.concepts.length} refs=${parseResult.object.referenceBlockIds.length}`,
			)
			return
		}

		console.log("raw tail:")
		console.log(result.text.slice(-1200))
	}
}

function buildWindowPrompt(paper: typeof papers.$inferSelect, window: PaperCompileWindow) {
	return fillPrompt(loadPrompt(WINDOW_PROMPT_ID), {
		title: paper.title || "(untitled paper)",
		authors: Array.isArray(paper.authors) && paper.authors.length > 0 ? paper.authors.join(", ") : "(unknown)",
		windowId: window.windowId,
		pageRange: `${window.pageRange[0]}-${window.pageRange[1]}`,
		headingPath: window.headingPath.length > 0 ? window.headingPath.join(" > ") : "(none)",
		primaryBlockIds: JSON.stringify(window.primaryBlockIds),
		contextBlockIds: JSON.stringify(window.contextBlockIds),
		blocks: formatBlocksForAgent({
			blocks: window.blocks.map((block) => ({
				blockId: block.blockId,
				type: block.type,
				text: block.text,
				headingLevel: block.headingLevel,
			})),
			highlights: [],
		}),
	})
}

function parseWindowObject(text: string) {
	const trimmed = text.trim()
	const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
	const candidate = fenced?.[1] ?? trimmed
	try {
		const parsed = JSON.parse(candidate)
		const object = windowResultSchema.parse(parsed)
		return { ok: true as const, object }
	} catch (error) {
		return {
			ok: false as const,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

function buildJsonObjectSystem(options: { repairAttempt: boolean }) {
	const schemaJson = JSON.stringify(z.toJSONSchema(windowResultSchema), null, 2)
	return [
		"Return only a valid JSON object.",
		"Do not wrap the JSON in markdown fences.",
		"Do not add commentary before or after the JSON.",
		"The JSON must be complete and parseable; never stop in the middle of an array, string, or object.",
		options.repairAttempt
			? "Your previous response for this request was invalid or truncated. Return a smaller complete JSON object now."
			: null,
		`The JSON must satisfy this schema:\n${schemaJson}`,
	]
		.filter(Boolean)
		.join("\n\n")
}

function resolveLanguageModel(args: {
	provider: LlmProvider
	apiKey: string
	baseURL: string | null
	model: string
}): LanguageModel {
	if (args.provider === "anthropic") {
		return createAnthropic({
			apiKey: args.apiKey,
			baseURL: normalizeBaseUrl(args.provider, args.baseURL),
			name: "sapientia-anthropic",
		})(args.model)
	}

	return createOpenAICompatible({
		name: OPENAI_COMPATIBLE_PROVIDER_NAME,
		apiKey: args.apiKey,
		baseURL: normalizeBaseUrl(args.provider, args.baseURL),
	})(args.model)
}

function normalizeBaseUrl(provider: LlmProvider, baseURL: string | null): string {
	const fallback = provider === "anthropic" ? DEFAULT_ANTHROPIC_BASE_URL : DEFAULT_OPENAI_BASE_URL
	if (!baseURL) return fallback
	return new URL(baseURL).toString().replace(/\/$/, "")
}

function selectWindows(windows: PaperCompileWindow[], selector: string | null) {
	if (!selector) return windows
	const selected = windows.filter(
		(window, index) => window.windowId === selector || String(index) === selector,
	)
	if (selected.length === 0) {
		throw new Error(`window not found: ${selector}`)
	}
	return selected
}

function parseCli(argv: string[]): CliOptions {
	const options: CliOptions = {
		paperId: DEFAULT_PAPER_ID,
		windowSelector: null,
		maxTokens: 12_000,
		outDir: null,
		listOnly: false,
	}

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index]
		const next = argv[index + 1]
		if (arg === "--paper" && next) {
			options.paperId = next
			index += 1
			continue
		}
		if (arg === "--window" && next) {
			options.windowSelector = next
			index += 1
			continue
		}
		if (arg === "--max-tokens" && next) {
			options.maxTokens = Number.parseInt(next, 10)
			index += 1
			continue
		}
		if (arg === "--out" && next) {
			options.outDir = next
			index += 1
			continue
		}
		if (arg === "--list") {
			options.listOnly = true
			continue
		}
		if (arg === "--help" || arg === "-h") {
			printHelpAndExit()
		}
	}

	if (!Number.isFinite(options.maxTokens) || options.maxTokens <= 0) {
		throw new Error("--max-tokens must be a positive number")
	}
	return options
}

function printHelpAndExit(): never {
	console.log(`Usage:
  set -a && source apps/api/.env && set +a && bun test/probe-paper-compile-window-eof.ts

Options:
  --paper <paperId>       Paper id. Defaults to ${DEFAULT_PAPER_ID}
  --window <id|index>     Probe one window instead of every window.
  --max-tokens <number>   First-attempt output token cap. Defaults to 12000.
  --out <dir>             Output directory for prompts and raw responses.
  --list                  Print compile windows without calling the LLM.`)
	process.exit(0)
}

main()
	.catch((error) => {
		console.error(error)
		process.exitCode = 1
	})
	.finally(async () => {
		await closeDb().catch(() => undefined)
	})
