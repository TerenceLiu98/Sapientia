import { type Job, Worker } from "bullmq"
import { logger } from "../logger"
import { queueConnection } from "../queues/connection"
import {
	NOTE_CONCEPT_HEARTBEAT_QUEUE,
	type NoteConceptHeartbeatJobData,
	type NoteConceptHeartbeatJobResult,
} from "../queues/note-concept-heartbeat"
import { enqueueNoteConceptExtract } from "../queues/note-concept-extract"
import { enqueueDueNoteConceptExtractions } from "../services/note-concept-extract"

async function processNoteConceptHeartbeat(
	job: Job<NoteConceptHeartbeatJobData, NoteConceptHeartbeatJobResult>,
): Promise<NoteConceptHeartbeatJobResult> {
	const limit = job.data.limit ?? 200
	const log = logger.child({ jobId: job.id, limit })
	log.info("note_concept_heartbeat_job_started")
	const due = await enqueueDueNoteConceptExtractions({ limit })
	for (const item of due) {
		await enqueueNoteConceptExtract({ noteId: item.noteId })
	}
	const result = { scannedLimit: limit, queuedCount: due.length }
	log.info(result, "note_concept_heartbeat_job_completed")
	return result
}

export function createNoteConceptHeartbeatWorker() {
	const worker = new Worker<NoteConceptHeartbeatJobData, NoteConceptHeartbeatJobResult>(
		NOTE_CONCEPT_HEARTBEAT_QUEUE,
		processNoteConceptHeartbeat,
		{ connection: queueConnection, concurrency: 1 },
	)

	worker.on("failed", (job, err) => {
		logger.error(
			{ jobId: job?.id, err: err.message, attempts: job?.attemptsMade },
			"note_concept_heartbeat_job_failed",
		)
	})

	worker.on("error", (err) => {
		logger.error({ err: err.message }, "note_concept_heartbeat_worker_error")
	})

	return worker
}
