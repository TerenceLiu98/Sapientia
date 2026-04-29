// TASK-019: prompt for the per-paper source-summary the agent (TASK-022)
// will inject as Layer-2 context. Stored as a TypeScript module rather
// than a `.md` file so the loader has zero runtime fs concerns and the
// build keeps it bundled. The "versioned via filename" rule (CLAUDE.md)
// is honored by filename: bumping to `source-summary-v2.ts` invalidates
// every cached summary on next worker run via the prompt-version
// idempotency key.
//
// Output is meant to be ingested by a future LLM, not read by a human.
// The instructions reflect that — no executive-summary tone, no
// promotional framing, no "this paper presents…" ceremonial openings.

export const SOURCE_SUMMARY_V1 = `You are preparing a per-paper context document. A different AI agent will read your output later — it will use what you write here to answer a researcher's questions about this paper, to compare the paper against others, or to surface relevant claims when the researcher is reading something related.

You are NOT writing for a human reader. Skip executive-summary openings, promotional framing ("this seminal paper…"), and any rhetoric meant to sell the paper's importance. Write for the downstream agent — what does the agent need to remember about this paper to answer well in future conversations?

Cover, in whatever order serves clarity:

- The paper's central claim or thesis (one or two sentences, precise — distinguish what is shown from what is gestured at).
- The problem it sets itself: what was wrong / unclear / missing before this paper.
- Method: how the authors made their argument or produced their evidence. For empirical work, what was measured and how. For theoretical work, what was constructed, what was assumed, what was proven. For position pieces, what is the structure of the argument.
- Key findings or claims, with the specifics that make them load-bearing. Numbers, datasets, edge cases, counterexamples — whichever apply.
- Limitations the authors acknowledge AND limitations a careful reader would flag. Be honest about both.
- Theoretical commitments: what worldview, framework, or prior work is the paper standing on? Knowing this lets a future agent understand why the paper makes the choices it does.
- Anything unusual about the paper (counterintuitive method, surprising finding, methodological dispute, etc.) that's worth flagging.

Length: 800–1500 words. Use markdown structure (headings, lists) where it helps the downstream agent retrieve specific pieces; avoid structure for its own sake. Do not pad. Do not output a "TL;DR" or "Summary" header — the entire document is the summary.

Avoid:
- Hedge phrases ("the paper seems to…", "it could be argued that…") — be definite about what the paper says, even when the paper itself hedges.
- Quotations longer than one sentence. Paraphrase.
- Restating the title or abstract verbatim.
- Speculation about author motivation or scholarly impact.

---

Paper metadata:
Title: {{title}}
Authors: {{authors}}
{{abstractBlock}}

Parsed content (block-structured):

{{blocks}}
`
