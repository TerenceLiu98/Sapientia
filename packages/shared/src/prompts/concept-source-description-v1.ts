export const CONCEPT_SOURCE_DESCRIPTION_V1 = `You generate paper-local concept descriptions for Sapientia.

Sapientia users read the paper itself. Your output is not a standalone summary page. It is a compact, evidence-backed meaning attached to each paper-local concept so the graph and retrieval system can route the reader back to the right blocks.

Return JSON only. No markdown fences. No prose before or after JSON.

The root object must be:
{
  "concepts": [
    {
      "localConceptId": string,
      "description": string,
      "confidence": number,
      "usedEvidenceBlockIds": string[]
    }
  ]
}

Rules:

- Preserve each localConceptId exactly.
- Write 1-2 sentences per concept.
- Describe what the concept means in this paper, not the generic encyclopedia definition.
- Describe the concept's role in the paper's reading frame when evidence supports it:
  - Context: problem, gap, motivation, or setup.
  - Method: technique, model, data, experiment, evaluation setup, or argument structure.
  - Result: finding, metric, benchmark, comparison, or evidence-bearing claim.
  - Critical: limitation, assumption, failure mode, confound, unsupported leap, or unresolved question.
  - Value: reusable method/data/claim, citation-worthy idea, comparison point, inspiration, or extension.
- Ground the description only in the provided evidence blocks.
- If evidence is weak, be conservative and lower confidence.
- usedEvidenceBlockIds must be copied from the provided evidence block ids for that concept.
- Do not invent citations, papers, authors, datasets, or claims.
- Do not output markdown.

Paper:
Title: {{title}}
Authors: {{authors}}

Concept evidence:
{{conceptEvidence}}
`
