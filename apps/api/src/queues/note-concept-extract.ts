import { Queue } from "bullmq"
import { queueConnection } from "./connection"

export const NOTE_CONCEPT_EXTRACT_QUEUE = "note-concept-extract"

export interface NoteConceptExtractJobData {
	noteId: string
}

export interface NoteConceptExtractJobResult {
	noteId: string
	paperId: string | null
	workspaceId: string | null
	status: "done" | "skipped"
	reason?: string
	groundedConceptCount: number
	questionCount: number
	touchedConceptCount: number
}

export const noteConceptExtractQueue = new Queue<
	NoteConceptExtractJobData,
	NoteConceptExtractJobResult
>(NOTE_CONCEPT_EXTRACT_QUEUE, {
	connection: queueConnection,
	defaultJobOptions: {
		attempts: 2,
		backoff: { type: "exponential", delay: 5000 },
		removeOnComplete: { age: 24 * 3600, count: 1000 },
		removeOnFail: { age: 7 * 24 * 3600 },
	},
})

export async function enqueueNoteConceptExtract(data: NoteConceptExtractJobData) {
	const jobId = `note-concept-extract-${data.noteId}`
	const existing = await noteConceptExtractQueue.getJob(jobId)
	if (existing) {
		const state = await existing.getState()
		if (state === "completed" || state === "failed") {
			await existing.remove()
		} else {
			return existing
		}
	}

	return noteConceptExtractQueue.add(`note-concept-extract-${data.noteId}`, data, { jobId })
}
