import { type Job, Worker } from "bullmq"
import { logger } from "../logger"
import { queueConnection } from "../queues/connection"
import {
	NOTE_CONCEPT_EXTRACT_QUEUE,
	type NoteConceptExtractJobData,
	type NoteConceptExtractJobResult,
} from "../queues/note-concept-extract"
import { extractNoteBornConcepts } from "../services/note-concept-extract"

async function processNoteConceptExtract(
	job: Job<NoteConceptExtractJobData, NoteConceptExtractJobResult>,
): Promise<NoteConceptExtractJobResult> {
	const log = logger.child({ jobId: job.id, noteId: job.data.noteId })
	log.info("note_concept_extract_job_started")
	const result = await extractNoteBornConcepts(job.data)
	log.info(result, "note_concept_extract_job_completed")
	return result
}

export function createNoteConceptExtractWorker() {
	const worker = new Worker<NoteConceptExtractJobData, NoteConceptExtractJobResult>(
		NOTE_CONCEPT_EXTRACT_QUEUE,
		processNoteConceptExtract,
		{ connection: queueConnection, concurrency: 2 },
	)

	worker.on("failed", (job, err) => {
		logger.error(
			{ jobId: job?.id, noteId: job?.data.noteId, err: err.message, attempts: job?.attemptsMade },
			"note_concept_extract_job_failed",
		)
	})

	worker.on("error", (err) => {
		logger.error({ err: err.message }, "note_concept_extract_worker_error")
	})

	return worker
}
