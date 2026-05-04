import { Queue } from "bullmq"
import { queueConnection } from "./connection"

export const NOTE_CONCEPT_HEARTBEAT_QUEUE = "note-concept-heartbeat"
export const NOTE_CONCEPT_HEARTBEAT_JOB_ID = "note-concept-heartbeat"
export const NOTE_CONCEPT_HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000

export interface NoteConceptHeartbeatJobData {
	limit?: number
}

export interface NoteConceptHeartbeatJobResult {
	scannedLimit: number
	queuedCount: number
}

export const noteConceptHeartbeatQueue = new Queue<
	NoteConceptHeartbeatJobData,
	NoteConceptHeartbeatJobResult
>(NOTE_CONCEPT_HEARTBEAT_QUEUE, {
	connection: queueConnection,
	defaultJobOptions: {
		attempts: 1,
		removeOnComplete: { age: 24 * 3600, count: 100 },
		removeOnFail: { age: 7 * 24 * 3600 },
	},
})

export async function scheduleNoteConceptHeartbeat() {
	await removeStaleHeartbeatSchedules()
	return noteConceptHeartbeatQueue.add(
		NOTE_CONCEPT_HEARTBEAT_JOB_ID,
		{ limit: 200 },
		{
			jobId: NOTE_CONCEPT_HEARTBEAT_JOB_ID,
			repeat: { every: NOTE_CONCEPT_HEARTBEAT_INTERVAL_MS },
		},
	)
}

async function removeStaleHeartbeatSchedules() {
	const repeatableJobs = await noteConceptHeartbeatQueue.getRepeatableJobs()
	await Promise.all(
		repeatableJobs
			.filter(
				(job) =>
					job.name === NOTE_CONCEPT_HEARTBEAT_JOB_ID &&
					job.every !== String(NOTE_CONCEPT_HEARTBEAT_INTERVAL_MS),
			)
			.map((job) => noteConceptHeartbeatQueue.removeRepeatableByKey(job.key)),
	)
}
