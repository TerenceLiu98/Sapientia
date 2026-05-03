import { compiledLocalConcepts } from "@sapientia/db"
import { beforeEach, describe, expect, it, vi } from "vitest"

const selectMock = vi.fn()
const updateSetMock = vi.fn()
const updateMock = vi.fn((_target?: unknown) => ({
	set: updateSetMock,
}))
const insertOnConflictDoUpdateMock = vi.fn()
const insertValuesMock = vi.fn(() => ({
	onConflictDoUpdate: insertOnConflictDoUpdateMock,
}))
const insertMock = vi.fn((_target?: unknown) => ({
	values: insertValuesMock,
}))
const getLlmCredentialMock = vi.fn()
const completeObjectMock = vi.fn()

vi.mock("../db", () => ({
	db: {
		select: (...args: unknown[]) => selectMock(args[0]),
		update: (...args: unknown[]) => updateMock(args[0]),
		insert: (...args: unknown[]) => insertMock(args[0]),
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

	it("includes annotation citations in reader signal summaries as ordinary note signal", async () => {
		selectMock
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
								sourceLevelDescriptionInputHash: null,
								readerSignalSummaryInputHash: null,
							},
						],
					}),
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
									noteId: "note-1",
									annotationId: "annotation-1",
									citationCount: 3,
									noteTitle: "Annotation note",
									noteMarkdown: "This annotated passage matters.",
									noteUpdatedAt: new Date("2026-05-02T10:00:00.000Z"),
									page: 2,
									body: { rects: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] },
								},
							],
						}),
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: async () => [
						{ blockId: "blk-1", page: 2, bbox: { x: 0.05, y: 0.05, w: 0.4, h: 0.4 } },
					],
				}),
			})

		const updatedRows: Array<Record<string, unknown>> = []
		updateSetMock.mockImplementation((values: Record<string, unknown>) => ({
			where: async () => {
				updatedRows.push(values)
			},
		}))

		const { refreshPaperConceptReaderSignals } = await import("./concept-description")
		const result = await refreshPaperConceptReaderSignals({
			paperId: "paper-1",
			workspaceId: "workspace-1",
			userId: "user-1",
		})

		expect(result.readerSignalConceptCount).toBe(1)
		expect(updatedRows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					readerSignalSummary: "Reader signal: cited 3 time(s) in notes.",
					readerSignalSummaryModel: "deterministic",
					readerSignalSummaryStatus: "done",
				}),
			]),
		)
		expect(insertValuesMock).toHaveBeenCalledWith([
			expect.objectContaining({
				sourceType: "note",
				sourceId: "note:note-1",
				blockIds: ["blk-1"],
				signalWeight: 3,
			}),
		])
	})
})
