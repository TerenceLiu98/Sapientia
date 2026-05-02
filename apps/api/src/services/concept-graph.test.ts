import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	compiledLocalConceptEdgeEvidence,
	compiledLocalConceptEdges,
	compiledLocalConcepts,
} from "@sapientia/db"
import { LlmCredentialMissingError } from "./llm-client"

const selectMock = vi.fn()
const transactionMock = vi.fn()
const getLlmCredentialMock = vi.fn()
const completeObjectMock = vi.fn()

vi.mock("../db", () => ({
	db: {
		select: (...args: Array<unknown>) => selectMock(...args),
		transaction: (...args: Array<unknown>) => transactionMock(...args),
		delete: vi.fn(),
	},
}))

vi.mock("./credentials", () => ({
	getLlmCredential: (...args: Array<unknown>) => getLlmCredentialMock(...args),
}))

vi.mock("./llm-client", async () => {
	const actual = await vi.importActual<typeof import("./llm-client")>("./llm-client")
	return {
		...actual,
		completeObject: (...args: Array<unknown>) => completeObjectMock(...args),
	}
})

describe("concept graph compile", () => {
	beforeEach(() => {
		selectMock.mockReset()
		transactionMock.mockReset()
		getLlmCredentialMock.mockReset()
		completeObjectMock.mockReset()
	})

	it("compiles inner-paper edges grounded in existing local concepts", async () => {
		const insertedRows: Array<{ table: "edges" | "evidence"; values: unknown }> = []

		selectMock
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						limit: async () => [
							{
								id: "paper-1",
								title: "A Paper",
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
								kind: "task",
								canonicalName: "question answering",
								displayName: "Question Answering",
							},
							{
								id: "concept-2",
								kind: "metric",
								canonicalName: "f1 score",
								displayName: "F1 score",
							},
							{
								id: "concept-3",
								kind: "dataset",
								canonicalName: "squad",
								displayName: "SQuAD",
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
								paperId: "paper-1",
								blockId: "blk-1",
								blockIndex: 0,
								type: "text",
								text: "Question answering is evaluated with F1 score.",
								headingLevel: null,
							},
							{
								paperId: "paper-1",
								blockId: "blk-2",
								blockIndex: 1,
								type: "text",
								text: "Another useful paragraph.",
								headingLevel: null,
							},
						],
					}),
				}),
			})

		getLlmCredentialMock.mockResolvedValue({
			provider: "openai",
			apiKey: "sk-test",
			model: "gpt-5",
			baseURL: null,
		})

		completeObjectMock.mockResolvedValueOnce({
			object: {
				edges: [
					{
						sourceCanonicalName: "f1 score",
						targetCanonicalName: "question answering",
						relationType: "measured_by",
						evidenceBlockIds: ["blk-1", "blk-missing"],
						confidence: 0.93,
					},
					{
						sourceCanonicalName: "squad",
						targetCanonicalName: "f1 score",
						relationType: "related_to",
						evidenceBlockIds: ["blk-2"],
						confidence: 0.4,
					},
				],
			},
			model: "gpt-5",
		})

		transactionMock.mockImplementation(async (callback: (tx: any) => Promise<void>) =>
			callback({
				delete: () => ({
					where: async () => undefined,
				}),
				insert: (table: unknown) => {
					if (table === compiledLocalConceptEdges) {
						return {
							values: (values: Array<Record<string, unknown>>) => {
								insertedRows.push({ table: "edges", values })
								return {
									returning: async () =>
										values.map((value, index) => ({
											id: `edge-${index + 1}`,
											sourceConceptId: value.sourceConceptId,
											targetConceptId: value.targetConceptId,
											relationType: value.relationType,
										})),
								}
							},
						}
					}

					if (table === compiledLocalConceptEdgeEvidence) {
						return {
							values: (values: Array<Record<string, unknown>>) => {
								insertedRows.push({ table: "evidence", values })
								return Promise.resolve()
							},
						}
					}

					if (table === compiledLocalConcepts) {
						throw new Error("unexpected concept insert")
					}

					return {
						values: async () => {
							throw new Error("unexpected table insert in concept-graph test")
						},
					}
				},
			}),
		)

		const { compilePaperInnerGraph } = await import("./concept-graph")
		const result = await compilePaperInnerGraph({
			paperId: "paper-1",
			userId: "user-1",
			workspaceId: "ws-1",
		})

		expect(result).toEqual({
			paperId: "paper-1",
			workspaceId: "ws-1",
			edgeCount: 1,
		})

		expect(completeObjectMock).toHaveBeenCalledTimes(1)
		expect(insertedRows.find((row) => row.table === "edges")?.values).toEqual([
			expect.objectContaining({
				workspaceId: "ws-1",
				ownerUserId: "user-1",
				paperId: "paper-1",
				sourceConceptId: "concept-1",
				targetConceptId: "concept-2",
				relationType: "measured_by",
				promptVersion: "wiki-extract-inner-graph-v1",
			}),
		])
		expect(insertedRows.find((row) => row.table === "evidence")?.values).toEqual([
			expect.objectContaining({
				paperId: "paper-1",
				blockId: "blk-1",
				snippet: "Question answering is evaluated with F1 score.",
				confidence: 0.93,
			}),
		])
	})

	it("normalizes JSON-mode graph aliases and display-name endpoints", async () => {
		const insertedRows: Array<{ table: "edges" | "evidence"; values: unknown }> = []

		selectMock
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						limit: async () => [{ id: "paper-1", title: "A Paper", authors: [] }],
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
								canonicalName: "dynamic bert-reinforcement learning model",
								displayName: "Dynamic BERT-Reinforcement Learning Model",
							},
							{
								id: "concept-2",
								kind: "task",
								canonicalName: "intent recognition",
								displayName: "Intent Recognition",
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
								paperId: "paper-1",
								blockId: "blk-1",
								blockIndex: 0,
								type: "text",
								text: "The model addresses intent recognition.",
								headingLevel: null,
							},
						],
					}),
				}),
			})

		getLlmCredentialMock.mockResolvedValue({
			provider: "openai",
			apiKey: "sk-test",
			model: "gpt-5",
			baseURL: null,
		})

		completeObjectMock.mockImplementationOnce(async (args: any) => ({
			object: args.schema.parse({
				relations: [
					{
						source_name: "Intent Recognition",
						target_name: "Dynamic BERT-Reinforcement Learning Model",
						relation_type: "solved by",
						evidence: [{ block_id: "[Block #blk-1: text]" }],
						confidence: "0.88",
					},
				],
			}),
			model: "gpt-5",
		}))

		transactionMock.mockImplementation(async (callback: (tx: any) => Promise<void>) =>
			callback({
				delete: () => ({ where: async () => undefined }),
				insert: (table: unknown) => {
					if (table === compiledLocalConceptEdges) {
						return {
							values: (values: Array<Record<string, unknown>>) => {
								insertedRows.push({ table: "edges", values })
								return {
									returning: async () =>
										values.map((value, index) => ({
											id: `edge-${index + 1}`,
											sourceConceptId: value.sourceConceptId,
											targetConceptId: value.targetConceptId,
											relationType: value.relationType,
										})),
								}
							},
						}
					}
					if (table === compiledLocalConceptEdgeEvidence) {
						return {
							values: (values: Array<Record<string, unknown>>) => {
								insertedRows.push({ table: "evidence", values })
								return Promise.resolve()
							},
						}
					}
					return {
						values: async () => {
							throw new Error("unexpected table insert in concept-graph alias test")
						},
					}
				},
			}),
		)

		const { compilePaperInnerGraph } = await import("./concept-graph")
		const result = await compilePaperInnerGraph({
			paperId: "paper-1",
			userId: "user-1",
			workspaceId: "ws-1",
		})

		expect(result.edgeCount).toBe(1)
		expect(insertedRows.find((row) => row.table === "edges")?.values).toEqual([
			expect.objectContaining({
				sourceConceptId: "concept-1",
				targetConceptId: "concept-2",
				relationType: "addresses",
				confidence: 0.88,
			}),
		])
	})

	it("throws when no llm credentials exist", async () => {
		selectMock
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						limit: async () => [{ id: "paper-1", title: "A Paper", authors: [] }],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						orderBy: async () => [
							{
								id: "concept-1",
								kind: "task",
								canonicalName: "question answering",
								displayName: "Question Answering",
							},
							{
								id: "concept-2",
								kind: "metric",
								canonicalName: "f1 score",
								displayName: "F1 score",
							},
						],
					}),
				}),
			})

		getLlmCredentialMock.mockResolvedValue(null)

		const { compilePaperInnerGraph } = await import("./concept-graph")
		await expect(
			compilePaperInnerGraph({
				paperId: "paper-1",
				userId: "user-1",
				workspaceId: "ws-1",
			}),
		).rejects.toBeInstanceOf(LlmCredentialMissingError)
	})
})
