import type { Note } from "@sapientia/db"
import { Hono } from "hono"
import { z } from "zod"
import { type AuthContext, requireAuth } from "../middleware/auth"
import { requireMembership } from "../middleware/workspace"
import {
	createNote,
	getNote,
	listNotes,
	softDeleteNote,
	updateNote,
	userCanAccessNote,
} from "../services/note"

export const noteRoutes = new Hono<AuthContext>()

const CreateNoteBodySchema = z.object({
	paperId: z.string().uuid().nullable().optional(),
	title: z.string().min(1).max(200).optional(),
	blocknoteJson: z.unknown(),
	anchorPage: z.number().int().min(1).nullable().optional(),
	anchorYRatio: z.number().min(0).max(1).nullable().optional(),
	anchorBlockId: z.string().min(1).max(64).nullable().optional(),
})

const UpdateNoteBodySchema = z.object({
	title: z.string().min(1).max(200).optional(),
	blocknoteJson: z.unknown().optional(),
	anchorPage: z.number().int().min(1).nullable().optional(),
	anchorYRatio: z.number().min(0).max(1).nullable().optional(),
	anchorBlockId: z.string().min(1).max(64).nullable().optional(),
})

// Strip server-only columns (object keys, agent cache, tsvector) before
// returning a note over the wire.
function publicNote(note: Note) {
	return {
		id: note.id,
		workspaceId: note.workspaceId,
		ownerUserId: note.ownerUserId,
		paperId: note.paperId,
		title: note.title,
		currentVersion: note.currentVersion,
		anchorPage: note.anchorPage,
		anchorYRatio: note.anchorYRatio,
		anchorBlockId: note.anchorBlockId,
		createdAt: note.createdAt,
		updatedAt: note.updatedAt,
	}
}

noteRoutes.get(
	"/workspaces/:workspaceId/notes",
	requireAuth,
	requireMembership("reader"),
	async (c) => {
		const workspaceId = c.req.param("workspaceId")
		const paperIdQuery = c.req.query("paperId")
		// `?paperId=null` (literal string) explicitly filters to standalone notes.
		const paperId = paperIdQuery === "null" ? null : (paperIdQuery ?? undefined)
		const list = await listNotes({ workspaceId, paperId })
		return c.json(list.map(publicNote))
	},
)

noteRoutes.post(
	"/workspaces/:workspaceId/notes",
	requireAuth,
	requireMembership("editor"),
	async (c) => {
		const workspaceId = c.req.param("workspaceId")
		const user = c.get("user")
		const body = CreateNoteBodySchema.safeParse(await c.req.json())
		if (!body.success) {
			return c.json({ error: "invalid body", issues: body.error.flatten().fieldErrors }, 400)
		}
		const note = await createNote({
			workspaceId,
			ownerUserId: user.id,
			paperId: body.data.paperId ?? null,
			title: body.data.title,
			blocknoteJson: body.data.blocknoteJson,
			anchorPage: body.data.anchorPage ?? null,
			anchorYRatio: body.data.anchorYRatio ?? null,
			anchorBlockId: body.data.anchorBlockId ?? null,
		})
		return c.json(publicNote(note), 201)
	},
)

noteRoutes.get("/notes/:id", requireAuth, async (c) => {
	const id = c.req.param("id")
	const user = c.get("user")
	if (!(await userCanAccessNote(user.id, id))) {
		return c.json({ error: "forbidden" }, 403)
	}
	const result = await getNote(id)
	if (!result) return c.json({ error: "not found" }, 404)
	return c.json({
		...publicNote(result.note),
		jsonUrl: result.jsonUrl,
		expiresInSeconds: result.expiresInSeconds,
	})
})

noteRoutes.put("/notes/:id", requireAuth, async (c) => {
	const id = c.req.param("id")
	const user = c.get("user")
	if (!(await userCanAccessNote(user.id, id))) {
		return c.json({ error: "forbidden" }, 403)
	}
	const body = UpdateNoteBodySchema.safeParse(await c.req.json())
	if (!body.success) {
		return c.json({ error: "invalid body", issues: body.error.flatten().fieldErrors }, 400)
	}
	const updated = await updateNote({
		noteId: id,
		title: body.data.title,
		blocknoteJson: body.data.blocknoteJson,
		anchorPage: body.data.anchorPage,
		anchorYRatio: body.data.anchorYRatio,
		anchorBlockId: body.data.anchorBlockId,
	})
	return c.json(publicNote(updated))
})

noteRoutes.delete("/notes/:id", requireAuth, async (c) => {
	const id = c.req.param("id")
	const user = c.get("user")
	if (!(await userCanAccessNote(user.id, id))) {
		return c.json({ error: "forbidden" }, 403)
	}
	await softDeleteNote(id)
	return c.body(null, 204)
})
