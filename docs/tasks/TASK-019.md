# TASK-019: Source-summary auto-generation (per paper)

**Estimated effort**: 1-2 working days
**Depends on**: TASK-010 (MinerU parse + blocks), TASK-011 (block schema), `services/credentials.ts` (already shipped)
**Phase**: 3 — Zettelkasten Output (first card)

---

## Context

This is the first AI-side card. After a paper is uploaded and MinerU parses it into blocks, a worker job calls the user's LLM and produces a single markdown summary of the paper. The summary is **not for users to read** — it's a context artifact the agent (TASK-022) will inject into prompts when the user summons it on this paper. Think of it as Layer-2 context cache, prepared once per paper.

Two consequences flow from "agent-only consumer":

1. **No UI surface.** No new view mode, no settings panel, no "regenerate" button. The summary lives in the database, gets read at agent-summon time, and that's it.
2. **Format optimized for LLM ingestion, not human reading.** Free-form markdown the model decides to structure however helps a future answer-the-user task — not a fixed 4-section human-friendly template.

This card also ships the **first cut of `apps/api/src/services/llm-client.ts`** — the single entry point CLAUDE.md mandates for all LLM calls. TASK-019's needs are minimal (single-turn, non-streaming `complete()`), but this first cut should already be compatible with the product's credential model: users provide their own LLM configuration, including **provider mode** (`openai` or `anthropic`), **API key**, and optional **base URL**. TASK-022 later adds streaming/chat transport, but TASK-019 should avoid painting us into a "official endpoints only" corner.

---

## Acceptance Criteria

1. **Schema migration** — `papers` table grows `summary`, `summary_status`, `summary_generated_at`, `summary_model`, `summary_prompt_version`, `summary_error` columns. No new tables.
2. **`llm-client.ts` shipped** with a `complete()` interface — non-streaming, per-user provider config from `getLlmCredential(userId)`, structured logging that **never** captures prompt or response content (per CLAUDE.md privacy rule), token counts + latency surfaced.
3. **`source-summary-v1.md` prompt** lives in `packages/shared/src/prompts/`, loaded by ID from the worker.
4. **`paper-summarize` queue + worker** with BullMQ idempotency: dedup by paper id, skip when `(summary_model, summary_prompt_version, current_model, current_prompt_version)` all match (re-runs only when something invalidating changed).
5. **Auto-trigger** at the end of `paper-parse.worker.ts` — when parse completes, enqueue paper-summarize. Failures don't block parse success.
6. **Failure surfaces in `summary_status`** (`pending` / `running` / `done` / `failed` / `no-credentials`). Errors store a short message in `summary_error`. No retries beyond BullMQ's default 3 attempts for transient failures; permanent failures (no credentials, invalid API key, content too long) skip retry.
7. **No UI changes.** TopBar, reader workspace, settings — none touched.
8. **Tests** — schema migration up/down, llm-client, worker idempotency, worker no-credentials path, end-to-end (mocked LLM) producing a non-empty summary.

---

## Schema

### Migration: add summary columns to `papers`

```typescript
// packages/db/src/schema/papers.ts — added fields
summary: text("summary"),
summaryStatus: text("summary_status", {
  enum: ["pending", "running", "done", "failed", "no-credentials"],
}).notNull().default("pending"),
summaryGeneratedAt: timestamp("summary_generated_at", { withTimezone: true }),
summaryModel: text("summary_model"),
summaryPromptVersion: text("summary_prompt_version"),
summaryError: text("summary_error"),
```

### Notes

- `summary` is nullable — null means "never generated yet"; an empty string would be a different (pathological) state.
- `summaryModel` records the canonical model name we used (e.g. `claude-sonnet-4-6`). On model upgrade the idempotency check sees a mismatch and re-runs; otherwise idempotent.
- `summaryPromptVersion` records the prompt file's filename (e.g. `source-summary-v1`). Bumping the prompt to `-v2` invalidates all existing summaries cleanly.
- No FK to user — the summary is paper-scoped, not user-scoped, even though it was *generated* using a particular user's API key. (If a different user opens the same paper, they reuse the cached summary.)
- `summary_error` is bounded to ~500 chars in worker code, same as `parseError`.

### Why on `papers` and not a separate `paper_summaries` table

- Summary is single-version-current per paper (no history kept).
- ~1-3 KB per paper — well within Postgres comfort zone for a text column.
- 1:1 lifecycle with the paper: deleting a paper deletes the summary; soft-delete is fine.
- No 1:N relationships either way.

If TASK-020 (wiki ingestion) later needs to store multi-record entities/concepts per paper, those go in their own `wiki_pages` table. The two are different shapes.

---

## LLM client

### `apps/api/src/services/llm-client.ts`

Single module, single entry point. v0.1 shape:

```typescript
export interface CompleteParams {
  userId: string
  workspaceId: string
  promptId: string         // e.g. "source-summary-v1"
  model: string            // canonical name; e.g. "claude-sonnet-4-6"
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>
  maxTokens?: number       // default 2048
  temperature?: number     // default 0.4
}

export interface CompleteResult {
  text: string
  inputTokens: number
  outputTokens: number
  latencyMs: number
  model: string            // echo of the model that actually answered
}

export class LlmCredentialMissingError extends Error { /* ... */ }
export class LlmCallError extends Error {
  permanent: boolean       // true → don't retry (auth, content-too-long, content policy)
}

export async function complete(params: CompleteParams): Promise<CompleteResult>
```

### Provider selection

- Implement `llm-client.ts` on top of **AI SDK Core** so TASK-019 and TASK-022 share the same abstraction path.
- `getLlmCredential(userId)` should be treated as returning the user's LLM configuration:
  - `provider`
  - `apiKey`
  - optional `baseURL`
- Branch on `provider`:
  - `"anthropic"` → create an Anthropic provider instance with the user's API key and optional base URL
  - `"openai"` → create an **OpenAI-compatible** provider instance with the user's API key and optional base URL
- The important product meaning of `"openai"` here is **OpenAI-style API**, not "must be api.openai.com". This mode should work for official OpenAI and third-party OpenAI-compatible endpoints.
- Use AI SDK Core's non-streaming text generation path for `complete()`. TASK-022 later extends the same module with streaming.

### Dependency direction

Expected packages for this card:

- `ai`
- `@ai-sdk/anthropic`
- `@ai-sdk/openai-compatible`

Do **not** add:

- `ai-gateway`

Do **not** enable:

- AI SDK telemetry / `experimental_telemetry`

### Logging discipline (CLAUDE.md, hard rule)

```typescript
logger.info({
  userId, workspaceId, promptId, model,
  inputTokens, outputTokens, latencyMs,
  provider,
}, "llm_call")
// NEVER log: messages, params.messages.content, response.text
```

Errors: log `error.message` only (which is our own thrown message), never the raw provider response if it might contain prompt fragments.

### What this v0.1 deliberately does NOT do

- No streaming / SSE — TASK-022 will add when chat needs it.
- No tool calling — v0.2.
- No conversation history / threading — single-shot.
- No retry on transient errors — let BullMQ handle that at the job level.
- No prompt caching (Anthropic feature) — too fiddly for the first cut.
- No AI Gateway.
- No telemetry integrations; Sapientia owns logging itself.

---

## Prompt

### `packages/shared/src/prompts/source-summary-v1.md`

Single file, plain markdown. The worker loads it as a string template.

Spec for the prompt content:
- Frame: "You are preparing a context document about an academic paper for a future AI agent. The agent will use your summary to answer questions about this paper or to compare it with others."
- Input slots (templated): `{{title}}`, `{{authors}}`, `{{abstract}}`, `{{blocks}}`.
- Block formatting: re-use `formatBlocksForAgent()` (already shipped in `packages/shared/src/format-blocks-for-agent.ts`) so blocks come in with the same structure TASK-022 will see.
- Output instructions: 800-1500 words, free-form markdown, prioritize claim, method, key findings, limitations, theoretical commitments. Tell the model NOT to write a "human reading" abstract — it's a downstream-LLM-consumable.

The template loader is a tiny helper:

```typescript
// packages/shared/src/prompts/index.ts
export async function loadPrompt(id: string): Promise<string>
export function fillPrompt(template: string, slots: Record<string, string>): string
```

`loadPrompt` reads from disk via `import.meta.url` (or a build-time inline), `fillPrompt` does `{{slot}}` substitution. **Don't** add Handlebars or any templating dep — string replace is enough.

---

## Worker

### `apps/api/src/queues/paper-summarize.ts`

```typescript
export const PAPER_SUMMARIZE_QUEUE = "paper-summarize"

export interface PaperSummarizeJobData {
  paperId: string
  userId: string
  workspaceId: string
}

export interface PaperSummarizeJobResult {
  paperId: string
  status: "done" | "skipped" | "no-credentials"
  generatedAt?: string
}

export const paperSummarizeQueue = new Queue<PaperSummarizeJobData, PaperSummarizeJobResult>(...)
export async function enqueuePaperSummarize(data: PaperSummarizeJobData)
```

### `apps/api/src/workers/paper-summarize.worker.ts`

```typescript
const CURRENT_MODEL = "claude-sonnet-4-6"  // bumped intentionally on model upgrade
const CURRENT_PROMPT_VERSION = "source-summary-v1"

async function processPaperSummarize(job): Promise<PaperSummarizeJobResult> {
  // 1. Load paper + check idempotency. If summary exists with matching
  //    model + prompt version, mark status=done if needed and return.
  // 2. Mark status=running.
  // 3. Load credentials. Missing → status=no-credentials, return (NOT throw).
  // 4. Load blocks for this paper, format via formatBlocksForAgent.
  // 5. Load prompt template, fill slots.
  // 6. complete() the LLM call.
  // 7. Persist summary + status=done + summaryGeneratedAt + summaryModel +
  //    summaryPromptVersion + clear summaryError.
}
```

Failure handler (BullMQ `worker.on('failed')` pattern, mirrored from `paper-parse.worker.ts`):

- Permanent error → status=failed, error message saved, no retry.
- Transient → BullMQ retries via default options (3 attempts, exponential backoff). Status remains `running` between attempts; only flips to `failed` on the final attempt.
- `LlmCredentialMissingError` → status=no-credentials, return cleanly (no failed status, no retry).

### Idempotency

```typescript
// At the top of processPaperSummarize:
if (
  paper.summary &&
  paper.summaryModel === CURRENT_MODEL &&
  paper.summaryPromptVersion === CURRENT_PROMPT_VERSION &&
  paper.summaryStatus === "done"
) {
  log.info("summary already up-to-date, skipping")
  return { paperId, status: "skipped" }
}
```

This guarantees re-running the worker on the same paper doesn't burn LLM tokens.

### BullMQ enqueue

- Same pattern as paper-parse: `jobId: paper-summarize-${paperId}` so an in-flight job de-dups a second add().
- Default attempts 3, exponential backoff. Override only if a real reason emerges.

---

## Trigger wiring

In `apps/api/src/workers/paper-parse.worker.ts`, after the line that sets `parseStatus: "done"` (currently around L182-189):

```typescript
// Auto-enqueue summarization. Best-effort: a failure here doesn't block
// parse from being marked done — the user can still highlight, take
// notes, etc. without an LLM summary. The summary is only useful when
// the agent (TASK-022) is invoked, so a missing one is recoverable.
try {
  await enqueuePaperSummarize({
    paperId,
    userId,
    workspaceId: paper.workspaceId,
  })
} catch (err) {
  log.warn({ err }, "paper_summarize_enqueue_failed")
}
```

Don't wrap parse status update inside this try. Parse stays done either way.

### Also: register the worker in `apps/api/src/worker.ts`

The existing worker entry point starts paper-parse-worker and paper-enrich-worker. Add paper-summarize-worker here too.

---

## Tests

### Schema migration test (`packages/db`)
- Apply migration; verify columns exist and have correct types/defaults.

### LLM client test (`apps/api/src/services/llm-client.test.ts`)
- Mock the AI SDK/provider layer or intercept fetch beneath it. For each provider mode:
  - `anthropic` happy path: returns `{ text, inputTokens, outputTokens, latencyMs }` matching the mocked response.
  - `openai` happy path with a custom `baseURL`: same assertion.
  - 401 → throws `LlmCallError` with `permanent: true`.
  - 5xx → throws `LlmCallError` with `permanent: false`.
  - Missing credentials (mock `getLlmCredential` returns null) → throws `LlmCredentialMissingError`.
- **Privacy assertion**: spy on logger; assert no log call's serialized payload contains the test prompt's content.
- **Config assertion**: ensure telemetry is not enabled and custom `baseURL` is passed through when present.

### Worker idempotency test (`apps/api/src/workers/paper-summarize.worker.test.ts`)
- Seed a paper with matching `summaryModel` + `summaryPromptVersion` + status=done. Run worker. Assert: no LLM call made, returns `status: "skipped"`, `summary` text unchanged.
- Seed with mismatched `summaryPromptVersion`. Run worker. Assert: LLM called once, `summary` overwritten, `summaryPromptVersion` updated.

### Worker no-credentials test
- Mock `getLlmCredential` returns null. Run worker. Assert: no LLM call, status=no-credentials persisted, no `failed` status, no error thrown to BullMQ.

### End-to-end test (`apps/api/src/workers/paper-summarize.worker.e2e.test.ts`)
- Use testcontainers Postgres + Redis (existing pattern). Seed paper with blocks. Mock `complete()` (intercept fetch) to return `"## Summary\n\nThe paper argues that..."`.
- Trigger worker. Assert: `papers.summary` populated, status=done, generatedAt set.

### What we don't test
- Real LLM API calls (cost + flakiness).
- Prompt content correctness (subjective; manual review at first).
- UI changes (none in this task).

---

## Risks

1. **Model name drift.** Anthropic and OpenAI rename / deprecate models. CLAUDE.md states current canonical names (claude-sonnet-4-6 etc); `CURRENT_MODEL` constant at top of worker is the single edit point when those move.

2. **Block-formatter token bloat.** `formatBlocksForAgent()` was sized for highlights-on-blocks context, not whole-paper-summary context. A long paper might exceed model context. Mitigation: at worker start, count input characters; if > some threshold (~120k chars / ~30k tokens for Sonnet's window), truncate to first N blocks + a synthesized "[N more blocks omitted]" footer. Defer optimization until a paper actually trips this.

3. **API key invalid mid-flow.** User saved a working key, it expired. LLM call returns 401 → throw `LlmCallError(permanent: true)` → status=failed with error "API key invalid". User updates the key in Settings → can manually retry by deleting `summary_status` and re-enqueueing (a rare admin path; not building a UI for it in v0.1).

4. **Worker queue ordering.** Paper-parse finishes → enqueues summarize. If the worker process is down at that moment, the BullMQ job sits in Redis until the worker comes up. Fine — that's BullMQ's whole job. Test that `enqueue` is on the persistent queue, not the worker's in-memory state.

5. **First user with no LLM key configured.** Almost certain on first install. Worker handles via `no-credentials` status; user discovers when they later try the agent (TASK-022) and gets a "configure your API key" hint. We're not surfacing it in TASK-019 because it's not user-facing.

---

## Open questions

- **Token budget for `complete()` calls.** Default `maxTokens: 2048` in the client; for source-summary the prompt asks for 800-1500 words ≈ 1000-2000 tokens output. 2048 is the right ballpark. Revisit if summaries get truncated mid-sentence.
- **Should `summary` be markdown or plain text?** Markdown — LLMs ingest it natively, and TASK-020/022 may want to extract structure (headings, lists) downstream.
- **Concurrent summarization across users.** Worker concurrency 2 (matches paper-parse). Two summaries can run simultaneously without resource contention since each makes one HTTP call to a provider. Bump if needed.
- **Cost tracking.** `inputTokens` + `outputTokens` are logged but not aggregated anywhere. v0.1 is single-user / self-hosted, so no per-user cost dashboard yet. v0.2 territory.

---

## Report Back

When done, append (or replace) the TASK-019 row in `docs/tasks/README.md`:

| TASK-019 | Source-summary auto-generation | ~1.5 days | TASK-010, TASK-011 | ✅ done |

And note in the README footer: *"Last updated: <date>. Phase 3 first card shipped."*

---

## References

- **CLAUDE.md** — `## LLM Usage Inside Sapientia` (privacy rules, single-entry-point rule)
- **PRD §3** — Layer 1 / Layer 2 agent context model (TASK-019 produces Layer-2-shaped artifacts)
- **`packages/shared/src/format-blocks-for-agent.ts`** — block formatter the prompt slot reuses
- **`apps/api/src/services/credentials.ts`** — `getLlmCredential()` is the existing entry point for per-user API key
- **`apps/api/src/workers/paper-parse.worker.ts`** — pattern to mirror (queue → worker → idempotency → status → trigger next job)

---

*Drafted 2026-04-29. First Phase-3 card; lays the LLM client groundwork that TASK-022 + TASK-020 will build on.*
