export const PAPER_COMPILE_WINDOW_V1 = `You are compiling one page-aware, block-grounded window from a research paper.

This is the map step of a hierarchical paper compile. Another reduce step will merge all window artifacts into one paper-level source page and concept set.

Output requirements:

- Return JSON only. No markdown fences. No prose before or after the JSON.
- The root object must be:
  {
    "windowSummary": string,
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

Window role:

- This window is page-aware, but blocks are the grounding unit.
- A block must be treated as indivisible. Never infer from only part of a block.
- primaryBlockIds are the blocks this window owns.
- contextBlockIds are included only to avoid cross-page semantic cleavage.
- Prefer concepts whose evidence includes at least one primaryBlockId.
- Use contextBlockIds only when they clarify a concept that appears in the primary blocks.

Concept extraction rules:

- Extract paper-local concepts/entities that are genuinely load-bearing within this window.
- Do not emit every noun phrase.
- Sapientia wants reading atoms, not a broad scientific keyphrase list.
- Taxonomy and reading-frame are separate:
  - kind answers what type of object this is: "concept", "method", "task", "metric", or "dataset".
  - reading-frame relevance answers why this object is worth extracting: Context, Method, Result, Critical, or Value.
- Output a candidate only when it helps answer at least one of:
  - Context: problem, gap, motivation, prior limitation, or setup.
  - Method: concrete technique, model, data, experiment, evaluation setup, or argument structure.
  - Result: measured outcome, finding, metric, benchmark, comparison, or evidence-bearing claim.
  - Critical: limitation, assumption, failure mode, confound, unsupported leap, missing experiment, or unresolved question.
  - Value: reusable method/data/claim, citation-worthy idea, comparison point, inspiration, or extension.
- Use this importance rubric before output:
  - core: required to answer Context, Method, Result, Critical, or Value as represented in this window.
  - supporting: necessary context for evidence, baselines, datasets, metrics, assumptions, ablations, limitations, or reusable value in this window.
  - incidental: related-work-only mentions, generic tools/phrases, one-off noun phrases, section labels, or terms whose removal would not affect understanding.
- Output only core and supporting candidates. Never output incidental candidates.
- Output at most 8 concepts for this window. Prefer fewer high-signal concepts over a long list.
- Window extraction may keep a single-window concept only when it is likely important to the whole paper or clearly important evidence for this window.
- Concepts only mentioned in related work are usually incidental unless this window shows that the paper directly uses, extends, or compares against them.
- Implementation details are included only when they affect the method, evidence, or conclusion.
- Datasets, metrics, and tasks are included only when they participate in the paper's actual evaluation or central comparison.
- Do not fuse across papers.
- Do not invent facts beyond the supplied blocks.
- Use exactly these kind values:
  - "concept": theoretical/technical idea, mechanism, phenomenon, assumption, or recurring term that is not itself a method/task/metric/dataset.
  - "method": named model, algorithm, architecture, training technique, inference procedure, intervention, or concrete system proposed/used by the paper.
  - "task": problem formulation or objective, such as classification, inference, detection, ranking, generation, prediction, retrieval, evaluation target, or benchmark objective.
  - "metric": named measurement, score, rate, accuracy, loss, cost, benchmark score, or evaluation criterion.
  - "dataset": named corpus, benchmark dataset, evaluation set, data source, or constructed dataset.
- Do not extract people, authors, institutions, affiliations, labs, companies, or organizations as concepts. Authors and affiliations belong to paper metadata, not the concept graph.
- A problem, objective, capability, or evaluation target is usually "task" unless the paper names it as a concrete algorithm/procedure.
- A score, measurement, rate, loss, or criterion is "metric", not "task".
- A benchmark collection or corpus is "dataset"; the score computed on it is "metric"; the problem it measures is usually "task".

Block id rules:

- Every concept must include at least one evidenceBlockIds item.
- Keep evidenceBlockIds concise: 1-3 strongest blocks per concept.
- Keep referenceBlockIds concise: at most 12 blocks for this window.
- Every evidenceBlockIds and referenceBlockIds item must be the bare block id after "#" in the parsed content header.
- Example: for "[Block #081f769b: text]", output "081f769b", not "Block #081f769b" and not the full header.

Window summary rules:

- windowSummary is for the reduce step, not for end users.
- Keep it compact: 60-130 words.
- Use these labels so the reduce step can preserve the reading frame: Context, Method, Result, Critical, Value.
- If one label has no support in this window, omit that label rather than guessing.
- Mention only claims supported by this window's blocks.
- Include block citations in markdown form such as "[blk 081f769b]" for important paper-specific claims.

Paper metadata:
Title: {{title}}
Authors: {{authors}}

Window metadata:
windowId: {{windowId}}
pageRange: {{pageRange}}
headingPath: {{headingPath}}
primaryBlockIds: {{primaryBlockIds}}
contextBlockIds: {{contextBlockIds}}

Parsed content (block-structured):
{{blocks}}
`
