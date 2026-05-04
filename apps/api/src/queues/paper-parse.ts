import { Queue } from "bullmq"
import { queueConnection } from "./connection"

export const PAPER_PARSE_QUEUE = "paper-parse"

export interface PaperParseJobData {
	paperId: string
	userId: string
	reuseExistingMineruZip?: boolean
}

export interface PaperParseJobResult {
	paperId: string
	blocksObjectKey: string | null
	parsedAt: string
}

export const paperParseQueue = new Queue<PaperParseJobData, PaperParseJobResult>(
	PAPER_PARSE_QUEUE,
	{
		connection: queueConnection,
		defaultJobOptions: {
			attempts: 3,
			backoff: { type: "exponential", delay: 5000 },
			removeOnComplete: { age: 24 * 3600, count: 1000 },
			removeOnFail: { age: 7 * 24 * 3600 },
		},
	},
)

// Same paper enqueued twice while a job is pending will be deduped via jobId.
// BullMQ silently discards a second add() call with an existing jobId. Manual
// retry is different: failed jobs are retained for inspection, so we remove the
// stale retained job before adding a fresh one.
export async function enqueuePaperParse(
	data: PaperParseJobData,
	options: { force?: boolean } = {},
) {
	const jobId = `paper-parse-${data.paperId}`
	if (options.force) {
		const existing = await paperParseQueue.getJob(jobId)
		if (existing) {
			const state = await existing.getState()
			if (state !== "active") {
				await existing.remove()
			}
		}
	}

	return paperParseQueue.add(`parse-${data.paperId}`, data, { jobId })
}
