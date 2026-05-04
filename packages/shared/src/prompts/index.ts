import { AGENT_SUMMON_V1 } from "./agent-summon-v1"
import { AGENT_SUMMON_V2 } from "./agent-summon-v2"
import { CONCEPT_SOURCE_DESCRIPTION_V1 } from "./concept-source-description-v1"
import { NOTE_CONCEPT_EXTRACT_V1 } from "./note-concept-extract-v1"
import { PAPER_COMPILE_V1 } from "./paper-compile-v1"
import { PAPER_COMPILE_REDUCE_V1 } from "./paper-compile-reduce-v1"
import { PAPER_COMPILE_WINDOW_V1 } from "./paper-compile-window-v1"
import { SEMANTIC_CANDIDATE_JUDGEMENT_V1 } from "./semantic-candidate-judgement-v1"
import { SOURCE_SUMMARY_V1 } from "./source-summary-v1"
import { SOURCE_SUMMARY_V2 } from "./source-summary-v2"
import { WIKI_EXTRACT_INNER_GRAPH_V1 } from "./wiki-extract-inner-graph-v1"

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
	"agent-summon-v1": AGENT_SUMMON_V1,
	"agent-summon-v2": AGENT_SUMMON_V2,
	"concept-source-description-v1": CONCEPT_SOURCE_DESCRIPTION_V1,
	"note-concept-extract-v1": NOTE_CONCEPT_EXTRACT_V1,
	"paper-compile-reduce-v1": PAPER_COMPILE_REDUCE_V1,
	"paper-compile-v1": PAPER_COMPILE_V1,
	"paper-compile-window-v1": PAPER_COMPILE_WINDOW_V1,
	"semantic-candidate-judgement-v1": SEMANTIC_CANDIDATE_JUDGEMENT_V1,
	"source-summary-v1": SOURCE_SUMMARY_V1,
	"source-summary-v2": SOURCE_SUMMARY_V2,
	"wiki-extract-inner-graph-v1": WIKI_EXTRACT_INNER_GRAPH_V1,
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
