import { papers } from "@sapientia/db"
import { type Job, Worker } from "bullmq"
import { eq } from "drizzle-orm"
import { db } from "../db"
import { logger } from "../logger"
import { queueConnection } from "../queues/connection"
import {
	PAPER_ENRICH_QUEUE,
	type PaperEnrichJobData,
	type PaperEnrichJobResult,
} from "../queues/paper-enrich"
import { enrich } from "../services/enrichment/orchestrator"
import { extractIdentifiers } from "../services/enrichment/identifier-extractor"
import { applyEnrichedMetadataToPaper } from "../services/paper-metadata"
import { downloadFromS3 } from "../services/s3-client"

async function processPaperEnrich(
	job: Job<PaperEnrichJobData, PaperEnrichJobResult>,
): Promise<PaperEnrichJobResult> {
	const { paperId } = job.data
	const log = logger.child({ jobId: job.id, paperId })

	const [paper] = await db.select().from(papers).where(eq(papers.id, paperId)).limit(1)
	if (!paper || paper.deletedAt) {
		log.warn("paper_not_found_for_enrichment")
		return { paperId, status: "failed", sources: [] }
	}

	await db
		.update(papers)
		.set({
			enrichmentStatus: "enriching",
			enrichmentSource: null,
			enrichedAt: null,
			updatedAt: new Date(),
		})
		.where(eq(papers.id, paperId))

	let pdfBytes: Buffer
	try {
		const bytes = await downloadFromS3(paper.pdfObjectKey)
		pdfBytes = Buffer.from(bytes)
	} catch (error) {
		log.error({ err: error instanceof Error ? error.message : String(error) }, "enrichment_pdf_download_failed")
		await db
			.update(papers)
			.set({ enrichmentStatus: "failed", updatedAt: new Date() })
			.where(eq(papers.id, paperId))
		return { paperId, status: "failed", sources: [] }
	}

	const ids = await extractIdentifiers({
		pdfBytes,
		filename: paper.displayFilename || `${paper.title}.pdf`,
	})
	log.info(
		{ doi: ids.doi, arxivId: ids.arxivId, hasTitle: Boolean(ids.candidateTitle) },
		"enrichment_identifiers_extracted",
	)

	if (!ids.doi && !ids.arxivId && !ids.candidateTitle) {
		await db
			.update(papers)
			.set({ enrichmentStatus: "skipped", updatedAt: new Date() })
			.where(eq(papers.id, paperId))
		return { paperId, status: "skipped", sources: [] }
	}

	const result = await enrich(ids)

	await db
		.update(papers)
		.set(applyEnrichedMetadataToPaper(paper, result))
		.where(eq(papers.id, paperId))

	return {
		paperId,
		status: result.status,
		sources: result.sources,
	}
}

export function createPaperEnrichWorker() {
	return new Worker<PaperEnrichJobData, PaperEnrichJobResult>(
		PAPER_ENRICH_QUEUE,
		processPaperEnrich,
		{
			connection: queueConnection,
			concurrency: 4,
		},
	)
}
