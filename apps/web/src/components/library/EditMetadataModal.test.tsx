import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import type { Paper } from "@/api/hooks/papers"
import { EditMetadataModal } from "./EditMetadataModal"

function makePaper(overrides: Partial<Paper> = {}): Paper {
	return {
		id: "paper-1",
		title: "Original Title",
		authors: ["Alice Smith"],
		year: 2024,
		doi: null,
		arxivId: null,
		venue: "ICLR",
		displayFilename: "Smith-2024-Original-Title.pdf",
		fileSizeBytes: 10,
		parseStatus: "done",
		parseError: null,
		parseProgressExtracted: null,
		parseProgressTotal: null,
		summary: null,
		summaryStatus: "pending",
		summaryError: null,
		enrichmentStatus: "enriched",
		enrichmentSource: "crossref",
		metadataEditedByUser: {},
		createdAt: "2026-04-28T00:00:00Z",
		updatedAt: "2026-04-28T00:00:00Z",
		...overrides,
	}
}

describe("EditMetadataModal", () => {
	it("parses edited fields into a patch payload", async () => {
		const user = userEvent.setup()
		const onSubmit = vi.fn()

		render(
			<EditMetadataModal
				errorMessage={null}
				fetchErrorMessage={null}
				isFetchingMetadata={false}
				isSaving={false}
				onClose={vi.fn()}
				onFetchMetadata={vi.fn()}
				onSubmit={onSubmit}
				open
				paper={makePaper()}
			/>,
		)

		await user.clear(screen.getByLabelText("Title"))
		await user.type(screen.getByLabelText("Title"), "New Title")
		await user.clear(screen.getByLabelText("Authors"))
		await user.type(screen.getByLabelText("Authors"), "Ada Lovelace\nGrace Hopper")
		await user.clear(screen.getByLabelText("Year"))
		await user.type(screen.getByLabelText("Year"), "2025")
		await user.click(screen.getByRole("button", { name: "Save metadata" }))

		expect(onSubmit).toHaveBeenCalledWith({
			title: "New Title",
			authors: ["Ada Lovelace", "Grace Hopper"],
			year: 2025,
		})
	})

	it("does not reset form edits when parsing progress refreshes the same paper", async () => {
		const user = userEvent.setup()
		const { rerender } = render(
			<EditMetadataModal
				errorMessage={null}
				fetchErrorMessage={null}
				isFetchingMetadata={false}
				isSaving={false}
				onClose={vi.fn()}
				onFetchMetadata={vi.fn()}
				onSubmit={vi.fn()}
				open
				paper={makePaper({ parseStatus: "parsing", parseProgressExtracted: 1, parseProgressTotal: 8 })}
			/>,
		)

		await user.clear(screen.getByLabelText("Title"))
		await user.type(screen.getByLabelText("Title"), "User draft title")

		rerender(
			<EditMetadataModal
				errorMessage={null}
				fetchErrorMessage={null}
				isFetchingMetadata={false}
				isSaving={false}
				onClose={vi.fn()}
				onFetchMetadata={vi.fn()}
				onSubmit={vi.fn()}
				open
				paper={makePaper({ parseStatus: "parsing", parseProgressExtracted: 2, parseProgressTotal: 8 })}
			/>,
		)

		expect(screen.getByLabelText("Title")).toHaveValue("User draft title")
	})
})
