import { createHash, randomUUID } from "node:crypto"
import type { Database, Paper } from "@sapientia/db"
import { memberships, papers, workspacePapers } from "@sapientia/db"
import { and, eq } from "drizzle-orm"
import { enqueuePaperEnrich } from "../queues/paper-enrich"
import { enqueuePaperParse } from "../queues/paper-parse"
import { buildDisplayFilename } from "./filename"
import { uploadPdfToS3 } from "./s3-client"

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024

export class PaperTooLargeError extends Error {
	constructor() {
		super(`file exceeds ${MAX_FILE_SIZE_BYTES} bytes`)
	}
}

export class InvalidPaperContentError extends Error {
	constructor(reason: string) {
		super(`invalid PDF: ${reason}`)
	}
}

async function linkPaperToWorkspace(
	paperId: string,
	workspaceId: string,
	userId: string,
	db: Database,
) {
	await db
		.insert(workspacePapers)
		.values({
			paperId,
			workspaceId,
			grantedBy: userId,
		})
		.onConflictDoNothing()
}

export async function uploadPaper(args: {
	userId: string
	workspaceId: string
	fileBytes: Uint8Array
	filename: string
	db: Database
}): Promise<Paper> {
	const { userId, workspaceId, fileBytes, filename, db } = args

	if (fileBytes.byteLength > MAX_FILE_SIZE_BYTES) {
		throw new PaperTooLargeError()
	}

	const header = new TextDecoder().decode(fileBytes.slice(0, 5))
	if (header !== "%PDF-") {
		throw new InvalidPaperContentError("file does not start with %PDF-")
	}

	const contentHash = createHash("sha256").update(fileBytes).digest("hex")

	// Dedup against ALL of the owner's rows, not just live ones. The
	// `(owner_user_id, content_hash)` unique constraint covers soft-deleted
	// rows too, so filtering them out here lets a re-upload sneak past the
	// SELECT and crash on INSERT. Re-uploading content the user had
	// previously trashed should restore that paper (clear `deletedAt`) and
	// re-link it to the current workspace — same MinIO object, same blocks,
	// same metadata they'd curated.
	const [existing] = await db
		.select()
		.from(papers)
		.where(and(eq(papers.ownerUserId, userId), eq(papers.contentHash, contentHash)))
		.limit(1)

	if (existing) {
		if (existing.deletedAt) {
			const [restored] = await db
				.update(papers)
				.set({ deletedAt: null, updatedAt: new Date() })
				.where(eq(papers.id, existing.id))
				.returning()
			await linkPaperToWorkspace(restored.id, workspaceId, userId, db)
			return restored
		}
		await linkPaperToWorkspace(existing.id, workspaceId, userId, db)
		return existing
	}

	const paperId = randomUUID()
	const pdfObjectKey = `papers/${userId}/${paperId}/source.pdf`

	await uploadPdfToS3(fileBytes, pdfObjectKey)

	const [paper] = await db
		.insert(papers)
		.values({
			id: paperId,
			ownerUserId: userId,
			contentHash,
			title: filename.replace(/\.pdf$/i, ""),
			displayFilename: buildDisplayFilename({
				paperId,
				title: filename.replace(/\.pdf$/i, ""),
				authors: [],
				year: null,
			}),
			fileSizeBytes: fileBytes.byteLength,
			pdfObjectKey,
			parseStatus: "pending",
			enrichmentStatus: "pending",
		})
		.returning()

	await linkPaperToWorkspace(paper.id, workspaceId, userId, db)

	// Fresh upload only — dedup hits return early above and reuse the existing
	// paper (and thus its parse status / blocks).
	await enqueuePaperParse({ paperId: paper.id, userId })
	await enqueuePaperEnrich({ paperId: paper.id, userId })

	return paper
}

export async function userCanAccessPaper(
	userId: string,
	paperId: string,
	db: Database,
): Promise<boolean> {
	const rows = await db
		.select({ paperId: workspacePapers.paperId })
		.from(workspacePapers)
		.innerJoin(
			memberships,
			and(eq(memberships.workspaceId, workspacePapers.workspaceId), eq(memberships.userId, userId)),
		)
		.where(eq(workspacePapers.paperId, paperId))
		.limit(1)

	return rows.length > 0
}
