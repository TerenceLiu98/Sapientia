import { beforeEach, describe, expect, it, vi } from "vitest"
import { compiledLocalConcepts } from "@sapientia/db"

const selectMock: any = vi.fn()
const updateSetMock: any = vi.fn()
const updateMock: any = vi.fn(() => ({
	set: updateSetMock,
}))
const insertOnConflictDoUpdateMock: any = vi.fn()
const insertValuesMock: any = vi.fn(() => ({
	onConflictDoUpdate: insertOnConflictDoUpdateMock,
}))
const insertMock: any = vi.fn(() => ({
	values: insertValuesMock,
}))
const getLlmCredentialMock = vi.fn()
const completeObjectMock = vi.fn()

vi.mock("../db", () => ({
	db: {
		select: (...args: any[]) => selectMock(args[0]),
		update: (...args: any[]) => updateMock(args[0]),
		insert: (...args: any[]) => insertMock(args[0]),
	},
}))

vi.mock("./credentials", () => ({
	getLlmCredential: (...args: unknown[]) => getLlmCredentialMock(...args),
}))

vi.mock("./llm-client", () => ({
	completeObject: (...args: unknown[]) => completeObjectMock(...args),
}))

describe("concept description", () => {
	beforeEach(() => {
		selectMock.mockReset()
		updateSetMock.mockReset()
		updateMock.mockClear()
		insertOnConflictDoUpdateMock.mockReset()
		insertValuesMock.mockClear()
		insertMock.mockClear()
		getLlmCredentialMock.mockReset()
		completeObjectMock.mockReset()
	})

	it("generates source-level descriptions and marks missing concept outputs failed", async () => {
		selectMock
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						limit: async () => [
							{
								id: "paper-1",
								title: "Sparse Features",
								authors: ["Ada Lovelace"],
							},
						],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						orderBy: async () => [
							{
								id: "concept-1",
								kind: "method",
								canonicalName: "sparse feature steering",
								displayName: "Sparse Feature Steering",
								sourceLevelDescriptionStatus: "pending",
								sourceLevelDescriptionInputHash: null,
								readerSignalSummaryInputHash: null,
							},
							{
								id: "concept-2",
								kind: "metric",
								canonicalName: "faithfulness score",
								displayName: "Faithfulness Score",
								sourceLevelDescriptionStatus: "pending",
								sourceLevelDescriptionInputHash: null,
								readerSignalSummaryInputHash: null,
							},
						],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: async () => [
						{ conceptId: "concept-1", blockId: "blk-1" },
						{ conceptId: "concept-2", blockId: "blk-2" },
					],
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: async () => [
						{
							blockId: "blk-1",
							id: "highlight-1",
							color: "important",
							updatedAt: new Date("2026-05-02T09:00:00.000Z"),
						},
					],
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					innerJoin: () => ({
						where: async () => [
							{
								noteId: "note-1",
								blockId: "blk-2",
								citationCount: 2,
								noteTitle: "Metric question",
								noteMarkdown: "Why does this metric matter?",
								noteUpdatedAt: new Date("2026-05-02T10:00:00.000Z"),
							},
						],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: async () => [
						{ conceptId: "concept-1", blockId: "blk-1", snippet: "We steer sparse features." },
						{ conceptId: "concept-2", blockId: "blk-2", snippet: "We report faithfulness." },
					],
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: async () => [
						{
							blockId: "blk-1",
							page: 3,
							text: "We steer sparse features to modify model behavior.",
						},
						{
							blockId: "blk-2",
							page: 7,
							text: "Faithfulness score measures whether the intervention preserves evidence.",
						},
					],
				}),
			})

		const updatedRows: Array<Record<string, unknown>> = []
		updateSetMock.mockImplementation((values: Record<string, unknown>) => ({
			where: async () => {
				updatedRows.push(values)
			},
		}))
		getLlmCredentialMock.mockResolvedValue({ model: "model-1" })
		completeObjectMock.mockResolvedValue({
			model: "model-1",
			object: {
				concepts: [
					{
						localConceptId: "concept-1",
						description:
							"In this paper, sparse feature steering is the intervention used to modify model behavior through sparse features.",
						confidence: 0.82,
						usedEvidenceBlockIds: ["blk-1", "not-a-real-block"],
					},
				],
			},
		})

		const { compilePaperConceptDescriptions } = await import("./concept-description")
		const result = await compilePaperConceptDescriptions({
			paperId: "paper-1",
			workspaceId: "workspace-1",
			userId: "user-1",
		})

		expect(result).toMatchObject({
			paperId: "paper-1",
			workspaceId: "workspace-1",
			describedConceptCount: 1,
			skippedConceptCount: 0,
			failedConceptCount: 1,
			readerSignalConceptCount: 2,
		})

		expect(updateMock).toHaveBeenCalledWith(compiledLocalConcepts)
		expect(completeObjectMock).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: "user-1",
				workspaceId: "workspace-1",
				promptId: "concept-source-description-v1",
				model: "model-1",
				maxTokens: 12_000,
			}),
		)

		expect(updatedRows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					readerSignalSummary: "Reader signal: highlighted on 1 evidence block(s): 1 important.",
					readerSignalSummaryModel: "deterministic",
					readerSignalSummaryStatus: "done",
				}),
				expect.objectContaining({
					readerSignalSummary: "Reader signal: cited 2 time(s) in notes.",
					readerSignalSummaryModel: "deterministic",
					readerSignalSummaryStatus: "done",
				}),
				expect.objectContaining({
					sourceLevelDescriptionStatus: "running",
					sourceLevelDescriptionError: null,
				}),
				expect.objectContaining({
					sourceLevelDescription:
						"In this paper, sparse feature steering is the intervention used to modify model behavior through sparse features.",
					sourceLevelDescriptionConfidence: 0.82,
					sourceLevelDescriptionModel: "model-1",
					sourceLevelDescriptionPromptVersion: "concept-source-description-v1",
					sourceLevelDescriptionStatus: "done",
					semanticDirtyAt: expect.any(Date),
					semanticFingerprint: expect.any(String),
					confidenceScore: 0.82,
				}),
				expect.objectContaining({
					sourceLevelDescriptionStatus: "failed",
					sourceLevelDescriptionError: "missing concept in LLM output",
				}),
			]),
		)
	})

	it("skips up-to-date source descriptions without requiring LLM credentials", async () => {
		selectMock
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						limit: async () => [{ id: "paper-1", title: "Paper", authors: [] }],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						orderBy: async () => [
							{
								id: "concept-1",
								kind: "concept",
								canonicalName: "concept",
								displayName: "Concept",
								sourceLevelDescriptionStatus: "done",
								sourceLevelDescriptionInputHash: "already-current",
								readerSignalSummaryInputHash: null,
							},
						],
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
					where: async () => [],
				}),
			})

		const { compilePaperConceptDescriptions } = await import("./concept-description")
		const result = await compilePaperConceptDescriptions({
			paperId: "paper-1",
			workspaceId: "workspace-1",
			userId: "user-1",
		})

		expect(result).toMatchObject({
			describedConceptCount: 0,
			skippedConceptCount: 1,
			failedConceptCount: 0,
			readerSignalConceptCount: 0,
		})
		expect(getLlmCredentialMock).not.toHaveBeenCalled()
		expect(completeObjectMock).not.toHaveBeenCalled()
	})
})
