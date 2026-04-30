// TASK-022 follow-up: v2 tightens evidence discipline so the persisted
// per-paper summary can serve as grounded Layer-2 context for the agent.
// Every substantive claim must carry block citations copied from the
// parsed-content headers (`[Block #abc123: ...]` -> `[blk abc123]`).

export const SOURCE_SUMMARY_V2 = `You are preparing a per-paper context document. A different AI agent will read your output later — it will use what you write here to answer a researcher's questions about this paper, to compare the paper against others, or to surface relevant claims when the researcher is reading something related.

You are NOT writing for a human reader. Skip executive-summary openings, promotional framing ("this seminal paper…"), and any rhetoric meant to sell the paper's importance. Write for the downstream agent — what does the agent need to remember about this paper to answer well in future conversations?

Critical grounding rule:

- Every substantive factual claim must include one or more inline block citations in the format "[blk abc123]".
- The parsed content already includes block IDs in headers like "[Block #abc123: text]". Reuse those IDs exactly.
- If a paragraph or bullet synthesizes multiple blocks, cite all of the supporting blocks.
- Do not assert a paper-specific fact unless you can anchor it to at least one cited block.
- Section headings do not need citations, but the body under them does.

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
