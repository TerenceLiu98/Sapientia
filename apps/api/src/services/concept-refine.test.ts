import { compiledLocalConcepts } from "@sapientia/db"
import { beforeEach, describe, expect, it, vi } from "vitest"

const selectMock = vi.fn()
const updateSetMock = vi.fn()
const updateMock = vi.fn((_target?: unknown) => ({
	set: updateSetMock,
}))
const deleteWhereMock = vi.fn()
const deleteMock = vi.fn((_target?: unknown) => ({
	where: deleteWhereMock,
}))
const insertValuesMock = vi.fn()
const insertMock = vi.fn((_target?: unknown) => ({
	values: insertValuesMock,
}))

vi.mock("../db", () => ({
	db: {
		select: (...args: unknown[]) => selectMock(args[0]),
		update: (...args: unknown[]) => updateMock(args[0]),
		delete: (...args: unknown[]) => deleteMock(args[0]),
		insert: (...args: unknown[]) => insertMock(args[0]),
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
					innerJoin: () => ({
						innerJoin: () => ({
							where: async () => [],
						}),
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: async () => [],
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

	it("counts note annotation refs when their markup overlaps concept evidence blocks", async () => {
		selectMock
			.mockReturnValueOnce({
				from: () => ({
					where: async () => [
						{ id: "concept-1", kind: "concept", displayName: "Concept 1" },
					],
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: async () => [{ conceptId: "concept-1", blockId: "blk-1" }],
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: async () => [],
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					innerJoin: () => ({
						where: async () => [],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					innerJoin: () => ({
						innerJoin: () => ({
							where: async () => [
								{
									annotationId: "00000000-0000-0000-0000-000000000001",
									citationCount: 2,
									noteUpdatedAt: new Date("2026-05-01T12:00:00.000Z"),
									page: 1,
									body: { rects: [{ x: 0.1, y: 0.1, w: 0.1, h: 0.1 }], quote: "quoted" },
								},
							],
						}),
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: async () => [
						{ blockId: "blk-1", page: 1, bbox: { x: 0.05, y: 0.05, w: 0.3, h: 0.3 } },
					],
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						limit: async () => [],
					}),
				}),
			})

		const updatedRows: Array<Record<string, unknown>> = []
		updateSetMock.mockImplementation((values: Record<string, unknown>) => ({
			where: async (_clause: unknown) => updatedRows.push(values),
		}))

		const { refinePaperConceptSalience } = await import("./concept-refine")
		await refinePaperConceptSalience({
			paperId: "paper-1",
			userId: "user-1",
			workspaceId: "ws-1",
		})

		expect(updatedRows[0]).toMatchObject({
			noteCitationCount: 2,
			salienceScore: 3,
			lastMarginaliaAt: new Date("2026-05-01T12:00:00.000Z"),
		})
	})

	it("ignores annotation refs that cannot be mapped back to evidence blocks", async () => {
		selectMock
			.mockReturnValueOnce({
				from: () => ({
					where: async () => [
						{ id: "concept-1", kind: "concept", displayName: "Concept 1" },
					],
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: async () => [{ conceptId: "concept-1", blockId: "blk-1" }],
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: async () => [],
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					innerJoin: () => ({
						where: async () => [],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					innerJoin: () => ({
						innerJoin: () => ({
							where: async () => [
								{
									annotationId: "00000000-0000-0000-0000-000000000002",
									citationCount: 4,
									noteUpdatedAt: new Date("2026-05-01T12:00:00.000Z"),
									page: 3,
									body: { rects: [{ x: 0.8, y: 0.8, w: 0.1, h: 0.1 }] },
								},
							],
						}),
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: async () => [
						{ blockId: "blk-1", page: 3, bbox: { x: 0.05, y: 0.05, w: 0.3, h: 0.3 } },
					],
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						limit: async () => [],
					}),
				}),
			})

		const updatedRows: Array<Record<string, unknown>> = []
		updateSetMock.mockImplementation((values: Record<string, unknown>) => ({
			where: async (_clause: unknown) => updatedRows.push(values),
		}))

		const { refinePaperConceptSalience } = await import("./concept-refine")
		await refinePaperConceptSalience({
			paperId: "paper-1",
			userId: "user-1",
			workspaceId: "ws-1",
		})

		expect(updatedRows[0]).toMatchObject({
			noteCitationCount: 0,
			salienceScore: 0,
			lastMarginaliaAt: null,
		})
	})
})
