import { useState } from "react"
import { useDropzone } from "react-dropzone"
import { useUploadPaper } from "@/api/hooks/papers"

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024

export function UploadDropzone({
	workspaceId,
	onComplete,
}: {
	workspaceId: string
	onComplete?: () => void
}) {
	const upload = useUploadPaper(workspaceId)
	const [progress, setProgress] = useState(0)
	const [error, setError] = useState<string | null>(null)

	const { getRootProps, getInputProps, isDragActive } = useDropzone({
		accept: { "application/pdf": [".pdf"] },
		maxSize: MAX_FILE_SIZE_BYTES,
		multiple: false,
		disabled: upload.isPending,
		// File System Access API is unavailable in jsdom and on older browsers; the
		// classic <input type="file"> path is fine for our needs.
		useFsAccessApi: false,
		onDrop: async (accepted) => {
			const file = accepted[0]
			if (!file) return
			setError(null)
			setProgress(0)
			try {
				await upload.mutateAsync({ file, onProgress: setProgress })
				onComplete?.()
			} catch (err) {
				setError(err instanceof Error ? err.message : "upload failed")
			}
		},
		onDropRejected: (rejections) => {
			const reason = rejections[0]?.errors[0]?.message ?? "rejected"
			setError(reason)
		},
	})

	return (
		<div
			{...getRootProps()}
			className={`cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
				isDragActive
					? "border-border-accent bg-surface-hover"
					: "border-border-default hover:border-border-accent"
			}`}
		>
			<input {...getInputProps()} />
			{upload.isPending ? (
				<div>
					<div className="mb-2 text-sm text-text-secondary">Uploading… {progress}%</div>
					<div className="h-1 overflow-hidden rounded-full bg-bg-tertiary">
						<div
							className="h-full bg-accent-600 transition-all"
							style={{ width: `${progress}%` }}
						/>
					</div>
				</div>
			) : (
				<div>
					<p className="font-medium text-text-primary">
						{isDragActive ? "Drop the PDF here" : "Drop a PDF here, or click to browse"}
					</p>
					<p className="mt-1 text-sm text-text-secondary">Max 50 MB</p>
				</div>
			)}
			{error ? <p className="mt-3 text-sm text-text-error">{error}</p> : null}
		</div>
	)
}
