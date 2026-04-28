import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Note } from "@/api/hooks/notes"

const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect

vi.mock("@/components/notes/NoteEditor", () => ({
	NoteEditor: (props: { onOpenCitationBlock?: (paperId: string, blockId: string) => void }) => (
		<div>
			Editor
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
		const bottom = container.querySelector(
			'[data-note-id="note-bottom"]',
		) as HTMLElement | null
		// Subtracts DOT_RADIUS (8px) so the dot's center sits exactly on
		// the rail line at the normalized top position.
		expect(top?.style.top).toBe("calc(28.75% - 8px)")
		expect(bottom?.style.top).toBe("calc(44.5% - 8px)")
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
