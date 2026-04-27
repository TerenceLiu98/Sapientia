import { randomUUID } from "node:crypto"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { memberships, type NewNote, type Note, noteBlockRefs, notes } from "@sapientia/db"
import { blocknoteJsonToMarkdown, extractCitations } from "@sapientia/shared"
import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { config } from "../config"
import { db } from "../db"
import { generatePresignedGetUrl, s3Client } from "./s3-client"

const AGENT_MD_MAX_LEN = 4000

// Rebuild this note's block-ref rows from scratch on every save. Idempotent
// and trivially correct: if the citation set hasn't actually changed, the
// new INSERT writes the exact same rows we just deleted.
async function syncNoteBlockRefs(noteId: string, blocknoteJson: unknown): Promise<void> {
	const refs = extractCitations(blocknoteJson)
	await db.delete(noteBlockRefs).where(eq(noteBlockRefs.noteId, noteId))
	if (refs.length === 0) return
	await db.insert(noteBlockRefs).values(
		refs.map((r) => ({
			noteId,
			paperId: r.paperId,
			blockId: r.blockId,
			citationCount: r.count,
		})),
	)
}

function jsonKey(workspaceId: string, noteId: string, version: number) {
	return `workspaces/${workspaceId}/notes/${noteId}/v${version}.json`
}

function mdKey(workspaceId: string, noteId: string, version: number) {
	return `workspaces/${workspaceId}/notes/${noteId}/v${version}.md`
}

async function uploadVersion(args: {
	workspaceId: string
	noteId: string
	version: number
	blocknoteJson: unknown
}): Promise<{ jsonObjectKey: string; mdObjectKey: string; markdown: string }> {
	const jsonObjectKey = jsonKey(args.workspaceId, args.noteId, args.version)
	const mdObjectKey = mdKey(args.workspaceId, args.noteId, args.version)

	const jsonString = JSON.stringify(args.blocknoteJson)
	const docArray = Array.isArray(args.blocknoteJson) ? args.blocknoteJson : []
	const markdown = blocknoteJsonToMarkdown(docArray)

	await Promise.all([
		s3Client.send(
			new PutObjectCommand({
				Bucket: config.S3_BUCKET,
				Key: jsonObjectKey,
				Body: jsonString,
				ContentType: "application/json",
			}),
		),
		s3Client.send(
			new PutObjectCommand({
				Bucket: config.S3_BUCKET,
				Key: mdObjectKey,
				Body: markdown,
				ContentType: "text/markdown",
			}),
		),
	])

	return { jsonObjectKey, mdObjectKey, markdown }
}

export interface CreateNoteInput {
	workspaceId: string
	ownerUserId: string
	paperId?: string | null
	title?: string
	blocknoteJson: unknown
}

export async function createNote(input: CreateNoteInput): Promise<Note> {
	const noteId = randomUUID()
	const { jsonObjectKey, mdObjectKey, markdown } = await uploadVersion({
		workspaceId: input.workspaceId,
		noteId,
		version: 1,
		blocknoteJson: input.blocknoteJson,
	})

	const [note] = await db
		.insert(notes)
		.values({
			id: noteId,
			workspaceId: input.workspaceId,
			ownerUserId: input.ownerUserId,
			paperId: input.paperId ?? null,
			title: input.title ?? "Untitled",
			currentVersion: 1,
			jsonObjectKey,
			mdObjectKey,
			agentMarkdownCache: markdown.slice(0, AGENT_MD_MAX_LEN),
			searchText: sql`to_tsvector('english', ${markdown})` as unknown as string,
		})
		.returning()

	await syncNoteBlockRefs(note.id, input.blocknoteJson)
	return note
}

export interface UpdateNoteInput {
	noteId: string
	title?: string
	blocknoteJson?: unknown
}

export async function updateNote(input: UpdateNoteInput): Promise<Note> {
	const [existing] = await db
		.select()
		.from(notes)
		.where(and(eq(notes.id, input.noteId), isNull(notes.deletedAt)))
		.limit(1)
	if (!existing) throw new Error(`note ${input.noteId} not found`)

	const updates: Partial<NewNote> = { updatedAt: new Date() }
	if (input.title !== undefined) updates.title = input.title

	if (input.blocknoteJson !== undefined) {
		const newVersion = existing.currentVersion + 1
		const { jsonObjectKey, mdObjectKey, markdown } = await uploadVersion({
			workspaceId: existing.workspaceId,
			noteId: existing.id,
			version: newVersion,
			blocknoteJson: input.blocknoteJson,
		})
		updates.currentVersion = newVersion
		updates.jsonObjectKey = jsonObjectKey
		updates.mdObjectKey = mdObjectKey
		updates.agentMarkdownCache = markdown.slice(0, AGENT_MD_MAX_LEN)
		updates.searchText = sql`to_tsvector('english', ${markdown})` as unknown as string
	}

	const [updated] = await db
		.update(notes)
		.set(updates)
		.where(eq(notes.id, input.noteId))
		.returning()

	// Rebuild citation refs only when the document body actually changed —
	// title-only edits don't touch citations.
	if (input.blocknoteJson !== undefined) {
		await syncNoteBlockRefs(updated.id, input.blocknoteJson)
	}
	return updated
}

export async function getNote(
	noteId: string,
): Promise<{ note: Note; jsonUrl: string; expiresInSeconds: number } | null> {
	const [note] = await db
		.select()
		.from(notes)
		.where(and(eq(notes.id, noteId), isNull(notes.deletedAt)))
		.limit(1)
	if (!note) return null
	const expiresInSeconds = 30 * 60
	const jsonUrl = await generatePresignedGetUrl(note.jsonObjectKey, expiresInSeconds)
	return { note, jsonUrl, expiresInSeconds }
}

export async function listNotes(args: {
	workspaceId: string
	paperId?: string | null
}): Promise<Note[]> {
	const conditions = [eq(notes.workspaceId, args.workspaceId), isNull(notes.deletedAt)]
	if (args.paperId !== undefined) {
		conditions.push(args.paperId === null ? isNull(notes.paperId) : eq(notes.paperId, args.paperId))
	}
	return db
		.select()
		.from(notes)
		.where(and(...conditions))
		.orderBy(desc(notes.updatedAt))
}

export async function softDeleteNote(noteId: string): Promise<void> {
	await db
		.update(notes)
		.set({ deletedAt: new Date(), updatedAt: new Date() })
		.where(eq(notes.id, noteId))
}

// A user can read/edit a note iff they are a member of the note's workspace.
// We deliberately don't filter out soft-deleted notes here so the route
// layer can return a clean 404 (via getNote) instead of 403 — the access
// decision is purely "are you allowed near this row at all", not "does it
// still exist".
//
// v0.2 may reduce delete to owner-only.
export async function userCanAccessNote(userId: string, noteId: string): Promise<boolean> {
	const rows = await db
		.select({ noteId: notes.id })
		.from(notes)
		.innerJoin(
			memberships,
			and(eq(memberships.workspaceId, notes.workspaceId), eq(memberships.userId, userId)),
		)
		.where(eq(notes.id, noteId))
		.limit(1)
	return rows.length > 0
}
