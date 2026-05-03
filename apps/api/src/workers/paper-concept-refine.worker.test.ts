import { beforeEach, describe, expect, it, vi } from "vitest"

const refinePaperConceptSalienceMock = vi.fn()
const refreshPaperConceptReaderSignalsMock = vi.fn()

vi.mock("../services/concept-refine", () => ({
	refinePaperConceptSalience: (...args: unknown[]) => refinePaperConceptSalienceMock(...args),
}))

vi.mock("../services/concept-description", () => ({
	refreshPaperConceptReaderSignals: (...args: unknown[]) =>
		refreshPaperConceptReaderSignalsMock(...args),
}))

vi.mock("../logger", () => ({
	logger: {
		child: () => ({
			info: vi.fn(),
			error: vi.fn(),
		}),
		error: vi.fn(),
	},
}))

vi.mock("../queues/connection", () => ({
	queueConnection: {},
}))

describe("paper concept refine worker", () => {
	beforeEach(() => {
		refinePaperConceptSalienceMock.mockReset()
		refreshPaperConceptReaderSignalsMock.mockReset()
	})

	it("refreshes reader signals without invoking source description or semantic refresh paths", async () => {
		refinePaperConceptSalienceMock.mockResolvedValue({
			paperId: "paper-1",
			workspaceId: "workspace-1",
			refinedConceptCount: 3,
		})
		refreshPaperConceptReaderSignalsMock.mockResolvedValue({
			paperId: "paper-1",
			workspaceId: "workspace-1",
			readerSignalConceptCount: 2,
		})

		const { processPaperConceptRefine } = await import("./paper-concept-refine.worker")
		const result = await processPaperConceptRefine({
			id: "job-1",
			data: {
				paperId: "paper-1",
				workspaceId: "workspace-1",
				userId: "user-1",
			},
		} as never)

		expect(refinePaperConceptSalienceMock).toHaveBeenCalledWith({
			paperId: "paper-1",
			workspaceId: "workspace-1",
			userId: "user-1",
		})
		expect(refreshPaperConceptReaderSignalsMock).toHaveBeenCalledWith({
			paperId: "paper-1",
			workspaceId: "workspace-1",
			userId: "user-1",
		})
		expect(result).toEqual({
			paperId: "paper-1",
			workspaceId: "workspace-1",
			refinedConceptCount: 3,
			readerSignalConceptCount: 2,
		})
	})
})
