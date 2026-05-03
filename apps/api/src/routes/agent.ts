import { memberships, workspacePapers } from "@sapientia/db"
import { and, eq } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import { db } from "../db"
import { type AuthContext, requireAuth } from "../middleware/auth"
import { streamAgentNoteAnswer } from "../services/agent"
import { LlmCallError, LlmCredentialMissingError } from "../services/llm-client"

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

agentRoutes.post("/agent/note-ask", requireAuth, async (c) => {
	const user = c.get("user")
	const requestBody = await c.req.json().catch(() => null)
	const parsed = AskAgentForNoteSchema.safeParse(requestBody)
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
		const result = await streamAgentNoteAnswer({
			userId: user.id,
			workspaceId: body.workspaceId,
			paperId: body.paperId,
			question: body.question,
			selectionContext: body.selectionContext,
			abortSignal: c.req.raw.signal,
		})
		return result.stream.toTextStreamResponse({
			headers: {
				"content-type": "text/plain; charset=utf-8",
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
