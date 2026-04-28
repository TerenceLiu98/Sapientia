import { Hono } from "hono"
import { z } from "zod"
import { db } from "../db"
import { type AuthContext, requireAuth } from "../middleware/auth"
import { userCanAccessPaper } from "../services/paper"
import {
	createReaderAnnotation,
	deleteReaderAnnotation,
	listReaderAnnotationsForPaper,
} from "../services/reader-annotation"

export const readerAnnotationRoutes = new Hono<AuthContext>()

const UnitValueSchema = z.number().finite().min(0).max(1)
const PageSchema = z.number().int().min(1)
const ColorSchema = z.string().trim().min(1).max(32)
const PointSchema = z.object({
	x: UnitValueSchema,
	y: UnitValueSchema,
})
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

const CreateReaderAnnotationSchema = z.discriminatedUnion("kind", [
	z.object({
		workspaceId: z.string().uuid(),
		page: PageSchema,
		kind: z.literal("highlight"),
		color: ColorSchema,
		body: z.object({ rect: RectSchema }),
	}),
	z.object({
		workspaceId: z.string().uuid(),
		page: PageSchema,
		kind: z.literal("underline"),
		color: ColorSchema,
		body: z.object({ from: PointSchema, to: PointSchema }),
	}),
	z.object({
		workspaceId: z.string().uuid(),
		page: PageSchema,
		kind: z.literal("ink"),
		color: ColorSchema,
		body: z.object({ points: z.array(PointSchema).min(2) }),
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

readerAnnotationRoutes.delete("/reader-annotations/:id", requireAuth, async (c) => {
	const user = c.get("user")
	const removed = await deleteReaderAnnotation({
		annotationId: c.req.param("id"),
		userId: user.id,
	})
	if (!removed) return c.json({ error: "not found" }, 404)
	return c.body(null, 204)
})
