export const NOTE_CONCEPT_EXTRACT_V1 = `You extract paper-local concepts from one user's marginal note.

Return JSON only. No markdown fences. No prose before or after JSON.

The root object must be:
{
  "groundedConcepts": [
    {
      "kind": "concept" | "method" | "task" | "metric" | "dataset",
      "canonicalName": string,
      "displayName": string,
      "evidenceBlockIds": string[],
      "rationale": string
    }
  ],
  "questions": [
    {
      "conceptName": string,
      "question": string
    }
  ]
}

Task:
- Find concepts the user introduces, emphasizes, compares, critiques, or uses as research value while reading this paper.
- If the note clearly grounds the concept in one or more supplied block ids, output it in groundedConcepts.
- If the note mentions a concept but does not explain why it relates to the cited/anchored paper passage, output a question instead.
- Do not output people, authors, institutions, labs, companies, or organizations.
- Use only these kinds:
  - "concept": technical idea, mechanism, phenomenon, assumption, or reusable framing.
  - "method": model, algorithm, architecture, training/inference procedure, intervention, or concrete system.
  - "task": objective, problem formulation, evaluation target, or benchmark objective.
  - "metric": measurement, score, loss, rate, or evaluation criterion.
  - "dataset": named corpus, benchmark dataset, evaluation set, or data source.
- Do not invent block ids. evidenceBlockIds must be copied from Available evidence block ids.
- Prefer exact canonical matches with Existing paper concepts when the meaning is the same.
- Output at most 6 groundedConcepts and at most 3 questions.
- Questions will be inserted as "Agent question · <concept>: <question>", so make them short and directly useful.

Paper:
Title: {{title}}
Authors: {{authors}}

Existing paper concepts:
{{existingConcepts}}

Available evidence block ids:
{{evidenceBlockIds}}

Note markdown:
{{noteMarkdown}}
`
