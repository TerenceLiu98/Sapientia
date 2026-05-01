import { beforeEach, describe, expect, it, vi } from "vitest"
import { compiledLocalConcepts } from "@sapientia/db"

const selectMock: any = vi.fn()
const updateSetMock: any = vi.fn()
const updateMock: any = vi.fn(() => ({
	set: updateSetMock,
}))
const deleteWhereMock: any = vi.fn()
const deleteMock: any = vi.fn(() => ({
	where: deleteWhereMock,
}))
const insertValuesMock: any = vi.fn()
const insertMock: any = vi.fn(() => ({
	values: insertValuesMock,
}))

vi.mock("../db", () => ({
	db: {
		select: (...args: any[]) => selectMock(args[0]),
		update: (...args: any[]) => updateMock(args[0]),
		delete: (...args: any[]) => deleteMock(args[0]),
		insert: (...args: any[]) => insertMock(args[0]),
	},
}))

describe("concept refine", () => {
	beforeEach(() => {
		selectMock.mockReset()
		updateSetMock.mockReset()
		updateMock.mockClear()
		deleteWhereMock.mockReset()
		deleteMock.mockClear()
		insertValuesMock.mockReset()
		insertMock.mockClear()
	})

	it("computes salience from highlights and note block refs and refreshes source page refs", async () => {
		selectMock
			.mockReturnValueOnce({
				from: () => ({
					where: async () => [
						{ id: "concept-1", kind: "concept", displayName: "Concept 1" },
						{ id: "concept-2", kind: "method", displayName: "Concept 2" },
					],
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: async () => [
						{ conceptId: "concept-1", blockId: "blk-1" },
						{ conceptId: "concept-1", blockId: "blk-2" },
						{ conceptId: "concept-2", blockId: "blk-3" },
					],
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: async () => [
						{
							blockId: "blk-1",
							color: "important",
							updatedAt: new Date("2026-05-01T09:00:00.000Z"),
						},
						{
							blockId: "blk-2",
							color: "questioning",
							updatedAt: new Date("2026-05-01T10:00:00.000Z"),
						},
					],
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					innerJoin: () => ({
						where: async () => [
							{
								blockId: "blk-1",
								citationCount: 2,
								noteUpdatedAt: new Date("2026-05-01T11:00:00.000Z"),
							},
							{
								blockId: "blk-3",
								citationCount: 1,
								noteUpdatedAt: new Date("2026-05-01T08:00:00.000Z"),
							},
						],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						limit: async () => [{ id: "page-1" }],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						orderBy: async () => [{ blockId: "blk-legacy" }, { blockId: "blk-2" }],
					}),
				}),
			})

		const updatedRows: Array<Record<string, unknown>> = []
		updateSetMock.mockImplementation((values: Record<string, unknown>) => {
			return {
				where: async (_clause: unknown) => updatedRows.push(values),
			}
		})
		deleteWhereMock.mockResolvedValue(undefined)
		insertValuesMock.mockResolvedValue(undefined)

		const { refinePaperConceptSalience } = await import("./concept-refine")
		const result = await refinePaperConceptSalience({
			paperId: "paper-1",
			userId: "user-1",
			workspaceId: "ws-1",
		})

		expect(result).toEqual({
			paperId: "paper-1",
			workspaceId: "ws-1",
			refinedConceptCount: 2,
		})

		expect(updateMock).toHaveBeenCalledTimes(2)
		expect(updateMock).toHaveBeenCalledWith(compiledLocalConcepts)

		const [firstUpdate, secondUpdate] = updatedRows

		expect(firstUpdate).toMatchObject({
			highlightCount: 2,
			weightedHighlightScore: 2.1,
			noteCitationCount: 2,
			salienceScore: 5.1,
			lastMarginaliaAt: new Date("2026-05-01T11:00:00.000Z"),
		})

		expect(secondUpdate).toMatchObject({
			highlightCount: 0,
			weightedHighlightScore: 0,
			noteCitationCount: 1,
			salienceScore: 1.5,
			lastMarginaliaAt: new Date("2026-05-01T08:00:00.000Z"),
		})

		expect(deleteMock).toHaveBeenCalledTimes(1)
		expect(insertMock).toHaveBeenCalledTimes(1)
		expect(insertValuesMock).toHaveBeenCalledWith([
			{ pageId: "page-1", paperId: "paper-1", blockId: "blk-1" },
			{ pageId: "page-1", paperId: "paper-1", blockId: "blk-2" },
			{ pageId: "page-1", paperId: "paper-1", blockId: "blk-3" },
			{ pageId: "page-1", paperId: "paper-1", blockId: "blk-legacy" },
		])
	})
})
