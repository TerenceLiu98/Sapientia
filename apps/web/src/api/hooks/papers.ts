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
	enrichmentStatus: PaperEnrichmentStatus
	enrichmentSource: string | null
	metadataEditedByUser: Partial<Record<"title" | "authors" | "year" | "doi" | "arxivId" | "venue", true>>
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

function isInFlightStatus(status: Paper["parseStatus"] | undefined) {
	return status === "pending" || status === "parsing"
}

function isEnrichmentInFlight(status: Paper["enrichmentStatus"] | undefined) {
	return status === "pending" || status === "enriching"
}

function shouldPollPaper(paper: Paper | undefined) {
	if (!paper) return false
	return isInFlightStatus(paper.parseStatus) || isEnrichmentInFlight(paper.enrichmentStatus)
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
