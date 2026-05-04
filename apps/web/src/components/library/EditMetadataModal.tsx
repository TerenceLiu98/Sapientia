import { useEffect, useState } from "react"
import type {
	FetchPaperMetadataInput,
	Paper,
	PaperMetadataCandidate,
	PaperPublicationType,
	UpdatePaperInput,
} from "@/api/hooks/papers"

function parseAuthors(value: string) {
	return value
		.split(/[\n,;]+/)
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
}

function arraysEqual(left: string[], right: string[]) {
	if (left.length !== right.length) return false
	return left.every((value, index) => value === right[index])
}

export function EditMetadataModal({
	errorMessage,
	fetchErrorMessage,
	isSaving,
	isFetchingMetadata,
	onClose,
	onFetchMetadata,
	onSubmit,
	open,
	paper,
}: {
	errorMessage?: string | null
	fetchErrorMessage?: string | null
	isFetchingMetadata: boolean
	isSaving: boolean
	onClose: () => void
	onFetchMetadata: (input: FetchPaperMetadataInput) => void
	onSubmit: (patch: UpdatePaperInput) => void
	open: boolean
	paper: Paper | null
}) {
	const [title, setTitle] = useState("")
	const [authors, setAuthors] = useState("")
	const [year, setYear] = useState("")
	const [doi, setDoi] = useState("")
	const [arxivId, setArxivId] = useState("")
	const [venue, setVenue] = useState("")
	const [publicationType, setPublicationType] = useState<PaperPublicationType | "">("")
	const [pages, setPages] = useState("")
	const [volume, setVolume] = useState("")
	const [issue, setIssue] = useState("")
	const [publisher, setPublisher] = useState("")
	const [url, setUrl] = useState("")
	const [abstractText, setAbstractText] = useState("")
	const paperId = paper?.id ?? null

	useEffect(() => {
		if (!open || !paper) return
		setTitle(paper.title ?? "")
		setAuthors((paper.authors ?? []).join("\n"))
		setYear(paper.year != null ? String(paper.year) : "")
		setDoi(paper.doi ?? "")
		setArxivId(paper.arxivId ?? "")
		setVenue(paper.venue ?? "")
		setPublicationType(paper.publicationType ?? "")
		setPages(paper.pages ?? "")
		setVolume(paper.volume ?? "")
		setIssue(paper.issue ?? "")
		setPublisher(paper.publisher ?? "")
		setUrl(paper.url ?? "")
		setAbstractText(paper.abstract ?? "")
	}, [open, paperId])

	if (!open || !paper) return null

	const handleSave = () => {
		const patch: UpdatePaperInput = {}
		const normalizedTitle = title.trim()
		const currentTitle = paper.title?.trim() ?? ""
		if (normalizedTitle !== currentTitle) {
			patch.title = normalizedTitle.length > 0 ? normalizedTitle : null
		}

		const parsedAuthors = parseAuthors(authors)
		const currentAuthors = paper.authors ?? []
		if (!arraysEqual(parsedAuthors, currentAuthors)) {
			patch.authors = parsedAuthors
		}

		const parsedYear = year.trim().length > 0 ? Number.parseInt(year.trim(), 10) : null
		const normalizedYear = parsedYear != null && Number.isNaN(parsedYear) ? null : parsedYear
		if (normalizedYear !== (paper.year ?? null)) {
			patch.year = normalizedYear
		}

		const normalizedDoi = doi.trim()
		const currentDoi = paper.doi ?? ""
		if (normalizedDoi !== currentDoi) {
			patch.doi = normalizedDoi.length > 0 ? normalizedDoi : null
		}

		const normalizedArxivId = arxivId.trim()
		const currentArxivId = paper.arxivId ?? ""
		if (normalizedArxivId !== currentArxivId) {
			patch.arxivId = normalizedArxivId.length > 0 ? normalizedArxivId : null
		}

		const normalizedVenue = venue.trim()
		const currentVenue = paper.venue ?? ""
		if (normalizedVenue !== currentVenue) {
			patch.venue = normalizedVenue.length > 0 ? normalizedVenue : null
		}

		const currentPublicationType = paper.publicationType ?? ""
		if (publicationType !== currentPublicationType) {
			patch.publicationType = publicationType || null
		}

		const normalizedPages = pages.trim()
		if (normalizedPages !== (paper.pages ?? "")) {
			patch.pages = normalizedPages.length > 0 ? normalizedPages : null
		}

		const normalizedVolume = volume.trim()
		if (normalizedVolume !== (paper.volume ?? "")) {
			patch.volume = normalizedVolume.length > 0 ? normalizedVolume : null
		}

		const normalizedIssue = issue.trim()
		if (normalizedIssue !== (paper.issue ?? "")) {
			patch.issue = normalizedIssue.length > 0 ? normalizedIssue : null
		}

		const normalizedPublisher = publisher.trim()
		if (normalizedPublisher !== (paper.publisher ?? "")) {
			patch.publisher = normalizedPublisher.length > 0 ? normalizedPublisher : null
		}

		const normalizedUrl = url.trim()
		if (normalizedUrl !== (paper.url ?? "")) {
			patch.url = normalizedUrl.length > 0 ? normalizedUrl : null
		}

		const normalizedAbstract = abstractText.trim()
		if (normalizedAbstract !== (paper.abstract ?? "")) {
			patch.abstract = normalizedAbstract.length > 0 ? normalizedAbstract : null
		}

		if (Object.keys(patch).length === 0) {
			onClose()
			return
		}

		onSubmit(patch)
	}

	const handleFetchMetadata = () => {
		onFetchMetadata({
			title: title.trim().length > 0 ? title.trim() : null,
			doi: doi.trim().length > 0 ? doi.trim() : null,
			arxivId: arxivId.trim().length > 0 ? arxivId.trim() : null,
		})
	}

	const applyCandidate = (candidate: PaperMetadataCandidate) => {
		const metadata = candidate.metadata
		const protectedFields = paper.metadataEditedByUser ?? {}
		if (!protectedFields.title && metadata.title) setTitle(metadata.title)
		if (!protectedFields.authors && metadata.authors?.length) setAuthors(metadata.authors.join("\n"))
		if (!protectedFields.year && metadata.year) setYear(String(metadata.year))
		if (!protectedFields.doi && metadata.doi) setDoi(metadata.doi)
		if (!protectedFields.arxivId && metadata.arxivId) setArxivId(metadata.arxivId)
		if (!protectedFields.venue && metadata.venue) setVenue(metadata.venue)
		if (!protectedFields.publicationType && metadata.publicationType) {
			setPublicationType(metadata.publicationType)
		}
		if (!protectedFields.pages && metadata.pages) setPages(metadata.pages)
		if (!protectedFields.volume && metadata.volume) setVolume(metadata.volume)
		if (!protectedFields.issue && metadata.issue) setIssue(metadata.issue)
		if (!protectedFields.publisher && metadata.publisher) setPublisher(metadata.publisher)
		if (!protectedFields.url && metadata.url) setUrl(metadata.url)
		if (!protectedFields.abstract && metadata.abstract) setAbstractText(metadata.abstract)
	}

	return (
		<div
			aria-modal="true"
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 py-8"
			role="dialog"
		>
			<div className="max-h-[88vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-border-default bg-bg-primary shadow-[var(--shadow-popover)]">
				<div className="border-b border-border-subtle px-6 py-4">
					<h2 className="font-serif text-2xl text-text-primary">Edit metadata</h2>
					<p className="mt-1 text-sm text-text-secondary">
						Clear any field to keep your manual override instead of future enrichment values.
					</p>
				</div>

				<div className="max-h-[66vh] overflow-y-auto px-6 py-5">
				<div className="grid gap-4 sm:grid-cols-2">
					<label className="sm:col-span-2">
						<span className="mb-1 block text-xs uppercase tracking-[0.18em] text-text-secondary">
							Title
						</span>
						<input
							className="w-full rounded-lg border border-border-default bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-500"
							onChange={(event) => setTitle(event.target.value)}
							value={title}
						/>
					</label>

					<label className="sm:col-span-2">
						<span className="mb-1 block text-xs uppercase tracking-[0.18em] text-text-secondary">
							Authors
						</span>
						<textarea
							className="min-h-28 w-full rounded-lg border border-border-default bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-500"
							onChange={(event) => setAuthors(event.target.value)}
							placeholder={"One author per line\nAda Lovelace\nGrace Hopper"}
							value={authors}
						/>
					</label>

					<label>
						<span className="mb-1 block text-xs uppercase tracking-[0.18em] text-text-secondary">
							Year
						</span>
						<input
							className="w-full rounded-lg border border-border-default bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-500"
							inputMode="numeric"
							onChange={(event) => setYear(event.target.value)}
							placeholder="2024"
							type="number"
							value={year}
						/>
					</label>

					<label>
						<span className="mb-1 block text-xs uppercase tracking-[0.18em] text-text-secondary">
							Venue
						</span>
						<input
							className="w-full rounded-lg border border-border-default bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-500"
							onChange={(event) => setVenue(event.target.value)}
							value={venue}
						/>
					</label>

					<label>
						<span className="mb-1 block text-xs uppercase tracking-[0.18em] text-text-secondary">
							DOI
						</span>
						<input
							className="w-full rounded-lg border border-border-default bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-500"
							onChange={(event) => setDoi(event.target.value)}
							value={doi}
						/>
					</label>

					<label>
						<span className="mb-1 block text-xs uppercase tracking-[0.18em] text-text-secondary">
							arXiv ID
						</span>
						<input
							className="w-full rounded-lg border border-border-default bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-500"
							onChange={(event) => setArxivId(event.target.value)}
							value={arxivId}
						/>
					</label>

					<label>
						<span className="mb-1 block text-xs uppercase tracking-[0.18em] text-text-secondary">
							Type
						</span>
						<select
							className="w-full rounded-lg border border-border-default bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-500"
							onChange={(event) =>
								setPublicationType(event.target.value as PaperPublicationType | "")
							}
							value={publicationType}
						>
							<option value="">Unknown</option>
							<option value="conference">Conference</option>
							<option value="journal">Journal</option>
							<option value="preprint">Preprint</option>
							<option value="book">Book</option>
							<option value="chapter">Chapter</option>
							<option value="other">Other</option>
						</select>
					</label>

					<label>
						<span className="mb-1 block text-xs uppercase tracking-[0.18em] text-text-secondary">
							Pages
						</span>
						<input
							className="w-full rounded-lg border border-border-default bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-500"
							onChange={(event) => setPages(event.target.value)}
							value={pages}
						/>
					</label>

					<label>
						<span className="mb-1 block text-xs uppercase tracking-[0.18em] text-text-secondary">
							Volume
						</span>
						<input
							className="w-full rounded-lg border border-border-default bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-500"
							onChange={(event) => setVolume(event.target.value)}
							value={volume}
						/>
					</label>

					<label>
						<span className="mb-1 block text-xs uppercase tracking-[0.18em] text-text-secondary">
							Issue
						</span>
						<input
							className="w-full rounded-lg border border-border-default bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-500"
							onChange={(event) => setIssue(event.target.value)}
							value={issue}
						/>
					</label>

					<label className="sm:col-span-2">
						<span className="mb-1 block text-xs uppercase tracking-[0.18em] text-text-secondary">
							Publisher
						</span>
						<input
							className="w-full rounded-lg border border-border-default bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-500"
							onChange={(event) => setPublisher(event.target.value)}
							value={publisher}
						/>
					</label>

					<label className="sm:col-span-2">
						<span className="mb-1 block text-xs uppercase tracking-[0.18em] text-text-secondary">
							URL
						</span>
						<input
							className="w-full rounded-lg border border-border-default bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-500"
							onChange={(event) => setUrl(event.target.value)}
							value={url}
						/>
					</label>

					<label className="sm:col-span-2">
						<span className="mb-1 block text-xs uppercase tracking-[0.18em] text-text-secondary">
							Abstract
						</span>
						<textarea
							className="min-h-32 w-full rounded-lg border border-border-default bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-500"
							onChange={(event) => setAbstractText(event.target.value)}
							value={abstractText}
						/>
					</label>
				</div>

				{(paper.metadataCandidates ?? []).length > 0 ? (
					<section className="mt-6 border-t border-border-subtle pt-5">
						<div className="mb-3 flex items-center justify-between gap-3">
							<h3 className="text-sm font-semibold text-text-primary">Review metadata</h3>
							<span className="text-xs text-text-secondary">
								Title matches need your confirmation before they replace fields.
							</span>
						</div>
						<div className="grid gap-3">
							{(paper.metadataCandidates ?? []).map((candidate) => (
								<div
									className="rounded-lg border border-border-subtle bg-surface-subtle px-4 py-3"
									key={candidate.id}
								>
									<div className="flex flex-wrap items-start justify-between gap-3">
										<div>
											<p className="text-sm font-medium text-text-primary">
												{candidate.metadata.title ?? "Untitled candidate"}
											</p>
											<p className="mt-1 text-xs text-text-secondary">
												{candidate.metadata.authors?.slice(0, 4).join(", ") || "Unknown authors"}
												{candidate.metadata.year ? ` · ${candidate.metadata.year}` : ""}
												{candidate.metadata.venue ? ` · ${candidate.metadata.venue}` : ""}
											</p>
											<p className="mt-1 text-xs text-text-secondary">
												{candidate.source.replace("_", " ")} ·{" "}
												{Math.round(candidate.confidence * 100)}% confidence
											</p>
										</div>
										<button
											className="rounded-lg border border-border-default px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-hover"
											onClick={() => applyCandidate(candidate)}
											type="button"
										>
											Apply candidate
										</button>
									</div>
								</div>
							))}
						</div>
					</section>
				) : null}
				</div>

				<div className="border-t border-border-subtle px-6 py-4">
					{errorMessage ? <p className="mb-3 text-sm text-text-error">{errorMessage}</p> : null}
					{fetchErrorMessage ? <p className="mb-3 text-sm text-text-error">{fetchErrorMessage}</p> : null}
					<div className="flex flex-wrap justify-between gap-3">
						<button
							className="rounded-lg border border-border-default px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
							disabled={isFetchingMetadata || isSaving}
							onClick={handleFetchMetadata}
							type="button"
						>
							{isFetchingMetadata ? "Fetching..." : "Fetch metadata"}
						</button>
						<div className="flex flex-wrap justify-end gap-3">
							<button
								className="rounded-lg border border-border-default px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-hover"
								onClick={onClose}
								type="button"
							>
								Cancel
							</button>
							<button
								className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-text-inverse transition-colors hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-60"
								disabled={isSaving || isFetchingMetadata}
								onClick={handleSave}
								type="button"
							>
								{isSaving ? "Saving..." : "Save metadata"}
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
