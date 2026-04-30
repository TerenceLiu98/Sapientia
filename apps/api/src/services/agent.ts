import { blockHighlights, blocks as blocksTable, papers } from "@sapientia/db"
import { fillPrompt, formatBlocksForAgent, loadPrompt } from "@sapientia/shared"
import { and, asc, eq } from "drizzle-orm"
import { convertToModelMessages, type UIMessage } from "ai"
import { db } from "../db"
import { logger } from "../logger"
import { getLlmCredential } from "./credentials"
import { LlmCredentialMissingError, streamComplete } from "./llm-client"

export const AGENT_PROMPT_ID = "agent-summon-v2"

const MAX_HISTORY_MESSAGES = 20
const MAX_CONTEXT_CHARS = 120_000

export interface AgentSelectionContext {
	blockIds: string[]
	selectedText?: string
}

export interface AgentContext {
	paperTitle: string
	paperAuthors: string
	paperSummary: string
	focusContext: string
	marginaliaSignal: string
}

export async function buildAgentContext(args: {
	paperId: string
	workspaceId: string
	userId: string
	selectionContext?: AgentSelectionContext
}): Promise<AgentContext> {
	const [paper] = await db.select().from(papers).where(eq(papers.id, args.paperId)).limit(1)
	if (!paper) throw new Error(`paper ${args.paperId} not found`)

	const paperBlocks = await db
		.select()
		.from(blocksTable)
		.where(eq(blocksTable.paperId, args.paperId))
		.orderBy(asc(blocksTable.blockIndex))

	const selectedBlockIds = Array.from(new Set(args.selectionContext?.blockIds ?? []))
	const focusBlockIndexes = new Set<number>()
	for (const blockId of selectedBlockIds) {
		const center = paperBlocks.findIndex((block) => block.blockId === blockId)
		if (center === -1) continue
		for (const index of [center - 1, center, center + 1]) {
			if (index >= 0 && index < paperBlocks.length) focusBlockIndexes.add(index)
		}
	}

	const focusBlocks = Array.from(focusBlockIndexes)
		.sort((a, b) => a - b)
		.map((index) => paperBlocks[index]!)

	const highlightRows = await db
		.select()
		.from(blockHighlights)
		.where(
			and(
				eq(blockHighlights.paperId, args.paperId),
				eq(blockHighlights.workspaceId, args.workspaceId),
				eq(blockHighlights.userId, args.userId),
			),
		)
		.orderBy(asc(blockHighlights.createdAt))

	const blocksById = new Map(paperBlocks.map((block) => [block.blockId, block]))
	const marginaliaBlocks = highlightRows
		.map((row) => {
			const block = blocksById.get(row.blockId)
			if (!block) return null
			return {
				blockId: block.blockId,
				type: block.type,
				text: truncateBlockText(block.caption || block.text),
				headingLevel: block.headingLevel,
			}
		})
		.filter((block): block is NonNullable<typeof block> => block != null)

	const focusContextBody =
		focusBlocks.length > 0
			? formatBlocksForAgent({
					blocks: focusBlocks.map((block) => ({
						blockId: block.blockId,
						type: block.type,
						text: block.caption || block.text,
						headingLevel: block.headingLevel,
					})),
					highlights: [],
					focusBlockId: selectedBlockIds[0] ?? null,
				})
			: "No explicit selection context was provided for this turn."

	const quotedSelection = args.selectionContext?.selectedText?.trim()
	const focusContext = quotedSelection
		? `Selected text:\n"${quotedSelection}"\n\nNearby blocks:\n${focusContextBody}`
		: focusContextBody

	let marginaliaSignal =
		marginaliaBlocks.length > 0
			? formatBlocksForAgent({
					blocks: marginaliaBlocks,
					highlights: highlightRows
						.map((row) => {
							const block = blocksById.get(row.blockId)
							if (!block) return null
							return {
								blockId: row.blockId,
								color: row.color,
								selectedText: truncateBlockText(block.caption || block.text),
							}
						})
						.filter((row): row is NonNullable<typeof row> => row != null),
				})
			: "No active highlights for this user in this workspace."

	const rawPaperSummary =
		paper.summary?.trim() || "No source summary has been generated for this paper yet."
	const paperSummary =
		rawPaperSummary === "No source summary has been generated for this paper yet."
			? rawPaperSummary
			: hasBlockCitations(rawPaperSummary)
				? rawPaperSummary
				: `[Legacy summary without block citations — use as background only, not as sole evidence for specific claims.]

${rawPaperSummary}`
	const totalChars = paperSummary.length + focusContext.length + marginaliaSignal.length
	if (totalChars > MAX_CONTEXT_CHARS) {
		const overflow = totalChars - MAX_CONTEXT_CHARS
		logger.warn(
			{
				paperId: args.paperId,
				workspaceId: args.workspaceId,
				userId: args.userId,
				totalChars,
				overflow,
			},
			"agent_context_truncated",
		)
		marginaliaSignal = `${marginaliaSignal.slice(0, Math.max(0, marginaliaSignal.length - overflow))}

[marginalia truncated to fit context window]`
	}

	return {
		paperTitle: paper.title,
		paperAuthors:
			Array.isArray(paper.authors) && paper.authors.length > 0
				? paper.authors.join(", ")
				: "(unknown authors)",
		paperSummary,
		focusContext,
		marginaliaSignal,
	}
}

export async function streamAgentAnswer(args: {
	userId: string
	workspaceId: string
	paperId: string
	messages: UIMessage[]
	selectionContext?: AgentSelectionContext
	abortSignal?: AbortSignal
}) {
	const credential = await getLlmCredential(args.userId)
	if (!credential) throw new LlmCredentialMissingError()

	const context = await buildAgentContext(args)
	const modelMessages = convertToModelMessages(args.messages.slice(-MAX_HISTORY_MESSAGES))
	const system = fillPrompt(loadPrompt(AGENT_PROMPT_ID), {
		paperTitle: context.paperTitle,
		paperAuthors: context.paperAuthors,
		paperSummary: context.paperSummary,
		focusContext: context.focusContext,
		marginaliaSignal: context.marginaliaSignal,
		userMessage: "Use the conversation messages below as the live user turn history for this paper-only chat.",
	})

	const stream = await streamComplete({
		userId: args.userId,
		workspaceId: args.workspaceId,
		promptId: AGENT_PROMPT_ID,
		model: credential.model,
		system,
		messages: modelMessages,
		maxTokens: 1400,
		temperature: 0.2,
		abortSignal: args.abortSignal,
	})

	return {
		context,
		model: credential.model,
		promptId: AGENT_PROMPT_ID,
		stream,
	}
}

function truncateBlockText(text: string, maxChars = 240) {
	const normalized = text.replace(/\s+/g, " ").trim()
	if (normalized.length <= maxChars) return normalized
	return `${normalized.slice(0, maxChars)}…`
}

function hasBlockCitations(text: string) {
	return /\[(?:blk|block)\s+[a-zA-Z0-9_-]+\]/i.test(text)
}
