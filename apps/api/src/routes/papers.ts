import { createDbClient, papers, workspacePapers } from "@sapientia/db"
import { and, desc, eq, isNull } from "drizzle-orm"
import { Hono } from "hono"
import { config } from "../config"
import { type AuthContext, requireAuth } from "../middleware/auth"
import { requireMembership } from "../middleware/workspace"
import {
	InvalidPaperContentError,
	PaperTooLargeError,
	uploadPaper,
	userCanAccessPaper,
} from "../services/paper"
import { generatePresignedGetUrl } from "../services/s3-client"

const { db } = createDbClient(config.DATABASE_URL)

export const paperRoutes = new Hono<AuthContext>()

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
			.select({
				id: papers.id,
				ownerUserId: papers.ownerUserId,
				contentHash: papers.contentHash,
				doi: papers.doi,
				arxivId: papers.arxivId,
				title: papers.title,
				authors: papers.authors,
				fileSizeBytes: papers.fileSizeBytes,
				pdfObjectKey: papers.pdfObjectKey,
				blocksObjectKey: papers.blocksObjectKey,
				parseStatus: papers.parseStatus,
				parseError: papers.parseError,
				createdAt: papers.createdAt,
				updatedAt: papers.updatedAt,
				deletedAt: papers.deletedAt,
			})
			.from(papers)
			.innerJoin(workspacePapers, eq(workspacePapers.paperId, papers.id))
			.where(and(eq(workspacePapers.workspaceId, workspaceId), isNull(papers.deletedAt)))
			.orderBy(desc(papers.createdAt))

		return c.json(rows)
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
	return c.json({ url, expiresInSeconds: 3600 })
})
