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
		expect(template).toContain("Every substantive factual claim must include one or more inline block citations")
	})

	it("returns the agent-summon-v2 template", () => {
		const template = loadPrompt("agent-summon-v2")
		expect(template).toContain("Evidence threshold")
		expect(template).toContain("do not have enough evidence in the current paper context")
	})

	it("returns the paper-compile-v1 template", () => {
		const template = loadPrompt("paper-compile-v1")
		expect(template).toContain("\"summary\"")
		expect(template).toContain("\"referenceBlockIds\"")
		expect(template).toContain("\"concepts\"")
		expect(template).toContain("one agent-facing summary")
		expect(template).toContain("Return at most 50 concepts total")
		expect(template).toContain("{{blocks}}")
	})

	it("returns the wiki-extract-inner-graph-v1 template", () => {
		const template = loadPrompt("wiki-extract-inner-graph-v1")
		expect(template).toContain("\"edges\"")
		expect(template).toContain("\"sourceCanonicalName\"")
		expect(template).toContain("\"targetCanonicalName\"")
		expect(template).toContain("\"relationType\"")
		expect(template).toContain("\"evidenceBlockIds\"")
		expect(template).toContain("Return at most 16 edges total")
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
