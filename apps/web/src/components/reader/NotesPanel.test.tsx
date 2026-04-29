import { useState } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Note } from "@/api/hooks/notes"

const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect

vi.mock("@/components/notes/NoteEditor", () => ({
	NoteEditor: (props: {
		noteId: string
		beforeEditorContent?: React.ReactNode
		onOpenCitationBlock?: (paperId: string, blockId: string) => void
	}) => (
		<div>
			{props.beforeEditorContent}
			<div>{`Editor for ${props.noteId}`}</div>
			<button onClick={() => props.onOpenCitationBlock?.("paper-1", "block-9")} type="button">
				Open citation block
			</button>
		</div>
	),
}))

async function importNotesPanel() {
	const mod = await import("./NotesPanel")
	return mod.NotesPanel
}

function makeNote(overrides: Partial<Note>): Note {
	return {
		id: overrides.id ?? "note-1",
		workspaceId: "workspace-1",
		ownerUserId: "user-1",
		paperId: "paper-1",
		title: overrides.title ?? "Untitled",
		currentVersion: 1,
		anchorPage: overrides.anchorPage ?? 1,
		anchorYRatio: overrides.anchorYRatio ?? 0.5,
		anchorKind: overrides.anchorKind ?? null,
		anchorBlockId: overrides.anchorBlockId ?? null,
		anchorAnnotationId: overrides.anchorAnnotationId ?? null,
		createdAt: overrides.createdAt ?? "2026-04-27T00:00:00.000Z",
		updatedAt: overrides.updatedAt ?? "2026-04-27T00:00:00.000Z",
	}
}

beforeEach(() => {
	window.localStorage.removeItem("paperWorkspace.notesSidebarCollapsed")
	Object.defineProperty(HTMLElement.prototype, "clientHeight", {
		configurable: true,
		get() {
			return 400
		},
	})
	Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
		configurable: true,
		get() {
			return 1200
		},
	})
	Object.defineProperty(HTMLElement.prototype, "scrollTop", {
		configurable: true,
		get() {
			return 100
		},
	})
})

afterEach(() => {
	HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect
	delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
	delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight
	delete (HTMLElement.prototype as { scrollTop?: number }).scrollTop
})

describe("NotesPanel", () => {
	it("positions each dot at its anchor's normalized rail position", async () => {
		// Rail is now a fixed-length progress bar, not a scroll container.
		// Each dot lands at `((page - 1) + yRatio) / numPages` of the rail's
		// height. With numPages=4: page 2 + yRatio 0.15 = 0.2875 → 28.75%;
		// page 2 + yRatio 0.78 = 0.445 → 44.5%.
		const notes = [
			makeNote({ id: "note-top", title: "Near Top", anchorPage: 2, anchorYRatio: 0.15 }),
			makeNote({ id: "note-bottom", title: "Near Bottom", anchorPage: 2, anchorYRatio: 0.78 }),
		]

		const NotesPanel = await importNotesPanel()
		const { container } = render(
			<NotesPanel
				activeCitingNoteIds={new Set()}
				currentAnchorYRatio={0.8}
				currentPage={2}
				expandedNoteId={null}
				notes={notes}
				numPages={4}
				onCreateAtCurrent={() => {}}
				onExpand={() => {}}
				onJumpToPage={() => {}}
			/>,
		)

		const top = container.querySelector('[data-note-id="note-top"]') as HTMLElement | null
		const bottom = container.querySelector('[data-note-id="note-bottom"]') as HTMLElement | null
		// Subtracts DOT_RADIUS (8px) so the dot's center sits exactly on
		// the rail line at the normalized top position.
		expect(top?.style.top).toBe("calc(28.75% - 8px)")
		expect(bottom?.style.top).toBe("calc(44.5% - 8px)")
	})

	it("groups notes from the same block into one rail dot and lets the user switch between them", async () => {
		const notes = [
			makeNote({
				id: "note-older",
				title: "Older note",
				anchorPage: 3,
				anchorYRatio: 0.18,
				anchorKind: "block",
				anchorBlockId: "block-1",
				updatedAt: "2026-04-27T00:00:00.000Z",
			}),
			makeNote({
				id: "note-newer",
				title: "Newer note",
				anchorPage: 3,
				anchorYRatio: 0.82,
				anchorKind: "block",
				anchorBlockId: "block-1",
				updatedAt: "2026-04-28T00:00:00.000Z",
			}),
		]

		const NotesPanel = await importNotesPanel()
		function Harness() {
			const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null)
			return (
				<NotesPanel
					activeCitingNoteIds={new Set()}
					blockAnchorsById={new Map([["block-1", { page: 3, yRatio: 0.42 }]])}
					blockNumberByBlockId={new Map([["block-1", 7]])}
					currentAnchorYRatio={0.5}
					currentPage={3}
					expandedNoteId={expandedNoteId}
					notes={notes}
					numPages={5}
					onCreateAtCurrent={() => {}}
					onExpand={setExpandedNoteId}
					onJumpToPage={() => {}}
				/>
			)
		}
		const { container } = render(<Harness />)

		const dots = container.querySelectorAll('[data-note-group-key="block:block-1"]')
		expect(dots).toHaveLength(1)
		expect((dots[0] as HTMLElement).style.top).toContain("48.4")

		fireEvent.click(dots[0] as HTMLButtonElement)
		expect(screen.getByText("Editor for note-older")).toBeInTheDocument()
		await new Promise<void>((resolve) => {
			window.requestAnimationFrame(() => resolve())
		})

		fireEvent.click(screen.getByRole("button", { name: "block 7 note 2" }))
		expect(screen.getByText("Editor for note-newer")).toBeInTheDocument()
		const expandedSlip = document.querySelector('[data-expanded-slip-id="note-newer"]') as
			| HTMLElement
			| null
		expect(expandedSlip).not.toBeNull()
		expect(expandedSlip?.style.opacity).toBe("1")
	})

	it("shows highlight ordinals in the grouped note list when one block has multiple highlights", async () => {
		const notes = [
			makeNote({
				id: "note-h1",
				title: "First highlight note",
				anchorPage: 3,
				anchorYRatio: 0.63,
				anchorKind: "highlight",
				anchorBlockId: "block-45",
				anchorAnnotationId: "annotation-1",
			}),
			makeNote({
				id: "note-h2",
				title: "Second highlight note",
				anchorPage: 3,
				anchorYRatio: 0.66,
				anchorKind: "highlight",
				anchorBlockId: "block-45",
				anchorAnnotationId: "annotation-2",
			}),
		]

		const NotesPanel = await importNotesPanel()
		render(
			<NotesPanel
				activeCitingNoteIds={new Set()}
				annotationOrdinalById={
					new Map([
						["annotation-1", 1],
						["annotation-2", 2],
					])
				}
				blockAnchorsById={new Map([["block-45", { page: 3, yRatio: 0.64 }]])}
				blockNumberByBlockId={new Map([["block-45", 45]])}
				currentAnchorYRatio={0.5}
				currentPage={3}
				expandedNoteId="note-h1"
				notes={notes}
				numPages={5}
				onCreateAtCurrent={() => {}}
				onExpand={() => {}}
				onJumpToPage={() => {}}
			/>,
		)

		expect(screen.getByRole("button", { name: "highlight 1 p. 3 blk. 45" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "highlight 2 p. 3 blk. 45" })).toBeInTheDocument()
	})

	it("spreads nearby block dots so dense anchors do not collapse into one visual cluster", async () => {
		const notes = [
			makeNote({
				id: "note-a",
				anchorPage: 1,
				anchorYRatio: 0.2,
				anchorKind: "block",
				anchorBlockId: "block-a",
			}),
			makeNote({
				id: "note-b",
				anchorPage: 1,
				anchorYRatio: 0.208,
				anchorKind: "block",
				anchorBlockId: "block-b",
			}),
			makeNote({
				id: "note-c",
				anchorPage: 1,
				anchorYRatio: 0.216,
				anchorKind: "block",
				anchorBlockId: "block-c",
			}),
		]

		const NotesPanel = await importNotesPanel()
		const { container } = render(
			<NotesPanel
				activeCitingNoteIds={new Set()}
				currentAnchorYRatio={0.3}
				currentPage={1}
				expandedNoteId={null}
				notes={notes}
				numPages={1}
				onCreateAtCurrent={() => {}}
				onExpand={() => {}}
				onJumpToPage={() => {}}
			/>,
		)

		const dotA = container.querySelector('[data-note-id="note-a"]') as HTMLElement | null
		const dotB = container.querySelector('[data-note-id="note-b"]') as HTMLElement | null
		const dotC = container.querySelector('[data-note-id="note-c"]') as HTMLElement | null

		expect(dotA?.style.top).not.toBe(dotB?.style.top)
		expect(dotB?.style.top).not.toBe(dotC?.style.top)
		expect(dotA?.style.right).not.toBe("")
	})

	it("magnifies notes near the live PDF viewport and compresses distant ones into a minimap", async () => {
		const notes = [
			makeNote({
				id: "note-near-top",
				title: "Near viewport",
				anchorPage: 2,
				anchorYRatio: 0.4,
			}),
			makeNote({
				id: "note-near-bottom",
				title: "Just below viewport",
				anchorPage: 2,
				anchorYRatio: 0.6,
			}),
			makeNote({
				id: "note-far",
				title: "Far away",
				anchorPage: 5,
				anchorYRatio: 0.7,
			}),
		]

		const NotesPanel = await importNotesPanel()
		const { container } = render(
			<NotesPanel
				activeCitingNoteIds={new Set()}
				currentAnchorYRatio={0.5}
				currentPage={2}
				expandedNoteId={null}
				notes={notes}
				numPages={6}
				onCreateAtCurrent={() => {}}
				onExpand={() => {}}
				onJumpToPage={() => {}}
				pdfRailLayout={{
					pageMetrics: new Map([
						[1, { top: 0, height: 200 }],
						[2, { top: 220, height: 240 }],
						[3, { top: 500, height: 220 }],
						[4, { top: 760, height: 220 }],
						[5, { top: 1020, height: 260 }],
						[6, { top: 1320, height: 220 }],
					]),
					scrollHeight: 1600,
					scrollTop: 220,
					viewportHeight: 280,
					viewportAnchorTop: 360,
				}}
			/>,
		)

		const nearTop = container.querySelector('[data-note-id="note-near-top"]') as HTMLElement | null
		const nearBottom = container.querySelector(
			'[data-note-id="note-near-bottom"]',
		) as HTMLElement | null
		const far = container.querySelector('[data-note-id="note-far"]') as HTMLElement | null

		expect(Number(nearTop?.dataset.minimapScale)).toBeGreaterThan(Number(far?.dataset.minimapScale))
		expect(Number(nearBottom?.dataset.minimapScale)).toBeGreaterThan(Number(far?.dataset.minimapScale))
		expect(Number(nearBottom?.dataset.railTop) - Number(nearTop?.dataset.railTop)).toBeGreaterThan(6)
	})

	it("surfaces nearby notes in the slip lane while keeping far notes on the rail only", async () => {
		const notes = [
			makeNote({
				id: "note-near",
				title: "Viewport note",
				anchorPage: 2,
				anchorYRatio: 0.48,
			}),
			makeNote({
				id: "note-far",
				title: "Far note",
				anchorPage: 6,
				anchorYRatio: 0.82,
			}),
		]

		const NotesPanel = await importNotesPanel()
		const { container } = render(
			<NotesPanel
				activeCitingNoteIds={new Set()}
				blockNumberByBlockId={new Map([["block-near", 12]])}
				colorByBlock={new Map([["block-near", "#f4c84f"]])}
				currentAnchorYRatio={0.5}
				currentPage={2}
				expandedNoteId={null}
				notes={[
					{ ...notes[0], anchorKind: "block", anchorBlockId: "block-near" },
					notes[1],
				]}
				numPages={6}
				onCreateAtCurrent={() => {}}
				onExpand={() => {}}
				onJumpToPage={() => {}}
				pdfRailLayout={{
					pageMetrics: new Map([
						[1, { top: 0, height: 200 }],
						[2, { top: 220, height: 240 }],
						[3, { top: 500, height: 220 }],
						[4, { top: 760, height: 220 }],
						[5, { top: 1020, height: 260 }],
						[6, { top: 1320, height: 220 }],
					]),
					scrollHeight: 1600,
					scrollTop: 220,
					viewportHeight: 280,
					viewportAnchorTop: 360,
				}}
			/>,
		)

		expect(container.querySelector('[data-slip-group-key="block:block-near"]')).not.toBeNull()
		expect(container.querySelector('[data-slip-group-key="note:note-far"]')).toBeNull()
		expect(container.querySelector('[data-note-id="note-far"]')).not.toBeNull()
		expect(screen.getAllByText("block 12").length).toBeGreaterThan(0)
		expect(screen.queryByText(/Situated response is the keyword/i)).not.toBeInTheDocument()
	})

	it("clamps folded slips inside the lane when a note anchor sits near the top edge", async () => {
		const NotesPanel = await importNotesPanel()
		const { container } = render(
			<NotesPanel
				activeCitingNoteIds={new Set()}
				currentAnchorYRatio={0.5}
				currentPage={1}
				expandedNoteId={null}
				notes={[
					makeNote({
						id: "note-top-edge",
						title: "Top edge note",
						anchorPage: 1,
						anchorYRatio: 0,
					}),
				]}
				numPages={3}
				onCreateAtCurrent={() => {}}
				onExpand={() => {}}
				onJumpToPage={() => {}}
				pdfRailLayout={{
					pageMetrics: new Map([
						[1, { top: 0, height: 200 }],
						[2, { top: 240, height: 220 }],
						[3, { top: 500, height: 220 }],
					]),
					scrollHeight: 900,
					scrollTop: 0,
					viewportHeight: 280,
					viewportAnchorTop: 140,
				}}
			/>,
		)

		const slip = container.querySelector('[data-slip-group-key="note:note-top-edge"]') as HTMLElement | null
		expect(slip).not.toBeNull()
		expect(slip?.style.top).toBe("8px")
		expect(Number(slip?.style.opacity)).toBeLessThan(1)
	})

	it("fades folded slips near the lower lane edge too, so the effect stays symmetric", async () => {
		const NotesPanel = await importNotesPanel()
		const { container } = render(
			<NotesPanel
				activeCitingNoteIds={new Set()}
				currentAnchorYRatio={0.5}
				currentPage={3}
				expandedNoteId={null}
				notes={[
					makeNote({
						id: "note-bottom-edge",
						title: "Bottom edge note",
						anchorPage: 3,
						anchorYRatio: 1,
					}),
				]}
				numPages={3}
				onCreateAtCurrent={() => {}}
				onExpand={() => {}}
				onJumpToPage={() => {}}
				pdfRailLayout={{
					pageMetrics: new Map([
						[1, { top: 0, height: 200 }],
						[2, { top: 240, height: 220 }],
						[3, { top: 500, height: 220 }],
					]),
					scrollHeight: 900,
					scrollTop: 260,
					viewportHeight: 280,
					viewportAnchorTop: 400,
				}}
			/>,
		)

		const slip = container.querySelector(
			'[data-slip-group-key="note:note-bottom-edge"]',
		) as HTMLElement | null
		expect(slip).not.toBeNull()
		expect(Number(slip?.style.opacity)).toBeLessThan(1)
	})

	it("can collapse the sidebar and re-expand it from a rail dot click", async () => {
		const NotesPanel = await importNotesPanel()
		function Harness() {
			const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null)
			const [collapsed, setCollapsed] = useState(false)
			return (
				<>
					<button onClick={() => setCollapsed((value) => !value)} type="button">
						Toggle notes sidebar
					</button>
					<NotesPanel
						activeCitingNoteIds={new Set()}
						currentAnchorYRatio={0.5}
						currentPage={2}
						expandedNoteId={expandedNoteId}
						isSidebarCollapsed={collapsed}
						notes={[makeNote({ id: "note-1", title: "Viewport note", anchorPage: 2, anchorYRatio: 0.48 })]}
						numPages={4}
						onCreateAtCurrent={() => {}}
						onExpand={setExpandedNoteId}
						onJumpToPage={() => {}}
						onRequestExpandSidebar={() => setCollapsed(false)}
						pdfRailLayout={{
							pageMetrics: new Map([
								[1, { top: 0, height: 200 }],
								[2, { top: 220, height: 240 }],
								[3, { top: 500, height: 220 }],
								[4, { top: 760, height: 220 }],
							]),
							scrollHeight: 1100,
							scrollTop: 220,
							viewportHeight: 280,
							viewportAnchorTop: 360,
						}}
					/>
				</>
			)
		}

		const { container } = render(<Harness />)
		expect(container.querySelector('[data-slip-group-key="note:note-1"]')).not.toBeNull()

		fireEvent.click(screen.getByRole("button", { name: "Toggle notes sidebar" }))
		expect(container.querySelector('[data-sidebar-collapsed="true"]')).not.toBeNull()
		expect(container.querySelector('[data-slip-group-key="note:note-1"]')).toBeNull()

		fireEvent.click(container.querySelector('[data-note-id="note-1"]') as HTMLButtonElement)
		expect(container.querySelector('[data-sidebar-collapsed="false"]')).not.toBeNull()
	})

	it("surfaces a visual cue for notes citing the selected block", async () => {
		const notes = [
			makeNote({ id: "note-linked", title: "Linked note" }),
			makeNote({ id: "note-other", title: "Other note" }),
		]

		const NotesPanel = await importNotesPanel()
		const { getByText, queryByText } = render(
			<NotesPanel
				activeCitingNoteIds={new Set(["note-linked"])}
				currentAnchorYRatio={0.5}
				currentPage={1}
				expandedNoteId={null}
				notes={notes}
				onCreateAtCurrent={() => {}}
				onExpand={() => {}}
				onJumpToPage={() => {}}
			/>,
		)

		expect(getByText("Linked")).toBeInTheDocument()
		expect(queryByText("1 note cites the selected block")).not.toBeInTheDocument()
		expect(queryByText("2 notes cite the selected block")).not.toBeInTheDocument()
	})

	it("does not auto-follow while a cite chip jump from the note is in flight", async () => {
		const notes = [
			makeNote({ id: "note-1", title: "Focused note", anchorPage: 1, anchorYRatio: 0.2 }),
		]
		const scrollTo = vi.fn()
		const onOpenCitationBlock = vi.fn()
		Object.defineProperty(HTMLElement.prototype, "scrollTo", {
			configurable: true,
			value: scrollTo,
		})
		HTMLElement.prototype.getBoundingClientRect = function () {
			const text = this.textContent ?? ""
			if (this.className.includes("overflow-y-auto")) {
				return {
					top: 0,
					bottom: 400,
					height: 400,
					left: 0,
					right: 320,
					width: 320,
					x: 0,
					y: 0,
					toJSON() {},
				}
			}
			if (text.includes("Focused note")) {
				return {
					top: 40,
					bottom: 100,
					height: 60,
					left: 0,
					right: 320,
					width: 320,
					x: 0,
					y: 40,
					toJSON() {},
				}
			}
			if (text.includes("Page 2")) {
				return {
					top: 16,
					bottom: 40,
					height: 24,
					left: 0,
					right: 100,
					width: 100,
					x: 0,
					y: 16,
					toJSON() {},
				}
			}
			return {
				top: 0,
				bottom: 0,
				height: 0,
				left: 0,
				right: 0,
				width: 0,
				x: 0,
				y: 0,
				toJSON() {},
			}
		}

		const NotesPanel = await importNotesPanel()
		const { rerender } = render(
			<NotesPanel
				activeCitingNoteIds={new Set()}
				currentAnchorYRatio={0.2}
				currentPage={1}
				expandedNoteId="note-1"
				notes={notes}
				onCreateAtCurrent={() => {}}
				onExpand={() => {}}
				onJumpToPage={() => {}}
				onOpenCitationBlock={onOpenCitationBlock}
			/>,
		)

		scrollTo.mockClear()
		fireEvent.click(screen.getByRole("button", { name: "Open citation block" }))
		expect(onOpenCitationBlock).toHaveBeenCalledWith("paper-1", "block-9")

		rerender(
			<NotesPanel
				activeCitingNoteIds={new Set()}
				currentAnchorYRatio={0.65}
				currentPage={2}
				expandedNoteId="note-1"
				notes={notes}
				onCreateAtCurrent={() => {}}
				onExpand={() => {}}
				onJumpToPage={() => {}}
				onOpenCitationBlock={onOpenCitationBlock}
			/>,
		)

		expect(scrollTo).not.toHaveBeenCalled()
	})

	it("jumps back through the annotation source when the header source label is clicked", async () => {
		const note = makeNote({
			id: "note-1",
			title: "",
			anchorPage: 3,
			anchorYRatio: 0.38,
			anchorKind: "highlight",
			anchorBlockId: "block-5",
			anchorAnnotationId: "annotation-9",
		})
		const onOpenCitationAnnotation = vi.fn()

		const NotesPanel = await importNotesPanel()
		render(
			<NotesPanel
				activeCitingNoteIds={new Set()}
				blockNumberByBlockId={new Map([["block-5", 5]])}
				currentAnchorYRatio={0.2}
				currentPage={1}
				expandedNoteId="note-1"
				notes={[note]}
				onCreateAtCurrent={() => {}}
				onExpand={() => {}}
				onJumpToPage={() => {}}
				onOpenCitationAnnotation={onOpenCitationAnnotation}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: "Jump to note anchor" }))
		expect(onOpenCitationAnnotation).toHaveBeenCalledWith(
			"paper-1",
			"annotation-9",
			3,
			0.38,
		)
	})

	it("shrinks the expanded slip to fit narrow viewports instead of forcing the old desktop minimum", async () => {
		const originalInnerWidth = window.innerWidth
		const originalInnerHeight = window.innerHeight
		Object.defineProperty(window, "innerWidth", {
			configurable: true,
			value: 320,
		})
		Object.defineProperty(window, "innerHeight", {
			configurable: true,
			value: 560,
		})

		const NotesPanel = await importNotesPanel()
		render(
			<NotesPanel
				activeCitingNoteIds={new Set()}
				currentAnchorYRatio={0.38}
				currentPage={3}
				expandedNoteId="note-1"
				notes={[
					makeNote({
						id: "note-1",
						title: "Narrow viewport note",
						anchorPage: 3,
						anchorYRatio: 0.38,
					}),
				]}
				onCreateAtCurrent={() => {}}
				onExpand={() => {}}
				onJumpToPage={() => {}}
			/>,
		)

		expect(screen.getByText("Editor for note-1")).toBeInTheDocument()
		const expandedSlip = document.querySelector('[data-expanded-slip-id="note-1"]')
		expect(expandedSlip).not.toBeNull()
		expect((expandedSlip as HTMLElement).style.width).toBe("248px")

		Object.defineProperty(window, "innerWidth", {
			configurable: true,
			value: originalInnerWidth,
		})
		Object.defineProperty(window, "innerHeight", {
			configurable: true,
			value: originalInnerHeight,
		})
	})

	it("does not auto-follow to another page while a note is expanded", async () => {
		const notes = [
			makeNote({ id: "note-1", title: "Page 2 note", anchorPage: 2, anchorYRatio: 0.2 }),
			makeNote({ id: "note-2", title: "Page 1 note", anchorPage: 1, anchorYRatio: 0.4 }),
		]
		const scrollTo = vi.fn()
		Object.defineProperty(HTMLElement.prototype, "scrollTo", {
			configurable: true,
			value: scrollTo,
		})
		HTMLElement.prototype.getBoundingClientRect = function () {
			const text = this.textContent ?? ""
			if (this.className.includes("overflow-y-auto")) {
				return {
					top: 0,
					bottom: 400,
					height: 400,
					left: 0,
					right: 320,
					width: 320,
					x: 0,
					y: 0,
					toJSON() {},
				}
			}
			if (text.includes("Page 1")) {
				return {
					top: 16,
					bottom: 40,
					height: 24,
					left: 0,
					right: 100,
					width: 100,
					x: 0,
					y: 16,
					toJSON() {},
				}
			}
			if (text.includes("Page 2")) {
				return {
					top: 200,
					bottom: 224,
					height: 24,
					left: 0,
					right: 100,
					width: 100,
					x: 0,
					y: 200,
					toJSON() {},
				}
			}
			return {
				top: 0,
				bottom: 0,
				height: 0,
				left: 0,
				right: 0,
				width: 0,
				x: 0,
				y: 0,
				toJSON() {},
			}
		}

		const NotesPanel = await importNotesPanel()
		render(
			<NotesPanel
				activeCitingNoteIds={new Set()}
				currentAnchorYRatio={0.4}
				currentPage={1}
				expandedNoteId="note-1"
				notes={notes}
				onCreateAtCurrent={() => {}}
				onExpand={() => {}}
				onJumpToPage={() => {}}
			/>,
		)

		expect(scrollTo).not.toHaveBeenCalled()
	})

	it("honors an external follow lock during a cross-pane jump", async () => {
		const notes = [
			makeNote({ id: "note-1", title: "Page 1 note", anchorPage: 1, anchorYRatio: 0.4 }),
		]
		const scrollTo = vi.fn()
		Object.defineProperty(HTMLElement.prototype, "scrollTo", {
			configurable: true,
			value: scrollTo,
		})
		HTMLElement.prototype.getBoundingClientRect = function () {
			const text = this.textContent ?? ""
			if (this.className.includes("overflow-y-auto")) {
				return {
					top: 0,
					bottom: 400,
					height: 400,
					left: 0,
					right: 320,
					width: 320,
					x: 0,
					y: 0,
					toJSON() {},
				}
			}
			if (text.includes("Page 2")) {
				return {
					top: 16,
					bottom: 40,
					height: 24,
					left: 0,
					right: 100,
					width: 100,
					x: 0,
					y: 16,
					toJSON() {},
				}
			}
			return {
				top: 0,
				bottom: 0,
				height: 0,
				left: 0,
				right: 0,
				width: 0,
				x: 0,
				y: 0,
				toJSON() {},
			}
		}

		const NotesPanel = await importNotesPanel()
		render(
			<NotesPanel
				activeCitingNoteIds={new Set()}
				currentAnchorYRatio={0.65}
				currentPage={2}
				externalFollowLockUntil={Date.now() + 1000}
				expandedNoteId={null}
				notes={notes}
				onCreateAtCurrent={() => {}}
				onExpand={() => {}}
				onJumpToPage={() => {}}
			/>,
		)

		expect(scrollTo).not.toHaveBeenCalled()
	})
})
