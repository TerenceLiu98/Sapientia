import { blocks, memberships, noteBlockRefs, notes, papers, workspacePapers } from "@sapientia/db"
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import { db } from "../db"
import { type AuthContext, requireAuth } from "../middleware/auth"
import { requireMembership } from "../middleware/workspace"
import { paperToBibtex, papersToBibtex } from "../services/bibtex"
import { buildDisplayFilename } from "../services/filename"
import { enrichPaperFromIdentifiers } from "../services/paper-enrichment"
import { applyEnrichedMetadataToPaper, mergeMetadataEditedFlags } from "../services/paper-metadata"
import {
	InvalidPaperContentError,
	PaperTooLargeError,
	uploadPaper,
	userCanAccessPaper,
} from "../services/paper"
import { generatePresignedGetUrl } from "../services/s3-client"

export const paperRoutes = new Hono<AuthContext>()

const PatchPaperSchema = z.object({
	title: z.string().trim().max(500).nullable().optional(),
	authors: z.array(z.string().trim().min(1).max(200)).max(50).nullable().optional(),
	year: z.number().int().min(1900).max(2100).nullable().optional(),
	doi: z.string().trim().max(200).nullable().optional(),
	arxivId: z.string().trim().max(50).nullable().optional(),
	venue: z.string().trim().max(200).nullable().optional(),
})

const RefetchMetadataSchema = z.object({
	title: z.string().trim().max(500).nullable().optional(),
	doi: z.string().trim().max(200).nullable().optional(),
	arxivId: z.string().trim().max(50).nullable().optional(),
})

paperRoutes.post(
	"/workspaces/:workspaceId/papers",
	requireAuth,
	requireMembership("editor"),
	async (c) => {
		const workspaceId = c.req.param("workspaceId")
		const user = c.get("user")

		const formData = await c.req.formData()
		const file = formData.get("file")
		if (!(file instanceof File)) {
			return c.json({ error: "file field required" }, 400)
		}

		if (file.type !== "application/pdf") {
			return c.json({ error: "only application/pdf accepted" }, 415)
		}

		const fileBytes = new Uint8Array(await file.arrayBuffer())

		try {
			const paper = await uploadPaper({
				userId: user.id,
				workspaceId,
				fileBytes,
				filename: file.name || "untitled.pdf",
				db,
			})

			return c.json(paper, 200)
		} catch (error) {
			if (error instanceof PaperTooLargeError) {
				return c.json({ error: "file exceeds 50MB limit" }, 413)
			}

			if (error instanceof InvalidPaperContentError) {
				return c.json({ error: error.message }, 400)
			}

			throw error
		}
	},
)

paperRoutes.get(
	"/workspaces/:workspaceId/papers",
	requireAuth,
	requireMembership("reader"),
	async (c) => {
		const workspaceId = c.req.param("workspaceId")

		const rows = await db
			.select({ paper: papers })
			.from(papers)
			.innerJoin(workspacePapers, eq(workspacePapers.paperId, papers.id))
			.where(and(eq(workspacePapers.workspaceId, workspaceId), isNull(papers.deletedAt)))
			.orderBy(desc(papers.createdAt))

		return c.json(rows.map((row) => row.paper))
	},
)

paperRoutes.get("/papers/:id", requireAuth, async (c) => {
	const id = c.req.param("id")
	const user = c.get("user")

	const [paper] = await db.select().from(papers).where(eq(papers.id, id)).limit(1)
	if (!paper || paper.deletedAt) {
		return c.json({ error: "not found" }, 404)
	}

	if (!(await userCanAccessPaper(user.id, paper.id, db))) {
		return c.json({ error: "forbidden" }, 403)
	}

	return c.json(paper)
})

paperRoutes.get("/papers/:id/pdf-url", requireAuth, async (c) => {
	const id = c.req.param("id")
	const user = c.get("user")

	const [paper] = await db.select().from(papers).where(eq(papers.id, id)).limit(1)
	if (!paper || paper.deletedAt) {
		return c.json({ error: "not found" }, 404)
	}

	if (!(await userCanAccessPaper(user.id, paper.id, db))) {
		return c.json({ error: "forbidden" }, 403)
	}

	const url = await generatePresignedGetUrl(paper.pdfObjectKey, 3600)
	return c.json({
		url,
		expiresInSeconds: 3600,
		downloadFilename: paper.displayFilename || `${paper.title}.pdf`,
	})
})

paperRoutes.patch("/papers/:id", requireAuth, async (c) => {
	const id = c.req.param("id")
	const user = c.get("user")
	const body = PatchPaperSchema.parse(await c.req.json())

	const [paper] = await db.select().from(papers).where(eq(papers.id, id)).limit(1)
	if (!paper || paper.deletedAt) return c.json({ error: "not found" }, 404)
	if (!(await userCanAccessPaper(user.id, paper.id, db))) {
		return c.json({ error: "forbidden" }, 403)
	}

	const editedFields = mergeMetadataEditedFlags(paper.metadataEditedByUser, body)

	const nextTitle = body.title !== undefined ? (body.title ?? "") : paper.title
	const nextAuthors = body.authors !== undefined ? (body.authors ?? []) : (paper.authors ?? [])
	const nextYear = body.year !== undefined ? body.year : paper.year
	const displayFilename = buildDisplayFilename({
		paperId: paper.id,
		title: nextTitle,
		authors: nextAuthors,
		year: nextYear,
	})

	const [updated] = await db
		.update(papers)
		.set({
			...body,
			title: nextTitle,
			authors: nextAuthors,
			displayFilename,
			metadataEditedByUser: editedFields,
			updatedAt: new Date(),
		})
		.where(eq(papers.id, id))
		.returning()

	return c.json(updated)
})

paperRoutes.post("/papers/:id/fetch-metadata", requireAuth, async (c) => {
	const id = c.req.param("id")
	const user = c.get("user")
	const body = RefetchMetadataSchema.parse(await c.req.json())

	const [paper] = await db.select().from(papers).where(eq(papers.id, id)).limit(1)
	if (!paper || paper.deletedAt) return c.json({ error: "not found" }, 404)
	if (!(await userCanAccessPaper(user.id, paper.id, db))) {
		return c.json({ error: "forbidden" }, 403)
	}

	await db
		.update(papers)
		.set({
			enrichmentStatus: "enriching",
			enrichmentSource: null,
			enrichedAt: null,
			updatedAt: new Date(),
		})
		.where(eq(papers.id, id))

	const result = await enrichPaperFromIdentifiers({
		paper,
		overrideTitle: body.title,
		overrideDoi: body.doi,
		overrideArxivId: body.arxivId,
	})

	const [updated] = await db
		.update(papers)
		.set(applyEnrichedMetadataToPaper(paper, result))
		.where(eq(papers.id, id))
		.returning()

	return c.json(updated)
})

paperRoutes.get("/papers/:id/blocks", requireAuth, async (c) => {
	const id = c.req.param("id")
	const user = c.get("user")
	const imageTtl = 60 * 5

	const [paper] = await db.select().from(papers).where(eq(papers.id, id)).limit(1)
	if (!paper || paper.deletedAt) return c.json({ error: "not found" }, 404)
	if (!(await userCanAccessPaper(user.id, paper.id, db))) {
		return c.json({ error: "forbidden" }, 403)
	}

	const rows = await db
		.select()
		.from(blocks)
		.where(eq(blocks.paperId, id))
		.orderBy(asc(blocks.blockIndex))

	// Blocks rarely change after parse, but figure/table image URLs are
	// presigned and expire independently of `paper.updatedAt`. When any row
	// carries an image, fold a TTL-sized time bucket into the ETag so the
	// browser refreshes the JSON and gets fresh presigned URLs before MinIO
	// starts returning 403 on stale signatures.
	const hasPresignedImages = rows.some((row) => Boolean(row.imageObjectKey))
	const freshnessBucket = hasPresignedImages
		? Math.floor(Date.now() / (imageTtl * 1000))
		: "static"
	const etag = `"${paper.updatedAt.getTime()}:${freshnessBucket}"`
	if (c.req.header("if-none-match") === etag) {
		return new Response(null, { status: 304 })
	}

	// Inline a presigned image URL on figure/table rows so the frontend can
	// render thumbnails directly. Presigning is local HMAC, so doing this
	// per-row is cheap. TTL matches the Cache-Control on this response so the
	// browser doesn't try to render an already-expired URL.
	const enriched = await Promise.all(
		rows.map(async (row) => {
			if (!row.imageObjectKey) return { ...row, imageUrl: null }
			const imageUrl = await generatePresignedGetUrl(row.imageObjectKey, imageTtl)
			return { ...row, imageUrl }
		}),
	)

	c.header("etag", etag)
	c.header("cache-control", "private, max-age=60")
	return c.json(enriched)
})

// Aggregate citation counts across all notes the caller can see, grouped
// by block. Used for the "(N notes)" badges in the BlocksPanel.
paperRoutes.get("/papers/:id/citation-counts", requireAuth, async (c) => {
	const paperId = c.req.param("id")
	const user = c.get("user")
	if (!(await userCanAccessPaper(user.id, paperId, db))) {
		return c.json({ error: "forbidden" }, 403)
	}

	const rows = await db
		.select({
			blockId: noteBlockRefs.blockId,
			count: sql<number>`sum(${noteBlockRefs.citationCount})::int`,
		})
		.from(noteBlockRefs)
		.innerJoin(notes, eq(notes.id, noteBlockRefs.noteId))
		.innerJoin(
			memberships,
			and(eq(memberships.workspaceId, notes.workspaceId), eq(memberships.userId, user.id)),
		)
		.where(and(eq(noteBlockRefs.paperId, paperId), isNull(notes.deletedAt)))
		.groupBy(noteBlockRefs.blockId)

	return c.json(rows)
})

paperRoutes.get("/papers/:id/bibtex", requireAuth, async (c) => {
	const id = c.req.param("id")
	const user = c.get("user")

	const [paper] = await db.select().from(papers).where(eq(papers.id, id)).limit(1)
	if (!paper || paper.deletedAt) return c.json({ error: "not found" }, 404)
	if (!(await userCanAccessPaper(user.id, paper.id, db))) {
		return c.json({ error: "forbidden" }, 403)
	}

	c.header("content-type", "application/x-bibtex; charset=utf-8")
	c.header(
		"content-disposition",
		`attachment; filename="${(paper.displayFilename || `${paper.title}.pdf`).replace(/\.pdf$/i, ".bib")}"`,
	)
	return c.body(paperToBibtex(paper))
})

paperRoutes.get(
	"/workspaces/:workspaceId/papers/bibtex",
	requireAuth,
	requireMembership("reader"),
	async (c) => {
		const workspaceId = c.req.param("workspaceId")
		const rows = await db
			.select({ paper: papers })
			.from(papers)
			.innerJoin(workspacePapers, eq(workspacePapers.paperId, papers.id))
			.where(and(eq(workspacePapers.workspaceId, workspaceId), isNull(papers.deletedAt)))
			.orderBy(desc(papers.createdAt))

		c.header("content-type", "application/x-bibtex; charset=utf-8")
		c.header(
			"content-disposition",
			`attachment; filename="sapientia-${workspaceId.slice(0, 8)}.bib"`,
		)
		return c.body(papersToBibtex(rows.map((row) => row.paper)))
	},
)

// Notes citing a specific block, scoped to notes the caller can read.
paperRoutes.get("/papers/:id/blocks/:blockId/notes", requireAuth, async (c) => {
	const paperId = c.req.param("id")
	const blockId = c.req.param("blockId")
	const user = c.get("user")
	if (!(await userCanAccessPaper(user.id, paperId, db))) {
		return c.json({ error: "forbidden" }, 403)
	}

	const rows = await db
		.select({
			noteId: notes.id,
			title: notes.title,
			workspaceId: notes.workspaceId,
			citationCount: noteBlockRefs.citationCount,
			updatedAt: notes.updatedAt,
		})
		.from(noteBlockRefs)
		.innerJoin(notes, eq(notes.id, noteBlockRefs.noteId))
		.innerJoin(
			memberships,
			and(eq(memberships.workspaceId, notes.workspaceId), eq(memberships.userId, user.id)),
		)
		.where(
			and(
				eq(noteBlockRefs.paperId, paperId),
				eq(noteBlockRefs.blockId, blockId),
				isNull(notes.deletedAt),
			),
		)
		.orderBy(desc(notes.updatedAt))

	return c.json(rows)
})

// Soft delete: only the owner may delete; sets deleted_at so the row is
// excluded from listings + detail lookups but the MinIO objects are
// preserved for now (a future cleanup job can purge them once we're sure
// no notes still reference the paper).
paperRoutes.delete("/papers/:id", requireAuth, async (c) => {
	const id = c.req.param("id")
	const user = c.get("user")

	const [paper] = await db.select().from(papers).where(eq(papers.id, id)).limit(1)
	if (!paper || paper.deletedAt) {
		return c.json({ error: "not found" }, 404)
	}
	if (paper.ownerUserId !== user.id) {
		return c.json({ error: "only the owner can delete this paper" }, 403)
	}

	await db
		.update(papers)
		.set({ deletedAt: new Date(), updatedAt: new Date() })
		.where(eq(papers.id, id))

	return c.json({ ok: true })
})
