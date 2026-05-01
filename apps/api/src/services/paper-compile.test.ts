import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	compiledLocalConceptEvidence,
	compiledLocalConcepts,
	papers,
	wikiPageReferences,
	wikiPages,
} from "@sapientia/db"
import { z } from "zod"
import { LlmCredentialMissingError } from "./llm-client"

const selectMock = vi.fn()
const transactionMock = vi.fn()
const getLlmCredentialMock = vi.fn()
const completeObjectMock = vi.fn()

const txDeleteWhereMock = vi.fn()
const txDeleteMock = vi.fn(() => ({ where: txDeleteWhereMock }))
const txInsertValuesMock = vi.fn()
const txInsertMock = vi.fn(() => ({ values: txInsertValuesMock }))

vi.mock("../db", () => ({
	db: {
		select: (...args: Array<unknown>) => selectMock(...args),
		transaction: (...args: Array<unknown>) => transactionMock(...args),
		insert: vi.fn(),
		update: vi.fn(),
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

describe("paper compile", () => {
	beforeEach(() => {
		selectMock.mockReset()
		transactionMock.mockReset()
		getLlmCredentialMock.mockReset()
	completeObjectMock.mockReset()
	txDeleteWhereMock.mockReset()
	txDeleteMock.mockClear()
	txInsertValuesMock.mockReset()
	txInsertMock.mockClear()
	})

	it("normalizes common JSON-mode aliases into the compile schema", async () => {
		const { paperCompileResultSchema } = await import("./paper-compile")
		expect(() => z.toJSONSchema(paperCompileResultSchema)).not.toThrow()

		const parsed = paperCompileResultSchema.parse({
			body: "A compact source page.",
			reference_block_ids: [{ block_id: "blk-1" }, "blk-2"],
			local_concepts: [
				{
					type: "methods",
					canonical_name: "  Sparse Autoencoder  ",
					display_name: "Sparse Autoencoder",
					evidence_block_ids: [{ block_id: "blk-1" }],
				},
				{
					category: "metrics",
					name: "F1 score",
					evidence: [{ blockId: "blk-2" }],
				},
				{
					kind: "findings",
					name: "Sparse feature findings",
					block_ids: ["blk-2"],
				},
				{
					kind: "baseline",
					name: "BERTOPIC",
					block_ids: ["blk-1"],
				},
			],
		})

		expect(parsed).toEqual({
			summary: "A compact source page.",
			referenceBlockIds: ["blk-1", "blk-2"],
			concepts: [
				{
					kind: "method",
					canonicalName: "  Sparse Autoencoder  ",
					displayName: "Sparse Autoencoder",
					evidenceBlockIds: ["blk-1"],
				},
				{
					kind: "metric",
					canonicalName: "F1 score",
					displayName: "F1 score",
					evidenceBlockIds: ["blk-2"],
				},
				{
					kind: "concept",
					canonicalName: "Sparse feature findings",
					displayName: "Sparse feature findings",
					evidenceBlockIds: ["blk-2"],
				},
				{
					kind: "method",
					canonicalName: "BERTOPIC",
					displayName: "BERTOPIC",
					evidenceBlockIds: ["blk-1"],
				},
			],
		})
	})

	it("compiles summary, source page, and local concepts with grounded references", async () => {
		const insertedRows: Array<{ table: "concepts" | "evidence" | "pages" | "references"; values: unknown }> = []

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
					where: async () => [{ workspaceId: "ws-1" }],
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
								text: "Method block",
								headingLevel: null,
							},
							{
								paperId: "paper-1",
								blockId: "blk-2",
								blockIndex: 1,
								type: "text",
								text: "Metric block",
								headingLevel: null,
							},
						],
					}),
				}),
			})

		getLlmCredentialMock.mockResolvedValue({
			provider: "anthropic",
			apiKey: "sk-test",
			model: "claude-sonnet-4-6",
			baseURL: null,
		})

		completeObjectMock.mockResolvedValueOnce({
			object: {
				summary: "## Overview\n\nA compact source page.",
				referenceBlockIds: ["blk-2", "blk-1", "blk-404"],
				concepts: [
					{
						kind: "method",
						canonicalName: "  Meta Gaussian  ",
						displayName: "Meta Gaussian",
						evidenceBlockIds: ["blk-1", "blk-missing"],
					},
					{
						kind: "metric",
						canonicalName: "f1 score",
						displayName: "F1 score",
						evidenceBlockIds: ["blk-2"],
					},
				],
			},
			model: "claude-sonnet-4-6",
		})

		transactionMock.mockImplementation(async (callback: (tx: any) => Promise<void>) =>
			callback({
				update: (table: unknown) => {
					if (table === papers) {
						return {
							set: (_values: Record<string, unknown>) => ({
								where: async () => undefined,
							}),
						}
					}
					throw new Error("unexpected table update in paper-compile test")
				},
				delete: txDeleteMock,
				insert: (table: unknown) => {
					if (table === wikiPages) {
						return {
							values: (values: Array<Record<string, unknown>> | Record<string, unknown>) => {
								insertedRows.push({ table: "pages", values })
								return {
									returning: async () => [{ id: "page-1" }],
								}
							},
						}
					}

					if (table === compiledLocalConcepts) {
						return {
							values: (values: Array<Record<string, unknown>>) => {
								insertedRows.push({ table: "concepts", values })
								return {
									returning: async () =>
										values.map((value, index) => ({
											id: `concept-${index + 1}`,
											canonicalName: value.canonicalName,
											kind: value.kind,
										})),
								}
							},
						}
					}

					if (table === compiledLocalConceptEvidence) {
						return {
							values: (values: Array<Record<string, unknown>>) => {
								insertedRows.push({ table: "evidence", values })
								return Promise.resolve()
							},
						}
					}

					if (table === wikiPageReferences) {
						return {
							values: (values: Array<Record<string, unknown>>) => {
								insertedRows.push({ table: "references", values })
								return Promise.resolve()
							},
						}
					}

					return {
						values: async () => {
							throw new Error("unexpected table insert in paper-compile test")
						},
					}
				},
			}),
		)

		const { compilePaper } = await import("./paper-compile")
		const result = await compilePaper({ paperId: "paper-1", userId: "user-1" })

		expect(result).toEqual({
			paperId: "paper-1",
			workspaceCount: 1,
			conceptCount: 2,
			summaryChars: "## Overview\n\nA compact source page.".length,
			model: "claude-sonnet-4-6",
		})

		expect(completeObjectMock).toHaveBeenCalledTimes(1)

		const insertedConcepts = insertedRows.find((row) => row.table === "concepts")
		expect(insertedConcepts).toBeTruthy()
		expect(insertedConcepts?.values).toEqual([
			expect.objectContaining({
				workspaceId: "ws-1",
				ownerUserId: "user-1",
				paperId: "paper-1",
				kind: "method",
				canonicalName: "meta gaussian",
				displayName: "Meta Gaussian",
				promptVersion: "paper-compile-v1",
			}),
			expect.objectContaining({
				kind: "metric",
				canonicalName: "f1 score",
			}),
		])

		const insertedEvidence = insertedRows.find((row) => row.table === "evidence")
		expect(insertedEvidence?.values).toEqual([
			expect.objectContaining({
				paperId: "paper-1",
				blockId: "blk-1",
				snippet: "Method block",
				confidence: null,
			}),
			expect.objectContaining({
				paperId: "paper-1",
				blockId: "blk-2",
				snippet: "Metric block",
				confidence: null,
			}),
		])

		const insertedPage = insertedRows.find((row) => row.table === "pages")
		expect(insertedPage?.values).toEqual(
			expect.objectContaining({
				workspaceId: "ws-1",
				ownerUserId: "user-1",
				type: "source",
				canonicalName: "paper:paper-1",
				sourcePaperId: "paper-1",
				body: "## Overview\n\nA compact source page.",
				promptVersion: "paper-compile-v1",
			}),
		)

		const insertedReferences = insertedRows.find((row) => row.table === "references")
		expect(insertedReferences?.values).toEqual([
			{ pageId: "page-1", paperId: "paper-1", blockId: "blk-2" },
			{ pageId: "page-1", paperId: "paper-1", blockId: "blk-1" },
		])
	})

	it("surfaces missing credentials as the existing llm credential error", async () => {
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
					where: async () => [{ workspaceId: "ws-1" }],
				}),
			})

		getLlmCredentialMock.mockResolvedValue(null)

		const { compilePaper } = await import("./paper-compile")
		await expect(compilePaper({ paperId: "paper-1", userId: "user-1" })).rejects.toBeInstanceOf(
			LlmCredentialMissingError,
		)
	})

	it("applies hard caps to concept evidence and page references", async () => {
		const insertedRows: Array<{ table: "concepts" | "evidence" | "pages" | "references"; values: unknown }> = []

		const manyBlocks = Array.from({ length: 620 }, (_, index) => ({
			paperId: "paper-1",
			blockId: `blk-${index + 1}`,
			blockIndex: index,
			type: "text",
			text: `Block ${index + 1}`,
			headingLevel: null,
		}))

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
					where: async () => [{ workspaceId: "ws-1" }],
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						orderBy: async () => manyBlocks,
					}),
				}),
			})

		getLlmCredentialMock.mockResolvedValue({
			provider: "anthropic",
			apiKey: "sk-test",
			model: "claude-sonnet-4-6",
			baseURL: null,
		})

		completeObjectMock.mockResolvedValueOnce({
			object: {
				summary: "## Overview\n\nA compact source page.",
				referenceBlockIds: Array.from({ length: 610 }, (_, index) => `blk-${index + 1}`),
				concepts: [
					{
						kind: "concept",
						canonicalName: "large concept",
						displayName: "Large Concept",
						evidenceBlockIds: Array.from({ length: 250 }, (_, index) => `blk-${index + 1}`),
					},
				],
			},
			model: "claude-sonnet-4-6",
		})

		transactionMock.mockImplementation(async (callback: (tx: any) => Promise<void>) =>
			callback({
				update: (table: unknown) => {
					if (table === papers) {
						return {
							set: (_values: Record<string, unknown>) => ({
								where: async () => undefined,
							}),
						}
					}
					throw new Error("unexpected table update in paper-compile test")
				},
				delete: txDeleteMock,
				insert: (table: unknown) => {
					if (table === wikiPages) {
						return {
							values: (values: Array<Record<string, unknown>> | Record<string, unknown>) => {
								insertedRows.push({ table: "pages", values })
								return {
									returning: async () => [{ id: "page-1" }],
								}
							},
						}
					}

					if (table === compiledLocalConcepts) {
						return {
							values: (values: Array<Record<string, unknown>>) => {
								insertedRows.push({ table: "concepts", values })
								return {
									returning: async () =>
										values.map((value, index) => ({
											id: `concept-${index + 1}`,
											canonicalName: value.canonicalName,
											kind: value.kind,
										})),
								}
							},
						}
					}

					if (table === compiledLocalConceptEvidence) {
						return {
							values: (values: Array<Record<string, unknown>>) => {
								insertedRows.push({ table: "evidence", values })
								return Promise.resolve()
							},
						}
					}

					if (table === wikiPageReferences) {
						return {
							values: (values: Array<Record<string, unknown>>) => {
								insertedRows.push({ table: "references", values })
								return Promise.resolve()
							},
						}
					}

					return {
						values: async () => {
							throw new Error("unexpected table insert in paper-compile test")
						},
					}
				},
			}),
		)

		const { compilePaper } = await import("./paper-compile")
		await compilePaper({ paperId: "paper-1", userId: "user-1" })

		const insertedEvidence = insertedRows.find((row) => row.table === "evidence")
		expect(Array.isArray(insertedEvidence?.values)).toBe(true)
		expect((insertedEvidence?.values as Array<unknown>).length).toBe(200)

		const insertedReferences = insertedRows.find((row) => row.table === "references")
		expect(Array.isArray(insertedReferences?.values)).toBe(true)
		expect((insertedReferences?.values as Array<unknown>).length).toBe(500)
	})
})
