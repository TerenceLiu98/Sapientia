import type { Note } from "@sapientia/db"
import { Hono } from "hono"
import { z } from "zod"
import { type AuthContext, requireAuth } from "../middleware/auth"
import { requireMembership } from "../middleware/workspace"
import { enqueuePaperConceptRefine } from "../queues/paper-concept-refine"
import { cleanupNoteBornConceptsForNote } from "../services/note-concept-extract"
import {
	createNote,
	getNoteRow,
	getNote,
	listNotes,
	softDeleteNote,
	updateNote,
	userCanAccessNote,
} from "../services/note"

export const noteRoutes = new Hono<AuthContext>()

const AnchorKindSchema = z.enum(["page", "block", "highlight", "underline"])

const CreateNoteBodySchema = z.object({
	paperId: z.string().uuid().nullable().optional(),
	title: z.string().min(1).max(200).optional(),
	blocknoteJson: z.unknown(),
	anchorPage: z.number().int().min(1).nullable().optional(),
	anchorYRatio: z.number().min(0).max(1).nullable().optional(),
	anchorKind: AnchorKindSchema.nullable().optional(),
	anchorBlockId: z.string().min(1).max(64).nullable().optional(),
	anchorAnnotationId: z.string().uuid().nullable().optional(),
})

const UpdateNoteBodySchema = z.object({
	title: z.string().min(1).max(200).optional(),
	blocknoteJson: z.unknown().optional(),
	anchorPage: z.number().int().min(1).nullable().optional(),
	anchorYRatio: z.number().min(0).max(1).nullable().optional(),
	anchorKind: AnchorKindSchema.nullable().optional(),
	anchorBlockId: z.string().min(1).max(64).nullable().optional(),
	anchorAnnotationId: z.string().uuid().nullable().optional(),
})

// Strip server-only columns (object keys, agent cache, tsvector) before
// returning a note over the wire. The lossy `agent_markdown_cache` is
// surfaced as a short `excerpt` so the marginalia rail can show the
// note's first sentence in the folded slip without a per-row MinIO
// round-trip.
const NOTE_EXCERPT_MAX_CHARS = 220

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
		anchorKind: note.anchorKind,
		anchorBlockId: note.anchorBlockId,
		anchorAnnotationId: note.anchorAnnotationId,
		excerpt: deriveNoteExcerpt(note.agentMarkdownCache),
		createdAt: note.createdAt,
		updatedAt: note.updatedAt,
	}
}

// Derive the slip excerpt from the agent markdown cache: drop citation
// tokens (`[[block N · paperId#blockId]]` and the underline/highlight
// variants), drop heading markers + bullet syntax, collapse whitespace,
// truncate to one short paragraph. Leaves room for the surrounding UI
// chrome on the folded slip without spilling into a wall of text.
function deriveNoteExcerpt(markdownCache: string | null | undefined): string {
	if (!markdownCache) return ""
	const stripped = markdownCache
		.replace(/\[\[[^\]]+\]\]/g, "") // citation tokens
		.replace(/^\s*#{1,6}\s+/gm, "") // heading markers
		.replace(/^\s*[-*+]\s+/gm, "") // bullet markers
		.replace(/^\s*\d+\.\s+/gm, "") // ordered-list markers
		.replace(/`([^`]+)`/g, "$1") // inline code → plain
		.replace(/\*\*([^*]+)\*\*/g, "$1") // bold
		.replace(/\*([^*]+)\*/g, "$1") // italic
		.replace(/\s+/g, " ")
		.trim()
	if (stripped.length <= NOTE_EXCERPT_MAX_CHARS) return stripped
	return `${stripped.slice(0, NOTE_EXCERPT_MAX_CHARS - 1).trimEnd()}…`
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
			anchorKind: body.data.anchorKind ?? null,
			anchorBlockId: body.data.anchorBlockId ?? null,
			anchorAnnotationId: body.data.anchorAnnotationId ?? null,
		})
		if (note.paperId) {
			await enqueuePaperConceptRefine({
				paperId: note.paperId,
				userId: user.id,
				workspaceId,
			})
		}
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
		anchorKind: body.data.anchorKind,
		anchorBlockId: body.data.anchorBlockId,
		anchorAnnotationId: body.data.anchorAnnotationId,
	})
	if (updated.paperId) {
		await enqueuePaperConceptRefine({
			paperId: updated.paperId,
			userId: user.id,
			workspaceId: updated.workspaceId,
		})
	}
	return c.json(publicNote(updated))
})

noteRoutes.delete("/notes/:id", requireAuth, async (c) => {
	const id = c.req.param("id")
	const user = c.get("user")
	if (!(await userCanAccessNote(user.id, id))) {
		return c.json({ error: "forbidden" }, 403)
	}
	const existing = await getNoteRow(id)
	await softDeleteNote(id)
	await cleanupNoteBornConceptsForNote({ noteId: id })
	if (existing?.paperId) {
		await enqueuePaperConceptRefine({
			paperId: existing.paperId,
			userId: user.id,
			workspaceId: existing.workspaceId,
		})
	}
	return c.body(null, 204)
})
