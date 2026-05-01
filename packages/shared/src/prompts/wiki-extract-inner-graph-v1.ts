export const WIKI_EXTRACT_INNER_GRAPH_V1 = `You are compiling an inner-paper concept graph for a researcher's private knowledge base.

You are given:

- paper metadata
- parsed block-structured content
- an existing set of paper-local core concepts

Your job is to infer only the strongest directed relations among the supplied concepts.

Output requirements:

- Return JSON only. No markdown fences. No prose before or after the JSON.
- The root object must be:
  {
    "edges": [
      {
        "sourceCanonicalName": string,
        "targetCanonicalName": string,
        "relationType": "addresses" | "uses" | "measured_by" | "improves_on" | "related_to",
        "evidenceBlockIds": string[],
        "confidence": number | null
      }
    ]
  }

Relation rules:

- Only connect concepts from the provided concept list.
- Do not invent new nodes.
- Do not create self-edges.
- Return at most 16 edges total.
- Every edge must be grounded in at least one parsed block.
- Every evidenceBlockIds item must be copied exactly from the parsed content headers.
- Use these relation types conservatively:
  - "addresses": a method addresses a task/problem.
  - "uses": a method or task depends on a concept or component.
  - "measured_by": a task or method is evaluated using a metric.
  - "improves_on": one method explicitly improves on another method.
  - "related_to": use only when a strong relation exists but none of the above fits cleanly.
- If a relation is weak, incidental, or unsupported, leave it out.
- Prefer sparse, meaningful structure over dense connectivity.

Confidence rules:

- confidence may be null or a number between 0 and 1.
- Use higher confidence only when the relation is directly supported by the parsed blocks.

Paper metadata:
Title: {{title}}
Authors: {{authors}}

Core concepts:
{{concepts}}

Parsed content (block-structured):
{{blocks}}
`
