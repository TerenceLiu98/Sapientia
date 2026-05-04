import { describe, expect, it } from "vitest"
import { fillPrompt, loadPrompt } from "./index"

describe("loadPrompt", () => {
	it("returns the source-summary-v2 template", () => {
		const template = loadPrompt("source-summary-v2")
		expect(template).toContain("{{title}}")
		expect(template).toContain("{{authors}}")
		expect(template).toContain("{{blocks}}")
		expect(template).toContain("{{abstractBlock}}")
		// Sanity-check key framing (downstream-LLM, not human-summary).
		expect(template).toContain("downstream agent")
		expect(template).toContain(
			"Every substantive factual claim must include one or more inline block citations",
		)
	})

	it("returns the agent-summon-v2 template", () => {
		const template = loadPrompt("agent-summon-v2")
		expect(template).toContain("Evidence threshold")
		expect(template).toContain("retrieval scaffolding")
		expect(template).toContain("Block-cited paper text is the source of truth")
		expect(template).toContain("do not have enough evidence in the current paper context")
	})

	it("returns the paper-compile-v1 template", () => {
		const template = loadPrompt("paper-compile-v1")
		expect(template).toContain('"summary"')
		expect(template).toContain('"referenceBlockIds"')
		expect(template).toContain('"concepts"')
		expect(template).toContain("one agent-facing summary")
		expect(template).toContain("## Context")
		expect(template).toContain("## Method")
		expect(template).toContain("## Result")
		expect(template).toContain("## Critical")
		expect(template).toContain("## Value")
		expect(template).toContain("do not omit load-bearing concepts only to hit a fixed count")
		expect(template).toContain("A concept is load-bearing only if removing it would make")
		expect(template).toContain(
			"Sapientia wants reading atoms, not a broad scientific keyphrase list",
		)
		expect(template).toContain("Taxonomy and reading-frame are separate")
		expect(template).toContain("Context, Method, Result, Critical, or Value")
		expect(template).toContain("Output only core and supporting candidates")
		expect(template).toContain("Never output incidental candidates")
		expect(template).toContain("Concepts only mentioned in related work are usually incidental")
		expect(template).toContain("Zero-shot classification, few-shot classification")
		expect(template).toContain("A problem, objective, capability, or evaluation target is usually")
		expect(template).toContain("A score, measurement, rate, loss, or criterion is")
		expect(template).toContain("A named model or algorithm introduced by the paper")
		expect(template).toContain("Every concept kind must be exactly one of")
		expect(template).toContain('"concept", "method", "task", "metric", "dataset"')
		expect(template).not.toContain('"person"')
		expect(template).not.toContain('"organization"')
		expect(template).toContain("preserve meaningful balanced parentheticals")
		expect(template).toContain("{{blocks}}")
	})

	it("returns the paper-compile-window-v1 template", () => {
		const template = loadPrompt("paper-compile-window-v1")
		expect(template).toContain('"windowSummary"')
		expect(template).toContain("primaryBlockIds")
		expect(template).toContain("contextBlockIds")
		expect(template).toContain("A block must be treated as indivisible")
		expect(template).toContain("Taxonomy and reading-frame are separate")
		expect(template).toContain("Context: problem, gap, motivation")
		expect(template).toContain("Use this importance rubric before output")
		expect(template).toContain("Window extraction may keep a single-window concept only when")
		expect(template).toContain("Never output incidental candidates")
		expect(template).toContain("Use these labels so the reduce step can preserve the reading frame")
		expect(template).not.toContain('"person"')
		expect(template).not.toContain('"organization"')
		expect(template).toContain("{{windowId}}")
		expect(template).toContain("{{blocks}}")
	})

	it("returns the paper-compile-reduce-v1 template", () => {
		const template = loadPrompt("paper-compile-reduce-v1")
		expect(template).toContain('"summary"')
		expect(template).toContain('"referenceBlockIds"')
		expect(template).toContain('"concepts"')
		expect(template).toContain("Do not drop load-bearing concepts only because they appear late")
		expect(template).toContain("Reduce is the final paper-level importance filter")
		expect(template).toContain("Taxonomy and reading-frame are separate")
		expect(template).toContain(
			"Keep only candidates that are core or supporting at the whole-paper level",
		)
		expect(template).toContain("Drop incidental candidates")
		expect(template).toContain("## Context")
		expect(template).toContain("## Method")
		expect(template).toContain("## Result")
		expect(template).toContain("## Critical")
		expect(template).toContain("## Value")
		expect(template).not.toContain('"person"')
		expect(template).not.toContain('"organization"')
		expect(template).toContain("not for storing every concept evidence block")
		expect(template).toContain("{{windowArtifacts}}")
	})

	it("returns the concept-source-description-v1 template", () => {
		const template = loadPrompt("concept-source-description-v1")
		expect(template).toContain('"localConceptId"')
		expect(template).toContain('"description"')
		expect(template).toContain('"usedEvidenceBlockIds"')
		expect(template).toContain("paper-local concept descriptions")
		expect(template).toContain("Describe the concept's role in the paper's reading frame")
		expect(template).toContain("Context: problem, gap, motivation")
		expect(template).toContain("{{conceptEvidence}}")
	})

	it("returns the note-concept-extract-v1 template", () => {
		const template = loadPrompt("note-concept-extract-v1")
		expect(template).toContain('"groundedConcepts"')
		expect(template).toContain('"questions"')
		expect(template).toContain("Available evidence block ids")
		expect(template).toContain("Agent question")
		expect(template).not.toContain('"person"')
		expect(template).not.toContain('"organization"')
		expect(template).toContain("{{noteMarkdown}}")
	})

	it("returns the semantic-candidate-judgement-v1 template", () => {
		const template = loadPrompt("semantic-candidate-judgement-v1")
		expect(template).toContain('"same"')
		expect(template).toContain('"related"')
		expect(template).toContain('"different"')
		expect(template).toContain('"uncertain"')
		expect(template).toContain("Do not merge concepts")
		expect(template).toContain("{{candidates}}")
	})

	it("returns the wiki-extract-inner-graph-v1 template", () => {
		const template = loadPrompt("wiki-extract-inner-graph-v1")
		expect(template).toContain('"edges"')
		expect(template).toContain('"sourceCanonicalName"')
		expect(template).toContain('"targetCanonicalName"')
		expect(template).toContain('"relationType"')
		expect(template).toContain('"evidenceBlockIds"')
		expect(template).toContain(
			"do not omit strong evidence-grounded relations only to hit a fixed count",
		)
		expect(template).toContain("Direction: method -> task")
		expect(template).toContain("Always output the canonical direction")
		expect(template).toContain("Task T is solved by Method M")
		expect(template).toContain('output "081f769b"')
		expect(template).toContain("Return zero edges when")
		expect(template).toContain("{{concepts}}")
		expect(template).toContain("{{blocks}}")
	})
})

describe("fillPrompt", () => {
	it("replaces {{slot}} placeholders with provided values", () => {
		const result = fillPrompt("Hello {{name}}, you are {{role}}.", {
			name: "world",
			role: "tester",
		})
		expect(result).toBe("Hello world, you are tester.")
	})

	it("treats missing slots as empty string", () => {
		const result = fillPrompt("[{{a}}][{{b}}][{{c}}]", { a: "x" })
		expect(result).toBe("[x][][]")
	})

	it("leaves non-{{slot}} braces untouched", () => {
		const result = fillPrompt("function() { return {{x}} }", { x: "1" })
		expect(result).toBe("function() { return 1 }")
	})

	it("substitutes the same slot multiple times", () => {
		const result = fillPrompt("{{x}} and {{x}} again", { x: "boom" })
		expect(result).toBe("boom and boom again")
	})

	it("does not interpret slot values for further substitution", () => {
		// Prevents prompt-injection-style infinite loops if a value happens
		// to contain {{...}} text — the regex runs once over the template,
		// not recursively.
		const result = fillPrompt("{{outer}}", { outer: "{{nope}}", nope: "should not appear" })
		expect(result).toBe("{{nope}}")
	})
})
