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
        "kind": "concept" | "method" | "task" | "metric" | "dataset",
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
- Reduce is the final paper-level importance filter. A candidate that was useful within one window can still be too local for the final paper concept set.
- Sapientia wants reading atoms, not a broad scientific keyphrase list.
- Taxonomy and reading-frame are separate:
  - kind answers what type of object this is: "concept", "method", "task", "metric", or "dataset".
  - reading-frame relevance answers why this object is worth extracting: Context, Method, Result, Critical, or Value.
- Keep a candidate only when it helps answer at least one of:
  - Context: problem, gap, motivation, prior limitation, or setup.
  - Method: concrete technique, model, data, experiment, evaluation setup, or argument structure.
  - Result: measured outcome, finding, metric, benchmark, comparison, or evidence-bearing claim.
  - Critical: limitation, assumption, failure mode, confound, unsupported leap, missing experiment, or unresolved question.
  - Value: reusable method/data/claim, citation-worthy idea, comparison point, inspiration, or extension.
- Keep only candidates that are core or supporting at the whole-paper level:
  - core: required to answer Context, Method, Result, Critical, or Value.
  - supporting: necessary context for evidence, baselines, datasets, metrics, assumptions, ablations, limitations, or reusable value.
- Drop incidental candidates:
  - related-work-only mentions unless the paper directly uses, extends, or compares against them
  - generic tools/phrases and one-off noun phrases
  - section labels and ordinary academic terms
  - implementation details that do not affect the method, evidence, or conclusion
- Keep datasets, metrics, and tasks only when they participate in the paper's actual evaluation or central comparison.

Taxonomy rules:

- Use exactly these kind values:
  - "concept"
  - "method"
  - "task"
  - "metric"
  - "dataset"
- A problem, objective, capability, or evaluation target is usually "task" unless the paper names it as a concrete algorithm/procedure.
- A score, measurement, rate, loss, or criterion is "metric", not "task".
- A model, algorithm, architecture, prompting strategy, fine-tuning method, adapter method, or training recipe is usually "method".
- A benchmark collection or corpus is "dataset"; the score computed on it is "metric"; the problem it measures is usually "task".
- Do not extract people, authors, institutions, affiliations, labs, companies, or organizations as concepts. Authors and affiliations belong to paper metadata, not the concept graph.

Evidence rules:

- Every concept must include at least one evidenceBlockIds item copied from the window artifacts.
- Every evidenceBlockIds and referenceBlockIds item must be a bare block id.
- Prefer evidence that directly defines, introduces, evaluates, or uses the concept.
- referenceBlockIds are for grounding the paper-level source summary, not for storing every concept evidence block.
- Do not dump all window references or every concept evidence block into referenceBlockIds.
- Select the most important blocks that support the summary's central claims, methods, tasks, metrics, findings, and caveats.
- For normal papers, aim for roughly 20-60 referenceBlockIds. Use fewer for short papers and more only when the summary genuinely needs them.

Summary rules:

- summary must be markdown with exactly these section headings:
  - "## Context"
  - "## Method"
  - "## Result"
  - "## Critical"
  - "## Value"
- Write for a downstream research agent, not for an end user.
- Synthesize across all windows.
- Context: identify the specific academic or practical problem, gap in prior work, and why this paper is needed.
- Method: describe the concrete model, technique, data, experimental design, evaluation setup, or argument structure used.
- Result: state the core findings and whether the reported evidence supports the conclusion.
- Critical: identify limitations, unsupported leaps, weak evidence, confounds, missing experiments, or unresolved questions. Be fair but skeptical.
- Value: identify why this paper may matter to a researcher: reusable claims, methods, datasets, evaluation setups, citations, inspirations, or follow-up ideas.
- Include concise block citations such as "[blk 081f769b]" for important paper-specific claims when available from window summaries.
- Keep the summary compact but substantive: roughly 500-1000 words.
- Distinguish what the paper demonstrates from what it merely claims or gestures toward.
- Do not present the summary as user-facing reading replacement.

Paper metadata:
Title: {{title}}
Authors: {{authors}}

Window artifacts:
{{windowArtifacts}}
`
