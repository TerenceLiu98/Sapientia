import { useCallback, useEffect, useRef, useState } from "react"
import { Document, Page } from "react-pdf"
import { usePaperPdfUrl } from "@/api/hooks/papers"

const MIN_SCALE = 0.5
const MAX_SCALE = 3
const FIT_WIDTH_SCALE = 1.4

interface PdfViewerProps {
	paperId: string
	// Imperative jump request from a sibling (e.g. BlocksPanel). Bumping the
	// nonce on each click is enough to retrigger; the page number is in the
	// `requestedPage` prop.
	requestedPage?: number
	requestedPageNonce?: number
	onPageChange?: (page: number) => void
}

export function PdfViewer({
	paperId,
	requestedPage,
	requestedPageNonce,
	onPageChange,
}: PdfViewerProps) {
	const { data, isLoading, isError, refetch } = usePaperPdfUrl(paperId)
	const [numPages, setNumPages] = useState<number | null>(null)
	const [currentPage, setCurrentPage] = useState(1)
	const [scale, setScale] = useState(1.0)
	const [renderError, setRenderError] = useState<string | null>(null)
	const scrollContainerRef = useRef<HTMLDivElement>(null)
	const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())

	const scrollToPage = useCallback((page: number) => {
		const el = pageRefs.current.get(page)
		if (el) el.scrollIntoView({ behavior: "smooth", block: "start" })
	}, [])

	// Notify parent on page change (BlocksPanel uses this to highlight the
	// current page header).
	useEffect(() => {
		onPageChange?.(currentPage)
	}, [currentPage, onPageChange])

	// External jump request: scroll once per nonce change. We deliberately
	// only depend on the nonce so re-clicking the same block still retriggers
	// the scroll, and so a stale `requestedPage` doesn't keep firing.
	// biome-ignore lint/correctness/useExhaustiveDependencies: nonce drives the effect
	useEffect(() => {
		if (requestedPage == null) return
		scrollToPage(requestedPage)
	}, [requestedPageNonce])

	// Track which page is most visible while scrolling.
	useEffect(() => {
		const container = scrollContainerRef.current
		if (!container || numPages == null) return

		const handleScroll = () => {
			let activePage = 1
			let bestRatio = 0
			const containerRect = container.getBoundingClientRect()
			for (const [page, el] of pageRefs.current.entries()) {
				const rect = el.getBoundingClientRect()
				const visibleTop = Math.max(rect.top, containerRect.top)
				const visibleBottom = Math.min(rect.bottom, containerRect.bottom)
				const visibleHeight = Math.max(0, visibleBottom - visibleTop)
				const ratio = visibleHeight / Math.max(rect.height, 1)
				if (ratio > bestRatio) {
					bestRatio = ratio
					activePage = page
				}
			}
			setCurrentPage(activePage)
		}

		container.addEventListener("scroll", handleScroll, { passive: true })
		return () => container.removeEventListener("scroll", handleScroll)
	}, [numPages])

	// PageDown / Space → next, PageUp / Shift+Space → previous.
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
			if (e.key === "PageDown" || (e.key === " " && !e.shiftKey)) {
				e.preventDefault()
				scrollToPage(Math.min(currentPage + 1, numPages ?? 1))
			} else if (e.key === "PageUp" || (e.key === " " && e.shiftKey)) {
				e.preventDefault()
				scrollToPage(Math.max(currentPage - 1, 1))
			}
		}
		window.addEventListener("keydown", handler)
		return () => window.removeEventListener("keydown", handler)
	}, [currentPage, numPages, scrollToPage])

	// Cmd/Ctrl + scroll wheel → zoom.
	useEffect(() => {
		const container = scrollContainerRef.current
		if (!container) return
		const handler = (e: WheelEvent) => {
			if (e.ctrlKey || e.metaKey) {
				e.preventDefault()
				const delta = e.deltaY < 0 ? 0.1 : -0.1
				setScale((s) => clamp(s + delta))
			}
		}
		container.addEventListener("wheel", handler, { passive: false })
		return () => container.removeEventListener("wheel", handler)
	}, [])

	if (isLoading) {
		return <div className="p-8 text-text-tertiary">Loading PDF…</div>
	}

	if (isError || !data) {
		return (
			<div className="p-8">
				<div className="mb-3 text-text-error">Failed to load PDF.</div>
				<button
					className="h-9 rounded-md border border-border-default px-4 text-sm transition-colors hover:bg-surface-hover"
					onClick={() => void refetch()}
					type="button"
				>
					Retry
				</button>
			</div>
		)
	}

	return (
		<div className="flex h-full flex-col bg-[var(--color-reading-bg)]">
			<div className="flex h-10 shrink-0 items-center justify-between border-b border-border-subtle bg-bg-primary px-4">
				<div className="text-sm text-text-secondary">
					Page{" "}
					<input
						className="w-12 rounded-md border border-border-default px-1 text-center text-text-primary"
						type="number"
						min={1}
						max={numPages ?? 1}
						value={currentPage}
						onChange={(e) => {
							const p = Number(e.target.value)
							if (!Number.isNaN(p) && p >= 1) scrollToPage(p)
						}}
					/>{" "}
					of {numPages ?? "—"}
				</div>
				<div className="flex items-center gap-1">
					<button
						aria-label="Zoom out"
						className="h-7 w-7 rounded-md text-sm hover:bg-surface-hover"
						onClick={() => setScale((s) => clamp(s - 0.1))}
						type="button"
					>
						−
					</button>
					<span className="w-12 text-center text-sm text-text-secondary">
						{Math.round(scale * 100)}%
					</span>
					<button
						aria-label="Zoom in"
						className="h-7 w-7 rounded-md text-sm hover:bg-surface-hover"
						onClick={() => setScale((s) => clamp(s + 0.1))}
						type="button"
					>
						+
					</button>
					<button
						aria-label="Fit width"
						className="ml-2 h-7 rounded-md px-2 text-xs hover:bg-surface-hover"
						onClick={() => setScale(FIT_WIDTH_SCALE)}
						type="button"
					>
						Fit
					</button>
				</div>
			</div>

			<div ref={scrollContainerRef} className="flex-1 overflow-auto">
				<Document
					className="flex flex-col items-center gap-4 py-4"
					file={data.url}
					loading={<div className="p-8 text-text-tertiary">Rendering PDF…</div>}
					error={
						<div className="p-8 text-text-error">{renderError ?? "Failed to render PDF."}</div>
					}
					onLoadSuccess={({ numPages: n }) => {
						setNumPages(n)
						setRenderError(null)
					}}
					onLoadError={(err) => setRenderError(err.message)}
				>
					{numPages != null
						? Array.from({ length: numPages }, (_, i) => i + 1).map((page) => (
								<div
									className="bg-white shadow-md"
									key={page}
									ref={(el) => {
										if (el) pageRefs.current.set(page, el)
										else pageRefs.current.delete(page)
									}}
								>
									<Page
										pageNumber={page}
										scale={scale}
										renderAnnotationLayer={false}
										renderTextLayer={true}
									/>
								</div>
							))
						: null}
				</Document>
			</div>
		</div>
	)
}

function clamp(scale: number) {
	return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))
}
