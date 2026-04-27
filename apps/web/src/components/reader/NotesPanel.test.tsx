import { render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Note } from "@/api/hooks/notes"

const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect

vi.mock("@/components/notes/NoteEditor", () => ({
	NoteEditor: () => <div>Editor</div>,
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
		anchorBlockId: overrides.anchorBlockId ?? null,
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
	it("follows the closest note anchor within the active page", async () => {
		const notes = [
			makeNote({ id: "note-top", title: "Near Top", anchorPage: 2, anchorYRatio: 0.15 }),
			makeNote({ id: "note-bottom", title: "Near Bottom", anchorPage: 2, anchorYRatio: 0.78 }),
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
			if (text.includes("Near Top")) {
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
			if (text.includes("Near Bottom")) {
				return {
					top: 240,
					bottom: 300,
					height: 60,
					left: 0,
					right: 320,
					width: 320,
					x: 0,
					y: 240,
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
				currentAnchorYRatio={0.8}
				currentPage={2}
				expandedNoteId={null}
				notes={notes}
				onCreateAtCurrent={() => {}}
				onExpand={() => {}}
				onJumpToPage={() => {}}
			/>,
		)

		await waitFor(() => {
			expect(scrollTo).toHaveBeenCalled()
		})
		expect(scrollTo).toHaveBeenLastCalledWith({ top: 332, behavior: "smooth" })
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
})
