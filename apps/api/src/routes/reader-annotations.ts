import { Hono } from "hono"
import { z } from "zod"
import { db } from "../db"
import { type AuthContext, requireAuth } from "../middleware/auth"
import { userCanAccessPaper } from "../services/paper"
import {
	createReaderAnnotation,
	deleteReaderAnnotation,
	listReaderAnnotationsForPaper,
	restoreReaderAnnotation,
	updateReaderAnnotationColor,
} from "../services/reader-annotation"

export const readerAnnotationRoutes = new Hono<AuthContext>()

const UnitValueSchema = z.number().finite().min(0).max(1)
const PageSchema = z.number().int().min(1)
const ColorSchema = z.string().trim().min(1).max(32)
const RectSchema = z
	.object({
		x: UnitValueSchema,
		y: UnitValueSchema,
		w: UnitValueSchema,
		h: UnitValueSchema,
	})
	.superRefine((value, ctx) => {
		if (value.w <= 0 || value.h <= 0) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "rect must have positive width and height",
			})
		}
		if (value.x + value.w > 1 || value.y + value.h > 1) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "rect must stay within the page",
			})
		}
	})
const TextMarkupBodySchema = z.object({
	rects: z.array(RectSchema).min(1),
	quote: z.string().trim().min(1),
})

const CreateReaderAnnotationSchema = z.discriminatedUnion("kind", [
	z.object({
		workspaceId: z.string().uuid(),
		page: PageSchema,
		kind: z.literal("highlight"),
		color: ColorSchema,
		body: TextMarkupBodySchema,
	}),
	z.object({
		workspaceId: z.string().uuid(),
		page: PageSchema,
		kind: z.literal("underline"),
		color: ColorSchema,
		body: TextMarkupBodySchema,
	}),
])

readerAnnotationRoutes.get("/papers/:paperId/reader-annotations", requireAuth, async (c) => {
	const paperId = c.req.param("paperId")
	const workspaceId = c.req.query("workspaceId")
	if (!workspaceId) return c.json({ error: "workspaceId required" }, 400)

	const user = c.get("user")
	if (!(await userCanAccessPaper(user.id, paperId, db))) {
		return c.json({ error: "forbidden" }, 403)
	}

	const rows = await listReaderAnnotationsForPaper({ paperId, userId: user.id, workspaceId })
	return c.json(rows)
})

readerAnnotationRoutes.post("/papers/:paperId/reader-annotations", requireAuth, async (c) => {
	const paperId = c.req.param("paperId")
	const user = c.get("user")
	if (!(await userCanAccessPaper(user.id, paperId, db))) {
		return c.json({ error: "forbidden" }, 403)
	}

	const parsed = CreateReaderAnnotationSchema.safeParse(await c.req.json())
	if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

	const row = await createReaderAnnotation({
		paperId,
		workspaceId: parsed.data.workspaceId,
		userId: user.id,
		page: parsed.data.page,
		kind: parsed.data.kind,
		color: parsed.data.color,
		body: parsed.data.body,
	})
	return c.json(row, 201)
})

const PatchReaderAnnotationSchema = z.object({
	color: ColorSchema,
})

readerAnnotationRoutes.patch("/reader-annotations/:id", requireAuth, async (c) => {
	const user = c.get("user")
	const parsed = PatchReaderAnnotationSchema.safeParse(await c.req.json())
	if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

	const updated = await updateReaderAnnotationColor({
		annotationId: c.req.param("id"),
		userId: user.id,
		color: parsed.data.color,
	})
	if (!updated) return c.json({ error: "not found" }, 404)
	return c.json(updated)
})

readerAnnotationRoutes.delete("/reader-annotations/:id", requireAuth, async (c) => {
	const user = c.get("user")
	const result = await deleteReaderAnnotation({
		annotationId: c.req.param("id"),
		userId: user.id,
	})
	if (!result.removed) return c.json({ error: "not found" }, 404)
	// Tell the client whether the row stuck around as a ghost so it can
	// keep rendering a faint outline (and not strip it from the cache).
	if (result.softDeleted) return c.json({ softDeleted: true }, 200)
	return c.body(null, 204)
})

readerAnnotationRoutes.post("/reader-annotations/:id/restore", requireAuth, async (c) => {
	const user = c.get("user")
	const restored = await restoreReaderAnnotation({
		annotationId: c.req.param("id"),
		userId: user.id,
	})
	if (!restored) return c.json({ error: "not found" }, 404)
	return c.json(restored)
})
