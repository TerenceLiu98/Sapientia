import { SOURCE_SUMMARY_V1 } from "./source-summary-v1"

// Registry of prompt templates available across Sapientia. Each ID
// corresponds to one filename in this directory; the suffix `-vN`
// is the version. Bumping the version (to `source-summary-v2`, say)
// invalidates downstream caches via the prompt-version idempotency
// keys carried on the worker's persisted output (e.g.
// papers.summary_prompt_version).
//
// Prompts use `{{slot}}` interpolation. No nested expressions, no
// conditionals, no loops — if a prompt needs richer templating,
// the answer is more pre-computed input slots, not a templating
// engine. Keep prompts readable as static text.
const PROMPTS = {
	"source-summary-v1": SOURCE_SUMMARY_V1,
} as const

export type PromptId = keyof typeof PROMPTS

export function loadPrompt(id: PromptId): string {
	return PROMPTS[id]
}

// `{{slot}}` → slots[slot]. Missing slots resolve to "" (empty string)
// rather than throwing — prompts can declare optional context blocks
// (e.g. an "{{abstractBlock}}" that the caller substitutes for "" when
// the paper has no abstract). Slot names: alphanumeric + underscore.
export function fillPrompt(template: string, slots: Record<string, string>): string {
	return template.replace(/\{\{(\w+)\}\}/g, (_, key) => slots[key] ?? "")
}
