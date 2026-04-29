import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react"
import {
	READER_ANNOTATION_COLORS,
	type ReaderAnnotationTool,
} from "@/lib/reader-annotations"

export function FloatingMarkupPalette({
	color,
	initialPos,
	onChangeColor,
	onChangeTool,
	onClose,
	tool,
}: {
	color: string
	initialPos?: { x: number; y: number }
	onChangeColor: (color: string) => void
	onChangeTool: (tool: ReaderAnnotationTool) => void
	onClose: () => void
	tool: ReaderAnnotationTool
}) {
	// Position is local to the PdfViewer's relative root. Initial position
	// now prefers the click origin that opened markup mode; user can drag
	// the palette afterward to relocate it.
	const [pos, setPos] = useState<{ x: number; y: number }>(() => initialPos ?? { x: 24, y: 16 })
	const dragRef = useRef<{ originX: number; originY: number; startX: number; startY: number } | null>(
		null,
	)

	const onPointerMove = useCallback((event: PointerEvent) => {
		const drag = dragRef.current
		if (!drag) return
		setPos({
			x: drag.originX + (event.clientX - drag.startX),
			y: drag.originY + (event.clientY - drag.startY),
		})
	}, [])

	const endDrag = useCallback(() => {
		dragRef.current = null
	}, [])

	useEffect(() => {
		if (typeof window === "undefined") return
		window.addEventListener("pointermove", onPointerMove)
		window.addEventListener("pointerup", endDrag)
		window.addEventListener("pointercancel", endDrag)
		return () => {
			window.removeEventListener("pointermove", onPointerMove)
			window.removeEventListener("pointerup", endDrag)
			window.removeEventListener("pointercancel", endDrag)
		}
	}, [endDrag, onPointerMove])

	useEffect(() => {
		if (!initialPos) return
		setPos(initialPos)
	}, [initialPos?.x, initialPos?.y])

	const onHandlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		event.preventDefault()
		dragRef.current = {
			originX: pos.x,
			originY: pos.y,
			startX: event.clientX,
			startY: event.clientY,
		}
	}

	return (
		<div
			className="absolute z-[20] flex select-none items-center gap-1 rounded-lg border border-border-subtle bg-bg-overlay/95 px-1.5 py-1 shadow-[var(--shadow-popover)] backdrop-blur"
			data-testid="floating-markup-palette"
			style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
		>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: drag handle */}
			<div
				className="flex h-7 w-5 cursor-grab items-center justify-center text-text-tertiary hover:text-text-secondary active:cursor-grabbing"
				onPointerDown={onHandlePointerDown}
				title="Drag to move"
			>
				<DragHandleIcon />
			</div>
			<div className="mx-0.5 h-4 w-px bg-border-subtle" />
			<AnnotationToolButton
				active={tool === "highlight"}
				ariaLabel="Highlight tool"
				icon={<HighlightToolIcon />}
				onClick={() => onChangeTool("highlight")}
			/>
			<AnnotationToolButton
				active={tool === "underline"}
				ariaLabel="Underline tool"
				icon={<UnderlineToolIcon />}
				onClick={() => onChangeTool("underline")}
			/>
			<AnnotationToolButton
				active={tool === "ink"}
				ariaLabel="Freehand tool"
				icon={<InkToolIcon />}
				onClick={() => onChangeTool("ink")}
			/>
			<div className="mx-1 h-4 w-px bg-border-subtle" />
			{READER_ANNOTATION_COLORS.map((entry) => (
				<button
					aria-label={`${entry.label} markup color`}
					aria-pressed={color === entry.value}
					className={`h-5 w-5 rounded-full border transition-transform hover:scale-110 ${
						color === entry.value
							? "border-text-primary ring-2 ring-accent-600/35"
							: "border-border-default"
					}`}
					key={entry.value}
					onClick={() => onChangeColor(entry.value)}
					style={{ backgroundColor: entry.value }}
					type="button"
				/>
			))}
			<div className="mx-1 h-4 w-px bg-border-subtle" />
			<button
				aria-label="Exit markup mode"
				className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover"
				onClick={onClose}
				title="Close markup palette"
				type="button"
			>
				<CloseIcon />
			</button>
		</div>
	)
}

function AnnotationToolButton({
	active,
	ariaLabel,
	icon,
	onClick,
}: {
	active: boolean
	ariaLabel: string
	icon: React.ReactNode
	onClick: () => void
}) {
	return (
		<button
			aria-label={ariaLabel}
			aria-pressed={active}
			className={`flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
				active
					? "border-accent-600 bg-accent-600 text-text-inverse"
					: "border-transparent text-text-secondary hover:bg-surface-hover"
			}`}
			onClick={onClick}
			type="button"
		>
			{icon}
		</button>
	)
}

function DragHandleIcon() {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="14"
			stroke="currentColor"
			strokeLinecap="round"
			strokeWidth="1.6"
			viewBox="0 0 24 24"
			width="14"
		>
			<circle cx="9" cy="6" r="0.6" fill="currentColor" />
			<circle cx="9" cy="12" r="0.6" fill="currentColor" />
			<circle cx="9" cy="18" r="0.6" fill="currentColor" />
			<circle cx="15" cy="6" r="0.6" fill="currentColor" />
			<circle cx="15" cy="12" r="0.6" fill="currentColor" />
			<circle cx="15" cy="18" r="0.6" fill="currentColor" />
		</svg>
	)
}

function CloseIcon() {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="14"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.7"
			viewBox="0 0 24 24"
			width="14"
		>
			<path d="m6 6 12 12M18 6 6 18" />
		</svg>
	)
}

function HighlightToolIcon() {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="14"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.7"
			viewBox="0 0 24 24"
			width="14"
		>
			<path d="m6 15 5-5 4 4-5 5H6v-4Z" />
			<path d="M14 7 17 10" />
			<path d="M4 20h16" />
		</svg>
	)
}

function UnderlineToolIcon() {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="14"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.7"
			viewBox="0 0 24 24"
			width="14"
		>
			<path d="M7 5v6a5 5 0 0 0 10 0V5" />
			<path d="M5 20h14" />
		</svg>
	)
}

function InkToolIcon() {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="14"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.7"
			viewBox="0 0 24 24"
			width="14"
		>
			<path d="M3 14c3-4 5-4 8 0s5 4 10-2" />
			<path d="M3 19c2-2 4-2 6 0" />
		</svg>
	)
}
