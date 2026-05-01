export const PAPER_COMPILE_V1 = `You are compiling a paper-local knowledge artifact for a researcher's private knowledge base.

You must produce one agent-facing summary and one compact set of local concepts from the same parsed paper context.

Output requirements:

- Return JSON only. No markdown fences. No prose before or after the JSON.
- The root object must be:
  {
    "summary": string,
    "referenceBlockIds": string[],
    "concepts": [
      {
        "kind": "concept" | "method" | "task" | "metric" | "dataset" | "person" | "organization",
        "canonicalName": string,
        "displayName": string,
        "evidenceBlockIds": string[]
      }
    ]
  }

Summary requirements:

- summary must be markdown.
- Write for a downstream research agent, not for an end user.
- Cover:
  - the paper's central claim or thesis
  - the problem it addresses
  - the key methods, tasks, metrics, datasets, and concepts that actually matter
  - the most important findings
  - limitations or caveats worth remembering
- Keep the summary compact but substantive: roughly 500-1000 words.
- Avoid rhetorical framing, filler, and title restatement.
- Do not invent facts not supported by the parsed blocks.

Concept extraction rules:

- Extract only paper-local concepts/entities that are genuinely load-bearing for understanding this paper.
- Return at most 50 concepts total.
- Concepts must be derived from the parsed blocks, not from any imagined prior ontology.
- Do not try to fuse concepts across papers.
- Prefer method names, task formulations, evaluation metrics, datasets, and recurring technical terms only when they matter for this paper's argument.
- Do not include generic academic filler such as "results", "experiment", "model", "paper", "authors" unless they refer to a specific named thing.
- "person" is allowed only for paper authors or clearly author-level named people.
- "organization" is allowed only for author affiliations / institutions.
- Do not extract arbitrary people or organizations mentioned in body prose.
- canonicalName should be normalized and stable:
  - lowercase
  - trim whitespace
  - keep internal spaces when needed
  - no surrounding punctuation
- displayName should preserve the paper's ordinary surface form.
- Every concept should include at least one evidence item.
- Every evidenceBlockIds item must be copied exactly from the parsed content headers.
- If a candidate is weak or incidental, leave it out.

Reference requirements:

- referenceBlockIds should contain the block ids a UI or downstream agent can jump back to.
- Prefer blocks that best support the summary's central claims and the extracted concept list.
- Use exact block ids copied from the parsed content.
- Include enough block ids to ground the summary, but do not dump everything.

Paper metadata:
Title: {{title}}
Authors: {{authors}}
{{abstractBlock}}

Parsed content (block-structured):
{{blocks}}
`
