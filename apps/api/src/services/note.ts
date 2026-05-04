import { randomUUID } from "node:crypto"
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { memberships, type NewNote, type Note, noteAnnotationRefs, noteBlockRefs, notes } from "@sapientia/db"
import { blocknoteJsonToMarkdown, extractAnnotationCitations, extractCitations } from "@sapientia/shared"
import { and, asc, eq, isNull, sql } from "drizzle-orm"
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

async function syncNoteAnnotationRefs(noteId: string, blocknoteJson: unknown): Promise<void> {
	const refs = extractAnnotationCitations(blocknoteJson)
	await db.delete(noteAnnotationRefs).where(eq(noteAnnotationRefs.noteId, noteId))
	if (refs.length === 0) return
	await db.insert(noteAnnotationRefs).values(
		refs.map((r) => ({
			noteId,
			paperId: r.paperId,
			annotationId: r.annotationId,
			annotationKind: r.annotationKind,
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
	const markdown = blocknoteJsonToMarkdown(args.blocknoteJson)

	// Pre-compute byte lengths so the SDK doesn't have to guess — strings
	// otherwise trip the "stream of unknown length" warning.
	const jsonBytes = Buffer.byteLength(jsonString, "utf8")
	const mdBytes = Buffer.byteLength(markdown, "utf8")

	await Promise.all([
		s3Client.send(
			new PutObjectCommand({
				Bucket: config.S3_BUCKET,
				Key: jsonObjectKey,
				Body: jsonString,
				ContentType: "application/json",
				ContentLength: jsonBytes,
			}),
		),
		s3Client.send(
			new PutObjectCommand({
				Bucket: config.S3_BUCKET,
				Key: mdObjectKey,
				Body: markdown,
				ContentType: "text/markdown",
				ContentLength: mdBytes,
			}),
		),
	])

	return { jsonObjectKey, mdObjectKey, markdown }
}

async function readJsonObject(key: string) {
	const response = await s3Client.send(
		new GetObjectCommand({
			Bucket: config.S3_BUCKET,
			Key: key,
		}),
	)
	const body = await response.Body?.transformToString()
	if (!body) return null
	return JSON.parse(body) as unknown
}

export type NoteAnchorKind = "page" | "block" | "highlight" | "underline"

export interface CreateNoteInput {
	workspaceId: string
	ownerUserId: string
	paperId?: string | null
	title?: string
	blocknoteJson: unknown
	// Spatial anchor for the marginalia model. Optional; notes without an
	// anchor land in the "Unanchored" group. `anchorKind` declares which of
	// the id fields is the user's primary intent — block / highlight /
	// underline / page. Both `anchorBlockId` and `anchorAnnotationId` may
	// co-exist (a highlight-anchored note still remembers the block it
	// landed inside, so the marginalia tag strip can show "block 7" as a
	// secondary structural anchor).
	anchorPage?: number | null
	anchorYRatio?: number | null
	anchorKind?: NoteAnchorKind | null
	anchorBlockId?: string | null
	anchorAnnotationId?: string | null
}

export async function createNote(input: CreateNoteInput): Promise<Note> {
	// Marginalia is plural by design (TASK-018) — many notes per paper, each
	// at a different anchor. We no longer dedupe by (paper, owner).
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
			anchorPage: input.anchorPage ?? null,
			anchorYRatio: input.anchorYRatio ?? null,
			anchorKind: input.anchorKind ?? null,
			anchorBlockId: input.anchorBlockId ?? null,
			anchorAnnotationId: input.anchorAnnotationId ?? null,
		})
		.returning()

	await syncNoteBlockRefs(note.id, input.blocknoteJson)
	await syncNoteAnnotationRefs(note.id, input.blocknoteJson)
	return note
}

export interface UpdateNoteInput {
	noteId: string
	title?: string
	blocknoteJson?: unknown
	// Anchor edits — null means "unset", undefined means "leave alone".
	anchorPage?: number | null
	anchorYRatio?: number | null
	anchorKind?: NoteAnchorKind | null
	anchorBlockId?: string | null
	anchorAnnotationId?: string | null
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
	if (input.anchorPage !== undefined) updates.anchorPage = input.anchorPage
	if (input.anchorYRatio !== undefined) updates.anchorYRatio = input.anchorYRatio
	if (input.anchorKind !== undefined) updates.anchorKind = input.anchorKind
	if (input.anchorBlockId !== undefined) updates.anchorBlockId = input.anchorBlockId
	if (input.anchorAnnotationId !== undefined)
		updates.anchorAnnotationId = input.anchorAnnotationId

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
		await syncNoteAnnotationRefs(updated.id, input.blocknoteJson)
	}
	return updated
}

export async function appendAgentQuestionsToNote(args: {
	noteId: string
	expectedVersion: number
	questions: Array<{ conceptName: string; question: string }>
}): Promise<Note | null> {
	const [existing] = await db
		.select()
		.from(notes)
		.where(and(eq(notes.id, args.noteId), isNull(notes.deletedAt)))
		.limit(1)
	if (!existing || existing.currentVersion !== args.expectedVersion) return null

	const existingQuestionNames = new Set(
		[...existing.agentMarkdownCache.matchAll(/Agent question ·\s*([^:\n]+):/g)].map((match) =>
			normalizeQuestionConceptName(match[1] ?? ""),
		),
	)
	const freshQuestions = args.questions.filter(
		(question) => !existingQuestionNames.has(normalizeQuestionConceptName(question.conceptName)),
	)
	if (freshQuestions.length === 0) return existing

	const currentDoc = await readJsonObject(existing.jsonObjectKey)
	const nextDoc = appendQuestionTaskItems(currentDoc, freshQuestions)
	const newVersion = existing.currentVersion + 1
	const { jsonObjectKey, mdObjectKey, markdown } = await uploadVersion({
		workspaceId: existing.workspaceId,
		noteId: existing.id,
		version: newVersion,
		blocknoteJson: nextDoc,
	})

	const [updated] = await db
		.update(notes)
		.set({
			currentVersion: newVersion,
			jsonObjectKey,
			mdObjectKey,
			agentMarkdownCache: markdown.slice(0, AGENT_MD_MAX_LEN),
			searchText: sql`to_tsvector('english', ${markdown})` as unknown as string,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(notes.id, existing.id),
				eq(notes.currentVersion, args.expectedVersion),
				isNull(notes.deletedAt),
			),
		)
		.returning()

	if (!updated) return null
	await syncNoteBlockRefs(updated.id, nextDoc)
	await syncNoteAnnotationRefs(updated.id, nextDoc)
	return updated
}

function appendQuestionTaskItems(doc: unknown, questions: Array<{ conceptName: string; question: string }>) {
	const base: { type: string; content: unknown[] } =
		isRecord(doc) && doc.type === "doc" && Array.isArray(doc.content)
			? { ...(doc as Record<string, unknown>), type: "doc", content: [...doc.content] }
			: { type: "doc", content: [{ type: "paragraph" }] }

	base.content.push({
		type: "taskList",
		content: questions.map((item) => ({
			type: "taskItem",
			attrs: { checked: false },
			content: [
				{
					type: "paragraph",
					content: [
						{
							type: "text",
							text: `Agent question · ${item.conceptName}: ${item.question}`,
						},
					],
				},
			],
		})),
	})
	return base
}

function normalizeQuestionConceptName(value: string) {
	return value.trim().toLowerCase().replace(/\s+/g, " ")
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value)
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
	// Paper-side ordering follows reading flow: page ascending, then within
	// a page by y-ratio, then by createdAt as a stable tiebreak. Unanchored
	// notes (anchorPage NULL) sort first via NULLS FIRST so they show under
	// the dedicated "Unanchored" group at the top of the pane.
	return db
		.select()
		.from(notes)
		.where(and(...conditions))
		.orderBy(asc(notes.anchorPage), asc(notes.anchorYRatio), asc(notes.createdAt))
}

export async function softDeleteNote(noteId: string): Promise<void> {
	await db
		.update(notes)
		.set({ deletedAt: new Date(), updatedAt: new Date() })
		.where(eq(notes.id, noteId))
}

export async function getNoteRow(noteId: string): Promise<Note | null> {
	const [note] = await db.select().from(notes).where(eq(notes.id, noteId)).limit(1)
	return note ?? null
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
