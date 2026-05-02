export const PAPER_COMPILE_REDUCE_V1 = `You are reducing page-aware window compile artifacts into one paper-level knowledge artifact.

You are given:

- paper metadata
- window summaries
- window-local concept candidates with evidence block ids
- reference block candidates

Your job is to merge duplicates, remove local noise, and produce one agent-facing summary plus one paper-local concept set.

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

Reduce rules:

- Merge concept candidates that clearly refer to the same paper-local concept.
- Preserve aliases implicitly by choosing the clearest displayName and a stable canonicalName.
- Keep duplicate concepts separate when their meanings are ambiguous or evidence suggests different roles.
- Do not invent concepts that are not supported by window artifacts.
- Do not drop load-bearing concepts only because they appear late in the paper.
- Prefer concepts supported by multiple windows or central evidence, but keep single-window concepts when they are important.
- Remove local noise such as generic section labels, "experiment", "results", "paper", or incidental noun phrases.

Taxonomy rules:

- Use exactly these kind values:
  - "concept"
  - "method"
  - "task"
  - "metric"
  - "dataset"
  - "person"
  - "organization"
- A problem, objective, capability, or evaluation target is usually "task" unless the paper names it as a concrete algorithm/procedure.
- A score, measurement, rate, loss, or criterion is "metric", not "task".
- A model, algorithm, architecture, prompting strategy, fine-tuning method, adapter method, or training recipe is usually "method".
- A benchmark collection or corpus is "dataset"; the score computed on it is "metric"; the problem it measures is usually "task".
- "person" is allowed only for paper authors or clearly author-level named people.
- "organization" is allowed only for author affiliations / institutions.

Evidence rules:

- Every concept must include at least one evidenceBlockIds item copied from the window artifacts.
- Every evidenceBlockIds and referenceBlockIds item must be a bare block id.
- Prefer evidence that directly defines, introduces, evaluates, or uses the concept.
- referenceBlockIds are for grounding the paper-level source summary, not for storing every concept evidence block.
- Do not dump all window references or every concept evidence block into referenceBlockIds.
- Select the most important blocks that support the summary's central claims, methods, tasks, metrics, findings, and caveats.
- For normal papers, aim for roughly 20-60 referenceBlockIds. Use fewer for short papers and more only when the summary genuinely needs them.

Summary rules:

- summary must be markdown.
- Write for a downstream research agent, not for an end user.
- Synthesize across all windows.
- Cover the paper's central claim, problem, methods, tasks, metrics, datasets, important findings, and caveats.
- Include concise block citations such as "[blk 081f769b]" for important paper-specific claims when available from window summaries.
- Keep the summary compact but substantive: roughly 500-1000 words.
- Do not present the summary as user-facing reading replacement.

Paper metadata:
Title: {{title}}
Authors: {{authors}}

Window artifacts:
{{windowArtifacts}}
`
