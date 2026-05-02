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
- For a normal research paper, aim for roughly 12-35 concepts when enough evidence exists, but do not omit load-bearing concepts only to hit a fixed count.
- Concepts must be derived from the parsed blocks, not from any imagined prior ontology.
- Do not try to fuse concepts across papers.
- Prefer method names, task formulations, evaluation metrics, datasets, and recurring technical terms only when they matter for this paper's argument.
- Do not include generic academic filler such as "results", "experiment", "model", "paper", "authors" unless they refer to a specific named thing.
- "person" is allowed only for paper authors or clearly author-level named people.
- "organization" is allowed only for author affiliations / institutions.
- Do not extract arbitrary people or organizations mentioned in body prose.
- Use exactly these kind values:
  - "concept": a theoretical/technical idea, mechanism, phenomenon, assumption, or recurring term that is not itself a method/task/metric/dataset.
  - "method": a named model, algorithm, architecture, training technique, inference procedure, intervention, or concrete system proposed/used by the paper.
  - "task": a problem formulation or objective, such as classification, inference, detection, ranking, generation, prediction, retrieval, evaluation target, or benchmark objective.
  - "metric": a named measurement, score, rate, accuracy, loss, cost, benchmark score, or evaluation criterion.
  - "dataset": a named corpus, benchmark dataset, evaluation set, data source, or constructed dataset.
  - "person": paper authors or clearly author-level named people only.
  - "organization": author affiliations/institutions only.
- Taxonomy boundary rules:
  - Zero-shot classification, few-shot classification, natural language inference, detection, ranking, retrieval, prediction, and generation are usually "task" when they name what the paper is trying to solve.
  - A model, algorithm, architecture, prompting strategy, fine-tuning method, adapter method, or training recipe is usually "method".
  - A benchmark collection or corpus is "dataset"; the score computed on it is "metric"; the problem it measures is usually "task".
  - A problem, objective, capability, or evaluation target is usually "task" unless the paper names it as a concrete algorithm/procedure.
  - A score, measurement, rate, loss, or criterion is "metric", not "task".
  - If a term could be both a general concept and a task, choose "task" when the paper evaluates performance on that objective.
  - If a term could be both a concept and a method, choose "method" only when the paper uses it as a concrete procedure or system.
- Positive examples:
  - A named model or algorithm introduced by the paper -> "method".
  - The objective the paper evaluates, such as a classification, retrieval, ranking, or inference objective -> "task".
  - A named benchmark corpus or evaluation set -> "dataset".
  - A named score, accuracy, rate, loss, or benchmark measurement -> "metric".
  - A broad technique family or theoretical idea -> "concept" unless the paper uses a specific instance as a concrete method.
- Negative examples:
  - Do not label "classification" as "method" when it is the objective being evaluated.
  - Do not label an institution mentioned only in related work as "organization".
  - Do not include "experiment" or "results" as concepts.
- canonicalName should be normalized and stable:
  - lowercase
  - trim whitespace
  - keep internal spaces when needed
  - preserve meaningful balanced parentheticals such as "(peft)"
  - no surrounding punctuation
- displayName should preserve the paper's ordinary surface form.
- Every concept should include at least one evidence item.
- Every evidenceBlockIds item must be the bare block id after "#" in the parsed content header.
- Example: for "[Block #081f769b: text]", output "081f769b", not "Block #081f769b" and not the full header.
- If a candidate is weak or incidental, leave it out.

Reference requirements:

- referenceBlockIds should contain the block ids a UI or downstream agent can jump back to.
- Prefer blocks that best support the summary's central claims and the extracted concept list.
- Use bare block ids copied from the parsed content headers.
- Example: for "[Block #081f769b: text]", output "081f769b", not "Block #081f769b" and not the full header.
- Do not output rendered citations such as "[blk 081f769b]" in referenceBlockIds or evidenceBlockIds; output only "081f769b".
- Include enough block ids to ground the summary, but do not dump everything.

Paper metadata:
Title: {{title}}
Authors: {{authors}}
{{abstractBlock}}

Parsed content (block-structured):
{{blocks}}

Final output reminder:

- Return exactly one JSON object with all three required root fields: "summary", "referenceBlockIds", and "concepts".
- For a normal parsed research paper, "referenceBlockIds" must not be empty.
- For a normal parsed research paper, "concepts" must not be empty; extract roughly 12-35 load-bearing concepts/entities when evidence exists, and include more when the paper genuinely needs them.
- Every concept must include at least one valid evidenceBlockIds entry copied as the bare id after "#" in a parsed content header.
- Every concept kind must be exactly one of: "concept", "method", "task", "metric", "dataset", "person", "organization".
- If you omit "referenceBlockIds" or "concepts", the compile result is invalid.
`
