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
- For a typical paper, aim for roughly 10-24 high-quality edges when evidence exists, but do not omit strong evidence-grounded relations only to hit a fixed count.
- Every edge must be grounded in at least one parsed block.
- Every evidenceBlockIds item must be the bare block id after "#" in the parsed content header.
- Example: for "[Block #081f769b: text]", output "081f769b", not "Block #081f769b" and not the full header.
- Use these relation types conservatively:
  - "addresses": source is a method; target is the task/problem it addresses. Direction: method -> task.
  - "uses": source is a method/task; target is a concept, component, dataset, or supporting method it depends on. Direction: user -> used thing.
  - "measured_by": source is a task or method; target is the metric used to evaluate it. Direction: evaluated thing -> metric.
  - "improves_on": source is the newer/proposed method; target is the older/baseline method it explicitly improves on. Direction: newer method -> older method.
  - "related_to": use only when a strong relation exists but none of the above fits cleanly.
- Always output the canonical direction above even if the sentence in the paper is phrased in reverse.
- Example: if the paper says "Task T is solved by Method M", output sourceCanonicalName = Method M, targetCanonicalName = Task T, relationType = "addresses".
- Example: if the paper says "Metric F evaluates Task T", output sourceCanonicalName = Task T, targetCanonicalName = Metric F, relationType = "measured_by".
- If a relation is weak, incidental, or unsupported, leave it out.
- Prefer sparse, meaningful structure over dense connectivity.
- Return zero edges when the provided concepts do not have strong block-supported relations.
- Prefer graph-visible core concepts: concept, method, task, and metric. Do not force dataset/person/organization into the graph unless they are present in the supplied concept list and essential to a strong relation.
- Avoid vague "related_to" edges when a more specific relation is available.

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
