import { Hono } from "hono"
import { z } from "zod"
import { db } from "../db"
import { type AuthContext, requireAuth } from "../middleware/auth"
import {
	clearBlockHighlight,
	deleteHighlight,
	listHighlightsForPaper,
	setBlockHighlight,
} from "../services/highlight"
import { userCanAccessPaper } from "../services/paper"

export const highlightRoutes = new Hono<AuthContext>()

const ColorSchema = z.string().min(1).max(64)

// PUT body: set the block's highlight to this color (creates or overwrites).
// Frontend ships 5 built-in semantic names (questioning / important /
// original / pending / conclusion) but custom names are accepted; the DB
// just stores the string.
const SetHighlightSchema = z.object({
	workspaceId: z.string().uuid(),
	blockId: z.string().min(1),
	color: ColorSchema,
})

const ClearHighlightSchema = z.object({
	workspaceId: z.string().uuid(),
	blockId: z.string().min(1),
})

highlightRoutes.get("/papers/:paperId/highlights", requireAuth, async (c) => {
	const paperId = c.req.param("paperId")
	const workspaceId = c.req.query("workspaceId")
	if (!workspaceId) return c.json({ error: "workspaceId required" }, 400)

	const user = c.get("user")
	if (!(await userCanAccessPaper(user.id, paperId, db))) {
		return c.json({ error: "forbidden" }, 403)
	}

	const list = await listHighlightsForPaper({ paperId, userId: user.id, workspaceId })
	return c.json(list)
})

highlightRoutes.put("/papers/:paperId/highlights", requireAuth, async (c) => {
	const paperId = c.req.param("paperId")
	const user = c.get("user")
	if (!(await userCanAccessPaper(user.id, paperId, db))) {
		return c.json({ error: "forbidden" }, 403)
	}

	const parsed = SetHighlightSchema.safeParse(await c.req.json())
	if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

	const row = await setBlockHighlight({
		paperId,
		blockId: parsed.data.blockId,
		userId: user.id,
		workspaceId: parsed.data.workspaceId,
		color: parsed.data.color,
	})
	return c.json(row)
})

highlightRoutes.delete("/papers/:paperId/highlights", requireAuth, async (c) => {
	const paperId = c.req.param("paperId")
	const user = c.get("user")
	if (!(await userCanAccessPaper(user.id, paperId, db))) {
		return c.json({ error: "forbidden" }, 403)
	}

	const parsed = ClearHighlightSchema.safeParse(await c.req.json())
	if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

	const removed = await clearBlockHighlight({
		paperId,
		blockId: parsed.data.blockId,
		userId: user.id,
		workspaceId: parsed.data.workspaceId,
	})
	return c.json({ removed })
})

highlightRoutes.delete("/highlights/:id", requireAuth, async (c) => {
	const id = c.req.param("id")
	const user = c.get("user")
	const ok = await deleteHighlight({ highlightId: id, userId: user.id })
	if (!ok) return c.json({ error: "not found" }, 404)
	return c.body(null, 204)
})
