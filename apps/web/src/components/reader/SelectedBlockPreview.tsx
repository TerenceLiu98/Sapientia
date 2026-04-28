import { RotateCw } from "lucide-react"
import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import type { Block } from "@/api/hooks/blocks"

const PREVIEW_MIN_SCALE = 0.75
const PREVIEW_MAX_SCALE = 3.5
const PREVIEW_MIN_WIDTH_PX = 320
const PREVIEW_MAX_WIDTH_PX = 1480
const PREVIEW_VIEWPORT_MARGIN_PX = 48
// Popup outer width targets at least this fraction of the viewport so
// (a) small natural images still open at a readable size, and (b) the
// caption gets enough horizontal room to wrap into few lines instead
// of a tall paragraph.
const PREVIEW_TARGET_VIEWPORT_FRACTION = 0.78

function clampPreviewScale(scale: number) {
	return Math.max(PREVIEW_MIN_SCALE, Math.min(PREVIEW_MAX_SCALE, Number(scale.toFixed(2))))
}

export function SelectedBlockPreview({
	block,
	onDismiss,
}: {
	block: Block
	onDismiss?: () => void
}) {
	const [popupScale, setPopupScale] = useState(1)
	const [rotation, setRotation] = useState(0)
	const [offset, setOffset] = useState({ x: 0, y: 0 })
	const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null)
	const [viewportSize, setViewportSize] = useState<{ width: number; height: number } | null>(null)
	const interactionRef = useRef<
		| {
				mode: "drag"
				originX: number
				originY: number
				startX: number
				startY: number
		  }
		| {
				mode: "resize"
				originScale: number
				startX: number
				startY: number
				axis: "x" | "y" | "xy"
		  }
		| null
	>(null)
	const summary = (block.caption ?? block.text ?? "").trim()
	const isQuarterTurn = Math.abs(rotation % 180) === 90
	const previewBaseSize = useMemo(() => {
		const fallbackCaption = 1024
		const fallbackImage = { width: 1024, height: 560 }
		if (!naturalSize || !viewportSize) {
			return {
				captionWidth: fallbackCaption,
				imageWidth: fallbackImage.width,
				imageHeight: fallbackImage.height,
			}
		}
		const { width: nw, height: nh } = naturalSize

		const availableWidth = Math.max(
			PREVIEW_MIN_WIDTH_PX,
			viewportSize.width - PREVIEW_VIEWPORT_MARGIN_PX * 2,
		)
		const availableHeight = Math.max(
			240,
			viewportSize.height - PREVIEW_VIEWPORT_MARGIN_PX * 2,
		)

		// Caption dock width: rotation-invariant. Driven by the un-rotated
		// natural width plus a viewport floor, so rotating never reflows
		// the caption.
		const targetWidth = Math.max(nw, viewportSize.width * PREVIEW_TARGET_VIEWPORT_FRACTION)
		const captionWidth = Math.max(
			PREVIEW_MIN_WIDTH_PX,
			Math.round(Math.min(targetWidth, availableWidth, PREVIEW_MAX_WIDTH_PX)),
		)

		// Image visual dimensions (post-rotation). Card hugs these so
		// there's no leftover gutter making the chrome perceptible.
		const visualAspect = isQuarterTurn ? nw / nh : nh / nw // visualH / visualW
		const captionAllowance = summary ? Math.min(240, availableHeight * 0.4) : 0
		const maxImageHeight = Math.max(160, availableHeight - captionAllowance)
		// Cap image's visual width at the caption width too, so wide
		// figures don't make the image card visually broader than the
		// caption dock — keeps the pair feeling aligned.
		const maxImageWidth = Math.min(captionWidth, availableWidth)
		let imageWidth = maxImageWidth
		let imageHeight = imageWidth * visualAspect
		if (imageHeight > maxImageHeight) {
			imageHeight = maxImageHeight
			imageWidth = imageHeight / visualAspect
		}
		return {
			captionWidth,
			imageWidth: Math.round(imageWidth),
			imageHeight: Math.round(imageHeight),
		}
	}, [isQuarterTurn, naturalSize, summary, viewportSize])

	const endDrag = useCallback(() => {
		interactionRef.current = null
	}, [])

	const handlePointerMove = useCallback((event: PointerEvent) => {
		const interaction = interactionRef.current
		if (!interaction) return
		if (interaction.mode === "drag") {
			setOffset({
				x: interaction.originX + (event.clientX - interaction.startX),
				y: interaction.originY + (event.clientY - interaction.startY),
			})
			return
		}
		const deltaX = event.clientX - interaction.startX
		const deltaY = event.clientY - interaction.startY
		const delta =
			interaction.axis === "x"
				? deltaX
				: interaction.axis === "y"
					? deltaY
					: Math.max(deltaX, deltaY)
		setPopupScale(clampPreviewScale(interaction.originScale + delta / 420))
	}, [])

	useEffect(() => {
		if (typeof window === "undefined") return
		window.addEventListener("pointermove", handlePointerMove)
		window.addEventListener("pointerup", endDrag)
		window.addEventListener("pointercancel", endDrag)
		return () => {
			window.removeEventListener("pointermove", handlePointerMove)
			window.removeEventListener("pointerup", endDrag)
			window.removeEventListener("pointercancel", endDrag)
		}
	}, [endDrag, handlePointerMove])

	useEffect(() => {
		if (typeof window === "undefined") return
		const syncViewport = () => {
			setViewportSize({ width: window.innerWidth, height: window.innerHeight })
		}
		syncViewport()
		window.addEventListener("resize", syncViewport)
		return () => window.removeEventListener("resize", syncViewport)
	}, [])

	useEffect(() => {
		if (typeof window === "undefined") return
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault()
				onDismiss?.()
			}
		}
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [onDismiss])

	const handlePointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			event.preventDefault()
			interactionRef.current = {
				mode: "drag",
				originX: offset.x,
				originY: offset.y,
				startX: event.clientX,
				startY: event.clientY,
			}
		},
		[offset.x, offset.y],
	)

	const handleResizePointerDown = useCallback(
		(axis: "x" | "y" | "xy") => (event: ReactPointerEvent<HTMLButtonElement>) => {
			event.preventDefault()
			event.stopPropagation()
			interactionRef.current = {
				mode: "resize",
				originScale: popupScale,
				startX: event.clientX,
				startY: event.clientY,
				axis,
			}
		},
		[popupScale],
	)

	return (
		<div className="pointer-events-none absolute inset-0 z-[5] p-6">
			<button
				aria-label="Close focused preview"
				className="pointer-events-auto absolute inset-0 bg-black/18 backdrop-blur-[1px]"
				onClick={() => onDismiss?.()}
				type="button"
			/>
			{/* Image card: absolutely centered, draggable. Caption dock
			    (rendered as a sibling further down) is pinned to the
			    viewport bottom independently — rotating or zooming the
			    image leaves the caption put. */}
			<div
				className="pointer-events-auto absolute left-1/2 top-1/2"
				style={{
					transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
				}}
			>
				<div
					className="relative overflow-hidden rounded-2xl border border-border-default bg-bg-overlay/97 shadow-[var(--shadow-popover)] backdrop-blur"
					style={{ width: `${previewBaseSize.imageWidth * popupScale}px` }}
				>
					<div
						className="absolute inset-x-0 top-0 z-[1] h-14 cursor-grab active:cursor-grabbing"
						onPointerDown={handlePointerDown}
					/>
					<div
						className="group relative flex items-center justify-center overflow-hidden bg-bg-secondary"
						style={{ height: `${previewBaseSize.imageHeight * popupScale}px` }}
					>
						<div
							className="shrink-0 flex items-center justify-center"
							style={{
								width: isQuarterTurn
									? `${previewBaseSize.imageHeight * popupScale}px`
									: `${previewBaseSize.imageWidth * popupScale}px`,
								height: isQuarterTurn
									? `${previewBaseSize.imageWidth * popupScale}px`
									: `${previewBaseSize.imageHeight * popupScale}px`,
							}}
						>
							<img
								alt={block.caption ?? `${block.type} preview`}
								className="h-full w-full object-contain transition-transform"
								onLoad={(event) => {
									const image = event.currentTarget
									setNaturalSize({
										width: image.naturalWidth,
										height: image.naturalHeight,
									})
								}}
								src={block.imageUrl ?? undefined}
								style={{ transform: `rotate(${rotation}deg)` }}
							/>
						</div>
					</div>
					<button
						aria-label="Resize focused preview horizontally"
						className="absolute right-0 top-12 hidden h-[calc(100%-3rem)] w-3 cursor-ew-resize bg-transparent md:block"
						onPointerDown={handleResizePointerDown("x")}
						type="button"
					/>
					<button
						aria-label="Resize focused preview vertically"
						className="absolute bottom-0 left-0 hidden h-3 w-[calc(100%-3rem)] cursor-ns-resize bg-transparent md:block"
						onPointerDown={handleResizePointerDown("y")}
						type="button"
					/>
					<button
						aria-label="Resize focused preview"
						className="absolute bottom-0 right-0 h-6 w-6 cursor-nwse-resize bg-transparent"
						onPointerDown={handleResizePointerDown("xy")}
						type="button"
					>
						<span className="absolute bottom-1 right-1 h-3 w-3 border-b-2 border-r-2 border-border-default/80" />
					</button>
				</div>
			</div>
			{/* Caption dock: pinned to the bottom of the popup overlay,
			    centered horizontally. Independent of the image card —
			    rotating or dragging the image never moves it. */}
			<div
				className="pointer-events-auto absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-border-subtle/70 bg-bg-overlay/70 px-5 py-3 shadow-[var(--shadow-popover)] backdrop-blur-md"
				style={{
					width: `${previewBaseSize.captionWidth}px`,
					maxWidth: "calc(100vw - 96px)",
				}}
			>
				{summary ? (
					<p className="flex-1 text-sm leading-6 text-text-primary/90">{summary}</p>
				) : (
					<span className="flex-1" />
				)}
				<button
					aria-label="Rotate preview"
					className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200/80 bg-white/96 text-slate-900 shadow-[0_4px_10px_rgba(15,23,42,0.12)] transition-transform hover:scale-110"
					onClick={(e) => {
						e.stopPropagation()
						setRotation((value) => (value + 90) % 360)
					}}
					type="button"
				>
					<RotateCw aria-hidden="true" size={18} strokeWidth={2.4} />
				</button>
			</div>
		</div>
	)
}
