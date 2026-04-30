import { beforeEach, describe, expect, it, vi } from "vitest"

const selectMock = vi.fn()

vi.mock("../db", () => ({
	db: {
		select: (...args: Array<unknown>) => selectMock(...args),
	},
}))

describe("agent context builder", () => {
	beforeEach(() => {
		selectMock.mockReset()
	})

	it("assembles layer 1 + layer 2 context from a paper fixture", async () => {
		const paper = {
			id: "paper-1",
			title: "A Paper",
			authors: ["Ada Lovelace", "Grace Hopper"],
			summary: "This paper argues that grounded summaries matter.",
		}
		const blocks = [
			{
				paperId: "paper-1",
				blockId: "blk-prev",
				blockIndex: 0,
				type: "text",
				text: "Previous block context",
				caption: null,
				headingLevel: null,
			},
			{
				paperId: "paper-1",
				blockId: "blk-focus",
				blockIndex: 1,
				type: "text",
				text: "Focused block about the method.",
				caption: null,
				headingLevel: null,
			},
			{
				paperId: "paper-1",
				blockId: "blk-next",
				blockIndex: 2,
				type: "text",
				text: "Next block with results.",
				caption: null,
				headingLevel: null,
			},
		]
		const highlights = [{ blockId: "blk-next", color: "important", createdAt: new Date() }]

		selectMock
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						limit: async () => [paper],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						orderBy: async () => blocks,
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						orderBy: async () => highlights,
					}),
				}),
			})

		const { buildAgentContext } = await import("./agent")
		const context = await buildAgentContext({
			paperId: "paper-1",
			workspaceId: "00000000-0000-0000-0000-000000000001",
			userId: "user-1",
			selectionContext: {
				blockIds: ["blk-focus"],
				selectedText: "the method",
			},
		})

		expect(context.paperTitle).toBe("A Paper")
		expect(context.paperAuthors).toContain("Ada Lovelace")
		expect(context.paperSummary).toContain("grounded summaries")
		expect(context.focusContext).toContain('Selected text:\n"the method"')
		expect(context.focusContext).toContain("blk-prev")
		expect(context.focusContext).toContain("blk-focus")
		expect(context.focusContext).toContain("blk-next")
		expect(context.marginaliaSignal).toContain("USER MARKED AS IMPORTANT")
		expect(context.marginaliaSignal).toContain("Next block with results.")
	})

	it("marks legacy summaries without block citations as background-only", async () => {
		const paper = {
			id: "paper-1",
			title: "A Paper",
			authors: ["Ada Lovelace"],
			summary: "This summary predates block citations.",
		}
		const blocks = [
			{
				paperId: "paper-1",
				blockId: "blk-focus",
				blockIndex: 0,
				type: "text",
				text: "Focused block.",
				caption: null,
				headingLevel: null,
			},
		]

		selectMock
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						limit: async () => [paper],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						orderBy: async () => blocks,
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						orderBy: async () => [],
					}),
				}),
			})

		const { buildAgentContext } = await import("./agent")
		const context = await buildAgentContext({
			paperId: "paper-1",
			workspaceId: "00000000-0000-0000-0000-000000000001",
			userId: "user-1",
		})

		expect(context.paperSummary).toContain("Legacy summary without block citations")
		expect(context.paperSummary).toContain("This summary predates block citations.")
	})
})
