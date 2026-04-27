import { Hono } from "hono"
import { z } from "zod"
import { db } from "../db"
import { type AuthContext, requireAuth } from "../middleware/auth"
import {
	createHighlightBatch,
	deleteHighlight,
	deleteHighlightsInRanges,
	listHighlightsForPaper,
	updateHighlightColor,
} from "../services/highlight"
import { userCanAccessPaper } from "../services/paper"

export const highlightRoutes = new Hono<AuthContext>()

const ColorSchema = z.enum(["questioning", "important", "original", "pending", "background"])

const HighlightInputSchema = z.object({
	blockId: z.string(),
	charStart: z.number().int().nonnegative().nullable(),
	charEnd: z.number().int().nonnegative().nullable(),
	selectedText: z.string(),
})

const CreateBatchSchema = z.object({
	workspaceId: z.string().uuid(),
	color: ColorSchema,
	highlights: z.array(HighlightInputSchema).min(1).max(50),
})

const DeleteByRangeSchema = z.object({
	workspaceId: z.string().uuid(),
	ranges: z
		.array(
			z.object({
				blockId: z.string(),
				charStart: z.number().int().nullable(),
				charEnd: z.number().int().nullable(),
			}),
		)
		.min(1),
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

highlightRoutes.post("/papers/:paperId/highlights/batch", requireAuth, async (c) => {
	const paperId = c.req.param("paperId")
	const user = c.get("user")
	if (!(await userCanAccessPaper(user.id, paperId, db))) {
		return c.json({ error: "forbidden" }, 403)
	}

	const parsed = CreateBatchSchema.safeParse(await c.req.json())
	if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

	const inserted = await createHighlightBatch({
		paperId,
		userId: user.id,
		workspaceId: parsed.data.workspaceId,
		color: parsed.data.color,
		highlights: parsed.data.highlights,
	})
	return c.json(inserted, 201)
})

highlightRoutes.patch("/highlights/:id", requireAuth, async (c) => {
	const id = c.req.param("id")
	const user = c.get("user")
	const parsed = z.object({ color: ColorSchema }).safeParse(await c.req.json())
	if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

	const updated = await updateHighlightColor({
		highlightId: id,
		userId: user.id,
		color: parsed.data.color,
	})
	if (!updated) return c.json({ error: "not found" }, 404)
	return c.json(updated)
})

highlightRoutes.delete("/highlights/:id", requireAuth, async (c) => {
	const id = c.req.param("id")
	const user = c.get("user")
	const ok = await deleteHighlight({ highlightId: id, userId: user.id })
	if (!ok) return c.json({ error: "not found" }, 404)
	return c.body(null, 204)
})

highlightRoutes.delete("/papers/:paperId/highlights/by-range", requireAuth, async (c) => {
	const paperId = c.req.param("paperId")
	const user = c.get("user")
	if (!(await userCanAccessPaper(user.id, paperId, db))) {
		return c.json({ error: "forbidden" }, 403)
	}

	const parsed = DeleteByRangeSchema.safeParse(await c.req.json())
	if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

	const count = await deleteHighlightsInRanges({
		paperId,
		userId: user.id,
		workspaceId: parsed.data.workspaceId,
		ranges: parsed.data.ranges,
	})
	return c.json({ deleted: count })
})
