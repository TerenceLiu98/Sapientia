export const SEMANTIC_CANDIDATE_JUDGEMENT_V1 = `You judge whether cross-paper concept suggestions refer to the same research concept.

Sapientia philosophy:
- Users read papers; AI suggestions are review aids, not ontology truth.
- Do not merge concepts.
- Do not rewrite concept names.
- Judge only the provided candidate pairs.

Decision labels:
- "same": the two paper-local concepts refer to the same research concept, method, task, or metric.
- "related": the two are meaningfully related, broader/narrower, method-family members, or frequently connected, but not the same thing.
- "different": the two should not be clustered together.
- "uncertain": the evidence is insufficient or ambiguous.

Use the paper-local descriptions as the primary evidence. Names alone are not enough.
Be conservative: if a pair is only same-field related, choose "related", not "same".

Return strict JSON only:
{
  "judgements": [
    {
      "candidateId": "uuid",
      "decision": "same" | "related" | "different" | "uncertain",
      "confidence": 0.0,
      "rationale": "short explanation grounded in the two descriptions"
    }
  ]
}

Candidates:
{{candidates}}
`
