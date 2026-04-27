import { useCallback, useEffect, useRef, useState } from "react"
import { NoteEditor, type NoteEditorRef } from "@/components/notes/NoteEditor"

const STORAGE_KEY = "paperWorkspace.floatingNote"
const DEFAULT_WIDTH = 480
const DEFAULT_HEIGHT = 480
const MIN_WIDTH = 320
const MIN_HEIGHT = 240
const MARGIN = 16

interface FloatingState {
	x: number
	y: number
	w: number
	h: number
}

function loadState(viewportW: number, viewportH: number): FloatingState {
	if (typeof window !== "undefined") {
		const raw = window.localStorage.getItem(STORAGE_KEY)
		if (raw) {
			try {
				const s = JSON.parse(raw) as Partial<FloatingState>
				if (
					typeof s.x === "number" &&
					typeof s.y === "number" &&
					typeof s.w === "number" &&
					typeof s.h === "number"
				) {
					return clampToViewport(s as FloatingState, viewportW, viewportH)
				}
			} catch {
				// fall through to defaults
			}
		}
	}
	return clampToViewport(
		{
			x: viewportW - DEFAULT_WIDTH - MARGIN,
			y: viewportH - DEFAULT_HEIGHT - MARGIN,
			w: DEFAULT_WIDTH,
			h: DEFAULT_HEIGHT,
		},
		viewportW,
		viewportH,
	)
}

function clampToViewport(s: FloatingState, vw: number, vh: number): FloatingState {
	const w = Math.min(Math.max(MIN_WIDTH, s.w), Math.max(MIN_WIDTH, vw - 2 * MARGIN))
	const h = Math.min(Math.max(MIN_HEIGHT, s.h), Math.max(MIN_HEIGHT, vh - 2 * MARGIN))
	const x = Math.min(Math.max(MARGIN, s.x), Math.max(MARGIN, vw - w - MARGIN))
	const y = Math.min(Math.max(MARGIN, s.y), Math.max(MARGIN, vh - h - MARGIN))
	return { x, y, w, h }
}

interface Props {
	noteId: string
	onClose: () => void
	onEditorReady?: (editor: NoteEditorRef) => void
}

// Floating, viewport-anchored note window. Drag the header to move, drag the
// bottom-right corner to resize. Position + size persist in localStorage so
// the user's layout choice survives reloads. The window is rendered as a
// sibling of PaperWorkspace via fixed positioning, so it floats over both
// the PDF and the parsed-blocks pane regardless of their split.
export function FloatingNote({ noteId, onClose, onEditorReady }: Props) {
	const [state, setState] = useState<FloatingState>(() => {
		if (typeof window === "undefined") {
			return { x: 32, y: 32, w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT }
		}
		return loadState(window.innerWidth, window.innerHeight)
	})
	const stateRef = useRef(state)
	stateRef.current = state
	const dragRef = useRef<{
		mode: "move" | "resize"
		startX: number
		startY: number
		startState: FloatingState
	} | null>(null)
	const [interacting, setInteracting] = useState(false)

	// Re-clamp on viewport resize so the window doesn't get stranded off-screen.
	useEffect(() => {
		const onResize = () => {
			setState((s) => clampToViewport(s, window.innerWidth, window.innerHeight))
		}
		window.addEventListener("resize", onResize)
		return () => window.removeEventListener("resize", onResize)
	}, [])

	// Persist on every committed state change. We could debounce, but
	// localStorage writes are cheap and rarely hot here.
	useEffect(() => {
		if (typeof window === "undefined") return
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
	}, [state])

	const onDragHeaderDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
		if (e.button !== 0) return
		;(e.target as HTMLElement).setPointerCapture(e.pointerId)
		dragRef.current = {
			mode: "move",
			startX: e.clientX,
			startY: e.clientY,
			startState: stateRef.current,
		}
		setInteracting(true)
	}, [])

	const onResizeCornerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
		if (e.button !== 0) return
		e.stopPropagation()
		;(e.target as HTMLElement).setPointerCapture(e.pointerId)
		dragRef.current = {
			mode: "resize",
			startX: e.clientX,
			startY: e.clientY,
			startState: stateRef.current,
		}
		setInteracting(true)
	}, [])

	const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
		const d = dragRef.current
		if (!d) return
		const dx = e.clientX - d.startX
		const dy = e.clientY - d.startY
		const vw = window.innerWidth
		const vh = window.innerHeight
		if (d.mode === "move") {
			setState(
				clampToViewport(
					{
						x: d.startState.x + dx,
						y: d.startState.y + dy,
						w: d.startState.w,
						h: d.startState.h,
					},
					vw,
					vh,
				),
			)
		} else {
			setState(
				clampToViewport(
					{
						x: d.startState.x,
						y: d.startState.y,
						w: d.startState.w + dx,
						h: d.startState.h + dy,
					},
					vw,
					vh,
				),
			)
		}
	}, [])

	const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
		if (!dragRef.current) return
		;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
		dragRef.current = null
		setInteracting(false)
	}, [])

	useEffect(() => {
		if (!interacting) return
		const prev = document.body.style.cursor
		document.body.style.cursor = dragRef.current?.mode === "resize" ? "nwse-resize" : "grabbing"
		return () => {
			document.body.style.cursor = prev
		}
	}, [interacting])

	return (
		<div
			className="fixed z-40 flex flex-col overflow-hidden rounded-lg border border-border-default bg-bg-primary shadow-[var(--shadow-popover)]"
			style={{ left: state.x, top: state.y, width: state.w, height: state.h }}
		>
			{/* Drag handle: title bar */}
			<div
				className="flex cursor-grab items-center justify-between gap-2 border-b border-border-subtle bg-bg-secondary px-3 py-2 text-sm select-none active:cursor-grabbing"
				onPointerDown={onDragHeaderDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
			>
				<div className="flex items-center gap-2 text-text-secondary">
					<span className="text-xs uppercase tracking-[0.16em]">Note</span>
				</div>
				<button
					aria-label="Close note"
					className="h-6 w-6 rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
					onClick={onClose}
					onPointerDown={(e) => e.stopPropagation()}
					type="button"
				>
					×
				</button>
			</div>
			<div className="min-h-0 flex-1 overflow-hidden">
				<NoteEditor noteId={noteId} onEditorReady={onEditorReady} />
			</div>
			{/* biome-ignore lint/a11y/useSemanticElements: native <hr> can't host pointer handlers; this is a draggable resize grip */}
			<div
				aria-label="Resize note window"
				aria-orientation="horizontal"
				aria-valuenow={state.w}
				className="absolute right-0 bottom-0 h-4 w-4 cursor-nwse-resize"
				onPointerDown={onResizeCornerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				role="separator"
				tabIndex={0}
			>
				<div className="absolute right-1 bottom-1 h-2 w-2 border-b-2 border-r-2 border-border-default" />
			</div>
		</div>
	)
}
