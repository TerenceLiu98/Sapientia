import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { EditMetadataModal } from "./EditMetadataModal"

describe("EditMetadataModal", () => {
	it("parses edited fields into a patch payload", async () => {
		const user = userEvent.setup()
		const onSubmit = vi.fn()

		render(
			<EditMetadataModal
				errorMessage={null}
				isSaving={false}
				onClose={vi.fn()}
				onSubmit={onSubmit}
				open
				paper={{
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
					enrichmentStatus: "enriched",
					enrichmentSource: "crossref",
					metadataEditedByUser: {},
					createdAt: "2026-04-28T00:00:00Z",
					updatedAt: "2026-04-28T00:00:00Z",
				}}
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
})
