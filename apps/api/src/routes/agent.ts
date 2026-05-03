import { memberships, workspacePapers } from "@sapientia/db"
import { and, eq } from "drizzle-orm"
import { type UIMessage, validateUIMessages } from "ai"
import { Hono } from "hono"
import { z } from "zod"
import { db } from "../db"
import { type AuthContext, requireAuth } from "../middleware/auth"
import { completeAgentAnswer, streamAgentAnswer } from "../services/agent"
import { LlmCallError, LlmCredentialMissingError } from "../services/llm-client"

const AskAgentSchema = z.object({
	paperId: z.string().min(1),
	workspaceId: z.string().uuid(),
	messages: z.array(z.unknown()),
	selectionContext: z
		.object({
			blockIds: z.array(z.string().min(1)).max(8),
			selectedText: z.string().trim().max(4000).optional(),
		})
		.optional(),
})

const AskAgentForNoteSchema = z.object({
	paperId: z.string().min(1),
	workspaceId: z.string().uuid(),
	question: z.string().trim().min(1).max(4000),
	selectionContext: z
		.object({
			blockIds: z.array(z.string().min(1)).max(8),
			selectedText: z.string().trim().max(4000).optional(),
		})
		.optional(),
})

export const agentRoutes = new Hono<AuthContext>()

agentRoutes.post("/agent/ask", requireAuth, async (c) => {
	const user = c.get("user")
	const parsed = AskAgentSchema.safeParse(await c.req.json())
	if (!parsed.success) {
		return c.body("Invalid request body.", 400)
	}

	const body = parsed.data
	const rows = await db
		.select({ workspaceId: memberships.workspaceId })
		.from(memberships)
		.innerJoin(
			workspacePapers,
			and(
				eq(workspacePapers.workspaceId, memberships.workspaceId),
				eq(workspacePapers.paperId, body.paperId),
			),
		)
		.where(and(eq(memberships.userId, user.id), eq(memberships.workspaceId, body.workspaceId)))
		.limit(1)
	if (rows.length === 0) {
		return c.body("Paper not available in this workspace.", 403)
	}

	try {
		const messages = await validateUIMessages<UIMessage>({
			messages: pruneEmptyMessages(body.messages),
		})
		const result = await streamAgentAnswer({
			userId: user.id,
			workspaceId: body.workspaceId,
			paperId: body.paperId,
			messages,
			selectionContext: body.selectionContext,
			abortSignal: c.req.raw.signal,
		})

		return result.stream.toUIMessageStreamResponse({
			originalMessages: messages,
			messageMetadata: ({ part }) => {
				if (part.type === "start") {
					return { model: result.model, promptId: result.promptId }
				}
				if (part.type === "finish") {
					return {
						model: result.model,
						promptId: result.promptId,
						inputTokens: part.totalUsage.inputTokens,
						outputTokens: part.totalUsage.outputTokens,
					}
				}
				return undefined
			},
		})
	} catch (error) {
		if (error instanceof LlmCredentialMissingError) {
			return c.body(error.message, 400)
		}
		if (error instanceof LlmCallError) {
			return c.body(
				error.message,
				error.status && error.status >= 400 && error.status < 500 ? 401 : 502,
			)
		}
		throw error
	}
})

agentRoutes.post("/agent/note-ask", requireAuth, async (c) => {
	const user = c.get("user")
	const parsed = AskAgentForNoteSchema.safeParse(await c.req.json())
	if (!parsed.success) {
		return c.body("Invalid request body.", 400)
	}

	const body = parsed.data
	const rows = await db
		.select({ workspaceId: memberships.workspaceId })
		.from(memberships)
		.innerJoin(
			workspacePapers,
			and(
				eq(workspacePapers.workspaceId, memberships.workspaceId),
				eq(workspacePapers.paperId, body.paperId),
			),
		)
		.where(and(eq(memberships.userId, user.id), eq(memberships.workspaceId, body.workspaceId)))
		.limit(1)
	if (rows.length === 0) {
		return c.body("Paper not available in this workspace.", 403)
	}

	try {
		const result = await completeAgentAnswer({
			userId: user.id,
			workspaceId: body.workspaceId,
			paperId: body.paperId,
			question: body.question,
			selectionContext: body.selectionContext,
			abortSignal: c.req.raw.signal,
		})
		return c.json(result)
	} catch (error) {
		if (error instanceof LlmCredentialMissingError) {
			return c.body(error.message, 400)
		}
		if (error instanceof LlmCallError) {
			return c.body(
				error.message,
				error.status && error.status >= 400 && error.status < 500 ? 401 : 502,
			)
		}
		throw error
	}
})

function pruneEmptyMessages(messages: unknown[]) {
	return messages.filter((message) => {
		if (!message || typeof message !== "object") return true
		if (!("parts" in message)) return true

		const parts = (message as { parts?: unknown }).parts
		return !Array.isArray(parts) || parts.length > 0
	})
}
