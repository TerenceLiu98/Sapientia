import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "../client"

export interface Paper {
	id: string
	title: string
	fileSizeBytes: number
	parseStatus: "pending" | "parsing" | "done" | "failed"
	parseError: string | null
	createdAt: string
}

export interface PdfUrlResponse {
	url: string
	expiresInSeconds: number
}

function isInFlightStatus(status: Paper["parseStatus"] | undefined) {
	return status === "pending" || status === "parsing"
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
			return list.some((p) => isInFlightStatus(p.parseStatus)) ? 2000 : false
		},
	})
}

export function usePaper(paperId: string) {
	return useQuery<Paper>({
		queryKey: ["paper", paperId],
		queryFn: () => apiFetch<Paper>(`/api/v1/papers/${paperId}`),
		enabled: Boolean(paperId),
		refetchInterval: (query) => {
			const status = query.state.data?.parseStatus
			return isInFlightStatus(status) ? 2000 : false
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
