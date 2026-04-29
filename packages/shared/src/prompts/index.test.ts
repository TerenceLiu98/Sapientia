import { describe, expect, it } from "vitest"
import { fillPrompt, loadPrompt } from "./index"

describe("loadPrompt", () => {
	it("returns the source-summary-v1 template", () => {
		const template = loadPrompt("source-summary-v1")
		expect(template).toContain("{{title}}")
		expect(template).toContain("{{authors}}")
		expect(template).toContain("{{blocks}}")
		expect(template).toContain("{{abstractBlock}}")
		// Sanity-check key framing (downstream-LLM, not human-summary).
		expect(template).toContain("downstream agent")
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
