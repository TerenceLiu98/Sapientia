import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "../client"

export type PaperParseStatus = "pending" | "parsing" | "done" | "failed"
export type PaperEnrichmentStatus =
	| "pending"
	| "enriching"
	| "enriched"
	| "partial"
	| "failed"
	| "skipped"
export type PaperSummaryStatus = "pending" | "running" | "done" | "failed" | "no-credentials"

export interface Paper {
	id: string
	title: string
	authors: string[] | null
	year: number | null
	doi: string | null
	arxivId: string | null
	venue: string | null
	displayFilename: string
	fileSizeBytes: number
	parseStatus: PaperParseStatus
	parseError: string | null
	parseProgressExtracted: number | null
	parseProgressTotal: number | null
	summary: string | null
	summaryStatus: PaperSummaryStatus
	summaryError: string | null
	enrichmentStatus: PaperEnrichmentStatus
	enrichmentSource: string | null
	metadataEditedByUser: Partial<
		Record<"title" | "authors" | "year" | "doi" | "arxivId" | "venue", true>
	>
	createdAt: string
	updatedAt: string
}

export interface PdfUrlResponse {
	url: string
	expiresInSeconds: number
	downloadFilename: string
}

export interface UpdatePaperInput {
	title?: string | null
	authors?: string[] | null
	year?: number | null
	doi?: string | null
	arxivId?: string | null
	venue?: string | null
}

export interface FetchPaperMetadataInput {
	title?: string | null
	doi?: string | null
	arxivId?: string | null
}

export interface RetryPaperParseResponse {
	ok: true
	status: "queued"
	paper: Paper
	queue: "paper-parse"
}

export interface RetryPaperKnowledgeResponse {
	ok: true
	status: "queued"
	paperId: string
	queue: "paper-summarize"
}

export interface PaperWikiPage {
	id: string
	type: "source" | "entity" | "concept"
	canonicalName: string
	displayName: string
	body: string | null
	status: "pending" | "running" | "done" | "failed"
	error: string | null
	generatedAt: string | null
	modelName: string | null
	promptVersion: string | null
	sourcePaperId: string | null
	referenceBlockIds: string[]
}

export interface PaperWikiConcept {
	id: string
	kind: "concept" | "method" | "task" | "metric" | "dataset"
	canonicalName: string
	displayName: string
	status: "pending" | "running" | "done" | "failed"
	error: string | null
	salienceScore: number
	highlightCount: number
	weightedHighlightScore: number
	noteCitationCount: number
	lastMarginaliaAt: string | null
	sourceLevelDescription: string | null
	sourceLevelDescriptionStatus: "pending" | "running" | "done" | "failed"
	readerSignalSummary: string | null
	generatedAt: string | null
	modelName: string | null
	promptVersion: string | null
	evidence: Array<{
		blockId: string
		snippet: string | null
		confidence: number | null
	}>
}

export interface PaperWikiEdge {
	id: string
	sourceConceptId: string
	targetConceptId: string
	relationType: "addresses" | "uses" | "measured_by" | "improves_on" | "related_to"
	confidence: number | null
	evidence: Array<{
		blockId: string
		snippet: string | null
		confidence: number | null
	}>
}

export interface PaperBlockConceptLensPayload {
	workspaceId: string
	paperId: string
	blockId: string
	concepts: Array<{
		id: string
		kind: PaperWikiConcept["kind"]
		canonicalName: string
		displayName: string
		status: PaperWikiConcept["status"]
		salienceScore: number
		highlightCount: number
		noteCitationCount: number
		sourceLevelDescription: string | null
		sourceLevelDescriptionStatus: "pending" | "running" | "done" | "failed"
		readerSignalSummary: string | null
		promptVersion: string | null
		evidence: {
			blockId: string
			snippet: string | null
			confidence: number | null
		}
		cluster: {
			id: string
			displayName: string | null
			canonicalName: string | null
			kind: PaperWikiConcept["kind"] | null
			memberCount: number | null
			paperCount: number | null
		} | null
	}>
	semanticCandidates: Array<{
		id: string
		sourceClusterId: string
		targetClusterId: string
		sourceLocalConceptId: string
		targetLocalConceptId: string
		kind: PaperWikiConcept["kind"]
		matchMethod: "lexical_source_description" | "embedding" | "llm" | "user_confirmed"
		similarityScore: number
		llmDecision: "same" | "related" | "different" | "uncertain" | null
		llmConfidence: number | null
		decisionStatus:
			| "candidate"
			| "auto_accepted"
			| "ai_confirmed"
			| "ai_rejected"
			| "needs_review"
			| "rejected"
			| "user_accepted"
			| "user_rejected"
		rationale: string | null
		relatedCluster: {
			id: string
			displayName: string
			canonicalName: string
			kind: PaperWikiConcept["kind"]
			memberCount: number
			paperCount: number
		} | null
	}>
}

function isInFlightStatus(status: Paper["parseStatus"] | undefined) {
	return status === "pending" || status === "parsing"
}

function isEnrichmentInFlight(status: Paper["enrichmentStatus"] | undefined) {
	return status === "pending" || status === "enriching"
}

function shouldPollPaper(paper: Paper | undefined) {
	if (!paper) return false
	return (
		isInFlightStatus(paper.parseStatus) ||
		isEnrichmentInFlight(paper.enrichmentStatus) ||
		paper.summaryStatus === "pending" ||
		paper.summaryStatus === "running"
	)
}

function downloadBlob(blob: Blob, filename: string) {
	const objectUrl = URL.createObjectURL(blob)
	const anchor = document.createElement("a")
	anchor.href = objectUrl
	anchor.download = filename
	document.body.appendChild(anchor)
	anchor.click()
	anchor.remove()
	window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}

async function downloadApiAsset(path: string, filename: string) {
	const res = await fetch(path, { credentials: "include" })
	if (!res.ok) {
		throw new Error(`download failed (${res.status})`)
	}
	const blob = await res.blob()
	downloadBlob(blob, filename)
}

function bibtexFilenameForPaper(paper: Pick<Paper, "displayFilename" | "title" | "id">) {
	const basename = paper.displayFilename || paper.title || `paper-${paper.id.slice(0, 8)}.pdf`
	return basename.replace(/\.pdf$/i, ".bib")
}

export function usePapers(workspaceId: string) {
	return useQuery<Paper[]>({
		queryKey: ["papers", workspaceId],
		queryFn: () => apiFetch<Paper[]>(`/api/v1/workspaces/${workspaceId}/papers`),
		enabled: Boolean(workspaceId),
		// Poll while any paper in the workspace is still being parsed so the
		// status badge updates without a manual refresh. v0.2 should switch to
		// SSE for cheaper, lower-latency updates.
		refetchInterval: (query) => {
			const list = query.state.data
			if (!list) return false
			return list.some((p) => shouldPollPaper(p)) ? 2000 : false
		},
	})
}

export function usePaper(paperId: string) {
	return useQuery<Paper>({
		queryKey: ["paper", paperId],
		queryFn: () => apiFetch<Paper>(`/api/v1/papers/${paperId}`),
		enabled: Boolean(paperId),
		refetchInterval: (query) => {
			return shouldPollPaper(query.state.data) ? 2000 : false
		},
	})
}

export function usePaperBlockConceptLens(
	workspaceId: string | undefined,
	paperId: string,
	blockId: string | null | undefined,
) {
	return useQuery<PaperBlockConceptLensPayload>({
		queryKey: ["paper-block-concept-lens", workspaceId ?? "", paperId, blockId ?? ""],
		queryFn: () =>
			apiFetch<PaperBlockConceptLensPayload>(
				`/api/v1/workspaces/${workspaceId}/papers/${paperId}/blocks/${blockId}/concepts`,
			),
		enabled: Boolean(workspaceId) && Boolean(paperId) && Boolean(blockId),
		retry: false,
	})
}

export function usePaperPdfUrl(paperId: string) {
	return useQuery<PdfUrlResponse>({
		queryKey: ["paper", paperId, "pdf-url"],
		queryFn: () => apiFetch<PdfUrlResponse>(`/api/v1/papers/${paperId}/pdf-url`),
		staleTime: 30 * 60 * 1000,
		enabled: Boolean(paperId),
	})
}

interface UploadInput {
	file: File
	onProgress?: (pct: number) => void
}

// XHR is used because fetch's progress streaming is still inconsistent across
// browsers in 2026 and TanStack Query's mutationFn does not surface upload
// progress on its own. XHR is reliable and supports `withCredentials` for
// cookie-based auth.
function uploadViaXhr(workspaceId: string, { file, onProgress }: UploadInput): Promise<Paper> {
	return new Promise<Paper>((resolve, reject) => {
		const xhr = new XMLHttpRequest()
		const formData = new FormData()
		formData.append("file", file)

		xhr.upload.addEventListener("progress", (event) => {
			if (event.lengthComputable && onProgress) {
				onProgress(Math.round((event.loaded / event.total) * 100))
			}
		})

		xhr.addEventListener("load", () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				try {
					resolve(JSON.parse(xhr.responseText) as Paper)
				} catch {
					reject(new Error("invalid server response"))
				}
				return
			}

			let message = xhr.statusText
			try {
				const parsed = JSON.parse(xhr.responseText) as { error?: string }
				if (parsed?.error) message = parsed.error
			} catch {
				// keep statusText fallback
			}
			reject(new Error(message))
		})

		xhr.addEventListener("error", () => reject(new Error("network error")))
		xhr.addEventListener("abort", () => reject(new Error("upload aborted")))

		xhr.open("POST", `/api/v1/workspaces/${workspaceId}/papers`)
		xhr.withCredentials = true
		xhr.send(formData)
	})
}

export function useUploadPaper(workspaceId: string) {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: (input: UploadInput) => uploadViaXhr(workspaceId, input),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["papers", workspaceId] })
		},
	})
}

export function useDeletePaper(workspaceId: string) {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: (paperId: string) =>
			apiFetch<{ ok: true }>(`/api/v1/papers/${paperId}`, { method: "DELETE" }),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["papers", workspaceId] })
		},
	})
}

export function useUpdatePaper(workspaceId: string, paperId: string) {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: (input: UpdatePaperInput) =>
			apiFetch<Paper>(`/api/v1/papers/${paperId}`, {
				method: "PATCH",
				body: JSON.stringify(input),
			}),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["papers", workspaceId] })
			qc.invalidateQueries({ queryKey: ["paper", paperId] })
		},
	})
}

export function useFetchPaperMetadata(workspaceId: string, paperId: string) {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: (input: FetchPaperMetadataInput) =>
			apiFetch<Paper>(`/api/v1/papers/${paperId}/fetch-metadata`, {
				method: "POST",
				body: JSON.stringify(input),
			}),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["papers", workspaceId] })
			qc.invalidateQueries({ queryKey: ["paper", paperId] })
		},
	})
}

export function useRetryPaperParse(workspaceId: string) {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: (paperId: string) =>
			apiFetch<RetryPaperParseResponse>(`/api/v1/papers/${paperId}/retry-parse`, {
				method: "POST",
			}),
		onSuccess: ({ paper }) => {
			if (workspaceId) qc.invalidateQueries({ queryKey: ["papers", workspaceId] })
			qc.invalidateQueries({ queryKey: ["paper", paper.id] })
			qc.invalidateQueries({ queryKey: ["paper", paper.id, "blocks"] })
		},
	})
}

export function useRetryPaperKnowledge(workspaceId: string) {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: (paperId: string) =>
			apiFetch<RetryPaperKnowledgeResponse>(`/api/v1/papers/${paperId}/retry-knowledge`, {
				method: "POST",
			}),
		onSuccess: ({ paperId }) => {
			qc.setQueryData<Paper>(["paper", paperId], (paper) =>
				paper ? { ...paper, summaryStatus: "pending", summaryError: null } : paper,
			)
			if (workspaceId) {
				qc.setQueryData<Paper[]>(["papers", workspaceId], (list) =>
					list?.map((paper) =>
						paper.id === paperId
							? { ...paper, summaryStatus: "pending", summaryError: null }
							: paper,
					),
				)
				qc.invalidateQueries({ queryKey: ["papers", workspaceId] })
				qc.invalidateQueries({ queryKey: ["workspace-graph", workspaceId] })
				qc.invalidateQueries({ queryKey: ["paper-block-concept-lens", workspaceId, paperId] })
			}
			qc.invalidateQueries({ queryKey: ["paper", paperId] })
		},
	})
}

export function useExportPaperBibtex(paper: Pick<Paper, "id" | "displayFilename" | "title">) {
	return useMutation({
		mutationFn: async () => {
			await downloadApiAsset(`/api/v1/papers/${paper.id}/bibtex`, bibtexFilenameForPaper(paper))
		},
	})
}

export function useExportWorkspaceBibtex(workspaceId: string) {
	return useMutation({
		mutationFn: async () => {
			await downloadApiAsset(
				`/api/v1/workspaces/${workspaceId}/papers/bibtex`,
				`sapientia-${workspaceId.slice(0, 8)}.bib`,
			)
		},
	})
}

export function useDownloadPaperPdf(paperId: string) {
	return useMutation({
		mutationFn: async () => {
			const response = await apiFetch<PdfUrlResponse>(`/api/v1/papers/${paperId}/pdf-url`)
			const pdfResponse = await fetch(response.url)
			if (!pdfResponse.ok) {
				throw new Error(`download failed (${pdfResponse.status})`)
			}
			const blob = await pdfResponse.blob()
			downloadBlob(blob, response.downloadFilename)
		},
	})
}
