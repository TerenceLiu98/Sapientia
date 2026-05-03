# TASK-022: Agent v0.1 — summon-only, paper-scoped reading assistant

**Estimated effort**: 3-4 working days
**Remaining effort**: closed for v0.1; optional heavier flow coverage can move to follow-up
**Depends on**: TASK-019 (LLM client + source-summary), TASK-017 (highlights), TASK-013 (note→block citations), AppShell agent-panel placeholder (already wired in `apps/web/src/components/layout/AppShell.tsx`)
**Phase**: 3 — Zettelkasten Output (second card; first user-visible AI surface)
**Status**: Implemented foundation / checkpoint ready

---

## Current Implementation Status

### Close-out checkpoint — 2026-05-03

TASK-022 is closed as a v0.1 foundation card.

What shipped:

- paper-scoped streaming assistant route: `POST /api/v1/agent/ask`
- shared LLM streaming path through `services/llm-client.ts`
- BYOK provider support for OpenAI-compatible and Anthropic-compatible interfaces
- optional user `baseURL`, API key, and model name
- selected-text / block-level summon context
- paper-scoped session-local chat state
- clickable block citations in assistant messages
- retry-once and stream-abort behavior
- privacy-safe logging with no prompt/response body logging
- tests covering route behavior, context assembly, transport shaping, citation rendering, close-while-streaming, and retry affordance

The current UI still uses `AgentPanel` as the v0.1 delivery vehicle, but product copy should avoid presenting it as a separate destination. In the app chrome, the action should read more like **Ask** than **Show agent**.

### v2 product direction note

The current `AgentPanel` implementation is a useful v0.1 stepping stone, but it should not be the final v2 surface.

For v2, Sapientia should fold agent interaction into the notes/marginalia model:

- no standalone "show agent" destination as the primary UX
- selection/block questions become **Ask in note**
- streamed AI output renders as an inline **AI reply note**
- citations remain clickable block references
- the resulting note thread can feed `020B/020C` salience and source-level meaning refinement

This card documents the shipped v0.1 panel because that is the current implementation. The migration from `AgentPanel` toward note-native AI replies should be a follow-up task, not unfinished TASK-022 scope. That follow-up should reuse the backend context and streaming machinery built here.

### Note-native Ask checkpoint — Novel/Tiptap direction

Novel's public docs position it as a headless Notion-style editor built on Tiptap/Radix/Cmdk; its AI Command guide is still marked "Soon". So Sapientia should not wait for a Novel-specific AI API. The product direction is to use Novel/Tiptap editor affordances directly:

- selected note text exposes an **Ask** action in the editor bubble menu
- the question composer opens inside the note surface, not in a standalone agent sidebar
- the answer is inserted back into the same note as a persisted AI reply block
- the answer still uses the existing paper-scoped `agent-summon-v2` context path and block-citation discipline
- this is a bridge implementation: first non-streaming insertion is acceptable; future polish should stream into a temporary note block and parse `[blk ...]` citations into first-class note citations

Current checkpoint implementation:

- `POST /api/v1/agent/note-ask` returns one grounded answer for note insertion
- `NoteEditor` adds a note selection bubble **Ask** action for paper-attached notes
- the note Ask composer uses the note's anchor block as Layer 1 context when available
- returned AI text is inserted into the Tiptap document and saved by the existing note autosave path
- reader selected-text **Ask** and block-toolbar **Ask** now create/open a paper-side marginalia note instead of opening the legacy `AgentPanel`
- reader Ask creates the marginalia note immediately with a lightweight `Thinking...` body; success replaces it with the grounded answer, while failure preserves the question and writes an editable error note
- `AgentPanel` remains as legacy infrastructure only; it is no longer the intended primary reading flow
- the notes/marginalia rail should remain visible in the reader. Users should not be able to hide the note surface because AI answers now land there.

### Shipped

- `AgentPanel` is live in the existing right-panel slot with:
  - empty state
  - per-paper header
  - composer
  - streamed assistant messages
  - retry-once and Settings affordances
- Summon entry points are wired:
  - selected-text toolbar
  - block-level summon from the reader workspace
  - empty summon from the existing top-bar toggle
- `/api/v1/agent/ask` exists and returns an AI SDK UI message stream response.
- `services/llm-client.ts` already uses AI SDK Core for both non-streaming and streaming calls, with:
  - provider resolution through saved credentials
  - optional custom `baseURL`
  - AI SDK telemetry disabled
  - Sapientia-owned privacy-safe logging
- `services/agent.ts` already assembles paper-scoped Layer 1 + Layer 2 context from:
  - source summary
  - selection / nearby blocks
  - active highlights formatted for agent use
- Chat state is paper-scoped and session-local, matching the v0.1 boundary.

### Recently hardened

- Backend tests now cover:
  - streaming provider/baseURL resolution
  - invalid `baseURL` handling
  - route status mapping (`400` / `401` / `502`)
  - abort-signal passthrough
  - context truncation logging
  - privacy assertions that prompt/response content never enters logs
- Frontend tests now cover:
  - summon composer staying empty
  - close-while-streaming calling `stop()`
  - retry-once affordance
  - selected-text “Ask agent” trigger
  - `useAgentChat` transport body shaping and paper-scoped session reuse

### Deferred follow-up

- Add heavier end-to-end-style flow coverage if needed, especially around:
  - viewport fallback when no explicit selection is provided
  - longer multi-turn paper-scoped chat flows
- Build the v2 note-native AI reply surface:
  - Ask from selected text/block creates or targets a note thread.
  - Streamed AI response is persisted as an AI reply note.
  - Agent replies can become reader signals for TASK-020B/020C.
  - The user should not need to manage a standalone agent sidebar as the primary loop.

---

## Context

This is the first card where the user actually **sees** AI behavior. TASK-019 built the per-paper source-summary as a backend artifact; nothing was shown to users. TASK-022 lights up an agent panel they can summon mid-reading: select a passage, click "Ask agent", get a streamed answer that's grounded in this paper.

Two product principles (from PRD §1 / §3) shape the scope:

1. **Summon-only**, not auto-suggest. The reader is in charge; the agent is silent until called. No background noise, no tooltips that nag, no predictive prompts.
2. **Layer 1 + Layer 2 context only**. Layer 1 is the user's immediate focus (selected text, the block they clicked, or the live viewport). Layer 2 is the paper's context — its source-summary, its highlights, its blocks-with-marginalia. **No** workspace-wide retrieval, **no** cross-paper context — those belong to v0.2.

The card also extends `services/llm-client.ts` with a streaming variant. For TASK-022, use **AI SDK Core + AI SDK UI** as the framework layer, while keeping Sapientia's own credential storage, logging, and context assembly. The product contract here is important: users bring their own LLM credentials, including **interface mode** (`openai` or `anthropic` internally; user-facing copy should read "OpenAI-Compatible" / "Anthropic-Compatible"`), **API key**, and optional **base URL**. TASK-019 deliberately deferred streaming because non-streaming was sufficient for the worker. Now we need it.

### Explicitly NOT in scope (v0.1 boundaries from CLAUDE.md "Critical Don'ts")

- **Tool calling** (#3 don't write tool calling for the agent). Single-turn, text-in/text-out.
- **Workspace-wide context loading** (#4). Layer 1 + Layer 2 only.
- **Multi-paper context.** A summon on Paper A only sees Paper A's content.
- **Conversation memory across sessions.** v0.1 chat history is session-local; closing the panel discards it. Persisted threads are v0.2.
- **Agent-initiated actions.** Agent doesn't create notes, doesn't add highlights, doesn't navigate the reader. It only answers.
- **AI Gateway / hosted proxy layers.** Use the user's provider key directly via `getLlmCredential(userId)`; do not route through `ai-gateway` or any gateway-managed credentials.
- **AI SDK telemetry.** Keep AI SDK telemetry fully disabled. Sapientia owns its own logging and metrics.

---

## Acceptance Criteria

1. **Agent panel UI** in the existing `RightPanel` slot (toggled via the existing `isAgentPanelOpen` state in AppShell). Shows: messages list, prompt input + send button, current paper indicator, "no API key configured" empty state when applicable.
2. **Summon entry points**:
   - Selection toolbar (TASK-017's bbox toolbar) gains an "Ask agent" button that opens the panel and attaches the selected text + block IDs as implicit `selectionContext`.
   - Block toolbar (BlocksPanel) gains the same button, attaching the block's source text + block ID as implicit `selectionContext`.
   - Empty-prompt summon (toggle the panel without selection) opens with no explicit `selectionContext` — user can ask any question about this paper.
3. **Streaming response** from a new `/api/v1/agent/ask` endpoint using the **AI SDK UI message stream protocol**. Tokens appear in the UI as they arrive.
4. **Context assembly** runs at request time:
   - **Layer 1**: selected text (if any) + the block(s) the selection landed in (with surrounding 1 block for context) OR the live viewport block(s) if no selection.
   - **Layer 2**: the paper's source-summary (`papers.summary` from TASK-019) + a list of all blocks with active highlights (color + selectedText) formatted via `formatBlocksForAgent()`.
5. **No LLM config state**: panel renders a "Configure your LLM interface in Settings" link rather than crashing when interface mode / API key are missing. If `baseURL` is user-configurable in Settings, missing or invalid custom values should fail gracefully rather than crashing.
6. **Privacy contract** (CLAUDE.md hard rule): `/api/v1/agent/ask` logs prompt template ID, model name, token counts, latency, userId, workspaceId — **never** prompt content, **never** response content. AI SDK telemetry is disabled; Sapientia keeps its existing `llm-client` logging discipline and owns all instrumentation.
7. **Failure modes**:
   - Network / 5xx → retry-once button in chat.
   - Auth / 4xx → "API key invalid" + Settings link.
   - Streaming abort (panel closed) → cancels the upstream request via AbortController.
8. **Tests**: agent route handler with mocked LLM (assert AI SDK UI stream emitted, assert privacy — no prompt body in logs); context-builder unit test (Layer 1 + Layer 2 assembly from fixture paper); UI test (summon flow, streamed render, abort).
9. **No regression**: AppShell's existing agent-panel toggle continues to work; the placeholder copy is replaced, not bolted on.
10. **No AI Gateway coupling**: implementation depends on `ai`, `@ai-sdk/react`, `@ai-sdk/anthropic`, and `@ai-sdk/openai-compatible` (or pinned equivalents), not `ai-gateway`.

### Acceptance Status Checkpoint

- `1`–`7`: implemented for the v0.1 panel-based assistant
- `8`: implemented enough to close the card; backend + panel/transport coverage exists, heavier E2E remains optional
- `9`–`10`: implemented

The original acceptance wording still names `Agent panel UI` because this card shipped that v0.1 surface. That should not be interpreted as a v2 product commitment. V2 should migrate the same ask/context/streaming mechanics into notes and marginalia.

---

## Backend

### Streaming extension to `services/llm-client.ts`

Add a `streamComplete()` sibling to `complete()`, but do **not** invent a custom wire protocol for the route. Use AI SDK Core's `streamText()` under the hood and return an object that `services/agent.ts` / the route can turn into an **AI SDK UI message stream response**.

Implementation direction:

- Use **AI SDK Core** inside `services/llm-client.ts` for both non-streaming and streaming calls. It is reasonable to migrate `complete()` onto `generateText()` as part of this card so Sapientia has one abstraction path.
- Resolve the protocol family dynamically from the user's saved credentials:
  - **`openai` mode** → user-facing copy "OpenAI 接口"; use `@ai-sdk/openai-compatible`
    - this mode is for official OpenAI **and** OpenAI-style third-party endpoints
    - pass through the user-provided `apiKey`
    - pass through the user-provided `baseURL` when present
  - **`anthropic` mode** → user-facing copy "Anthropic 接口"; use `@ai-sdk/anthropic`
    - pass through the user-provided `apiKey`
    - pass through the user-provided `baseURL` when present
- Provider selection still flows through `getLlmCredential(userId)`. `llm-client.ts` remains the single Sapientia entry point; callers do not import provider SDKs directly.
- **Do not use AI Gateway.** No hosted proxy, no gateway API key, no provider credential indirection outside Sapientia.
- **Disable AI SDK telemetry completely.** Do not pass `experimental_telemetry`; keep Sapientia's existing `logger.info(...)` / `logger.warn(...)` logging as the only instrumentation path.
- Preserve the current error taxonomy (`LlmCallError` / `LlmCredentialMissingError`) and map AI SDK / provider failures into it.

Internal note: this module should abstract provider creation, model invocation, and privacy-safe logging. It should not expose raw provider clients to the rest of the app.

### Dependency note

Expected packages for this card:

- `ai`
- `@ai-sdk/react`
- `@ai-sdk/anthropic`
- `@ai-sdk/openai-compatible`

Do **not** add:

- `ai-gateway`

### Credentials / Settings note

The current credentials shape already stores provider + API key. To support the product contract for this card cleanly, extend credentials/settings if needed so the user can also save an optional **LLM base URL** alongside interface mode and API key.

### `POST /api/v1/agent/ask`

```ts
// Request body
{
  paperId: string
  workspaceId: string
  messages: UIMessage[]                   // sent by useChat transport
  selectionContext?: {                     // Layer 1 — optional
    blockIds: string[]                     // primary block(s) under the selection
    selectedText?: string                  // exact selection if any
  }
}

// Response: AI SDK UI message stream over SSE
// Includes assistant text plus message metadata for model / token usage.
```

Route lives in `apps/api/src/routes/agent.ts`. Per CLAUDE.md routing-handler discipline: parse + validate (Zod) → delegate to `services/agent.ts` → return an AI SDK UI message stream response. The route should set the AI SDK UI stream headers correctly rather than inventing a custom `token / usage / done` event schema.

### `services/agent.ts`

Two pure-ish functions:

```ts
export async function buildAgentContext(args: {
  paperId: string
  selectionContext?: SelectionContext
}): Promise<AgentContext>

export async function streamAgentAnswer(args: {
  userId: string
  workspaceId: string
  paperId: string
  messages: UIMessage[]
  context: AgentContext
}): Promise<AgentStreamResult>
```

`buildAgentContext` reads:
- `papers` row → title, authors, summary (Layer 2)
- `blocks` → all blocks for the paper (used both for selectionContext expansion and to format the marginalia signal)
- `block_highlights` → highlights for the user (Layer 2)
- `notes` → noteIds + their cited blocks (optional Layer 2 signal — defer if shape is unclear at impl time)

Then runs the prompt template `agent-summon-v2` (new in `packages/shared/src/prompts/`) with slots filled.

`streamAgentAnswer` calls `streamComplete()` and returns an AI SDK-backed stream result that the route can serialize with `toUIMessageStreamResponse()` (or the equivalent helper if Hono integration needs a thin adapter). Usage / model metadata should be attached via AI SDK message metadata rather than a bespoke SSE event. `services/agent.ts` should know nothing about provider SDK specifics, AI Gateway, or telemetry knobs; those stay buried in `llm-client.ts`.

### Prompt: `agent-summon-v2`

Single template. Frame:

> You're an academic reading assistant embedded in a paper-reading interface called Sapientia. The user is currently reading the paper provided below; they may have selected a passage they want to discuss.
>
> Use the paper-summary and the user's marginalia (highlights with semantic color: questioning / important / original / pending / background) as your knowledge of this paper. **Do not** invent facts not in the provided text. If asked about something not in the paper, say so plainly.
>
> Stay grounded: cite block IDs (e.g. `[blk a3b21c]`) when paraphrasing or quoting. The interface will render those as clickable jumps.
>
> Slots: `{{paperTitle}}`, `{{paperAuthors}}`, `{{paperSummary}}`, `{{focusContext}}` (Layer 1: selected text + surrounding blocks), `{{marginaliaSignal}}` (Layer 2: highlight summary), `{{userMessage}}`.

Stored as `packages/shared/src/prompts/agent-summon-v2.ts` (matching TASK-019's `.ts`-not-`.md` convention).

### Context size discipline

- Source summary is bounded (~1-3 KB).
- Selection-context expansion: clamp to the selected block + 1 neighbor on each side (per direction the user reads). Skip expansion if user summoned without a selection.
- Marginaliasignal: list highlights with their selectedText + color, **bounded by the model's context window**. If the user has 200+ highlights on the paper, dedup by block and only include the highlighted phrases (not full block text). Defer fancy retrieval to v0.2.

If the assembled prompt would exceed ~30k tokens, log a warning and truncate the marginaliaSignal first (it's the largest variable input).

---

## Frontend

### Replace `RightPanel.tsx` with an agent chat shell

```
┌─ AgentPanel ────────────────────────────┐
│ ┌─ Header ────────────────────────────┐ │
│ │  Agent · paper title (truncated)    │ │
│ │                          [×] close  │ │
│ └─────────────────────────────────────┘ │
│ ┌─ Messages ──────────────────────────┐ │
│ │  user: "..."                        │ │
│ │  assistant: "..." [block a3b]       │ │
│ │  user: "..."                        │ │
│ │  assistant: streaming…              │ │
│ └─────────────────────────────────────┘ │
│ ┌─ Input ─────────────────────────────┐ │
│ │  [textarea]                  [send] │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

Frontend implementation surfaces:

- `apps/web/src/components/agent/AgentPanel.tsx` — panel shell, empty/error states, retry affordance, close behavior.
- `apps/web/src/components/agent/AgentMessage.tsx` — single message render. Renders block-id citations as clickable spans that call into the existing `handleOpenCitationBlock` flow (TASK-013) and now delegates prose rendering to the shared markdown layer.
- `apps/web/src/components/agent/AgentComposer.tsx` — textarea + send button. Cmd/Ctrl-Enter submits.
- `apps/web/src/components/agent/useAgentChat.ts` — thin wrapper around `useChat` with `DefaultChatTransport`, request shaping, empty-message pruning, and paper-scoped session behavior.
- `apps/web/src/components/agent/types.ts` — typed message metadata for streamed model / token metadata.
- `apps/web/src/components/markdown/MarkdownProse.tsx` and related helpers — shared markdown prose rendering used by agent output, including citation chips and math.

### Summon entry points

Two existing toolbar surfaces gain an "Ask agent" button:

- **PDF / markdown selection toolbar** (`apps/web/src/components/reader/SelectedTextToolbar.tsx`): icon button → captures selected text + block IDs → opens the panel and seeds `selectionContext`.
- **Block toolbar** (the row toolbar in `BlocksPanel`'s BlockRow): same.

Plus the existing top-bar Ask toggle opens the panel without context.

### Routing-and-state interaction with the rest of the workspace

- Selecting text and clicking "Ask agent" should open the v0.1 panel (set `isAgentPanelOpen=true`) and attach that Layer 1 material as implicit `selectionContext` on the next send. The composer itself stays empty so the user writes only their actual question.
- Clicking a `[blk a3b]` chip in the agent's response calls `handleOpenCitationBlock(paperId, blockId)` (existing) which jumps the reader.
- Switching papers: chat state is keyed by `paperId`. Existing session for that paper resurfaces; otherwise empty. Memory cleared on full page reload (no persistence in v0.1).

### Frontend transport choice

- Use `useChat` from `@ai-sdk/react`.
- Use `DefaultChatTransport` against `/api/v1/agent/ask`.
- Use `prepareSendMessagesRequest(...)` to send:
  - `paperId`
  - `workspaceId`
  - `selectionContext`
  - bounded `messages` history (for example, last 10 turns)
- Render token/model info from AI SDK **message metadata**, not a custom `usage` event parser.

---

## Risks

1. **AI SDK UI stream through Hono on Bun.** Bun's `Response` streaming is fine, but verify that the AI SDK UI response helper and Hono interoperate cleanly in the current `hono` / Bun versions. If needed, write a thin adapter around the returned stream/headers rather than dropping back to a custom protocol.

2. **Stream cancellation across the chain.** Panel close → AbortController.abort() → fetch aborts → backend's AsyncIterable should clean up the upstream provider stream. Test this explicitly; the typical failure is the route handler keeps streaming to a dead socket and burns tokens.

3. **OpenAI-mode compatibility drift.** "OpenAI mode" in product terms really means "OpenAI-style API". Some third-party endpoints diverge subtly on request/response shape, streaming usage, or unsupported fields. Prefer `@ai-sdk/openai-compatible`, keep request shaping conservative, and test at least one custom-baseURL fixture.

4. **Citation chip parsing.** The agent's output references blocks via `[blk a3b21c]`. The renderer needs a regex pass to convert those to clickable spans. Be tolerant of slight format drift from the LLM (`[block a3b21c]`, `block:a3b21c`); accept multiple shapes via a single regex with capture groups.

5. **Token budget creep.** A paper with 80 highlights and a 1500-word summary plus a 6-block selection context is already ~10k input tokens before the user's message. Watch the `inputTokens` log line; if 90th percentile creeps past 30k, optimize marginalia formatting.

6. **The "no answer" UX.** The agent will hit cases where the paper doesn't contain the user's answer. The prompt explicitly says "say so plainly" — but the streaming UI needs to handle the case where the entire response is "I don't see that in this paper" without it feeling like a bug. Test with a deliberately off-topic question.

---

## Open questions

- **Should the agent be allowed to recommend new highlights?** (e.g. "the paper's claim about X is on block a3b — you might want to mark it as `important`.") This is borderline tool-calling — defer to v0.2 even though the LLM could just suggest in plain text.
- **Cross-message memory in a session.** The card sends bounded `messages` history from `useChat` each turn. Cap it at last N turns (probably 10) to bound input tokens. If the user starts a brand-new question (clear button), history resets.
- **Selection feedback inside the panel.** Should the user see what the agent has as Layer 1 (for example, a small "responding to: ..." banner)? Recommendation: optional. The selected block / text should remain implicit transport context rather than being inserted into the editable composer body.
- **Settings UX for missing API key.** When the user summons and there's no key, do we show an inline hint or push them to /settings? Recommendation: inline copy + a Settings link, never auto-redirect.
- **Per-paper agent on/off toggle.** Some papers may be private / sensitive and the user may not want their content sent to a third-party LLM. v0.1: rely on the global "no API key configured = no agent" path. v0.2: add per-paper opt-out.

---

## Testing strategy

### Backend
- `agent.route.test.ts`: mocks `streamComplete`, asserts an AI SDK UI message stream response is returned with the expected headers/parts, and asserts privacy (no prompt content in logs).
- `agent.context.test.ts`: feeds a fixture paper with 5 highlights, 3 blocks selected, asserts the assembled context object has the right shape and is bounded under the truncation cap.
- `llm-client.streamComplete.test.ts`: mocks the AI SDK streaming layer and/or provider clients, asserts provider resolution works for `openai` mode and `anthropic` mode with custom `baseURL`, and asserts telemetry is disabled plus no prompt/response content reaches logs.

### Frontend
- `AgentPanel.test.tsx`: mount with no API key → renders settings hint. Mount with API key → composer enabled.
- `AgentComposer.test.tsx`: Cmd-Enter submits, empty input doesn't submit.
- `AgentMessage.test.tsx`: renders `[blk a3b21c]` citations as clickable spans; clicking calls a mock onCitationOpen.
- `useAgentChat.test.tsx` (or similar): verifies `useChat` request shaping includes `paperId`, `workspaceId`, and `selectionContext`, and that streamed metadata is surfaced in the client.
- Optional heavier integration/E2E: full summon flow on a fixture paper, especially around viewport fallback and longer multi-turn sessions. This remains optional follow-up rather than a blocker for the current checkpoint.

---

## References

- **CLAUDE.md** — `## LLM Usage Inside Sapientia` (privacy + single-entry rules); `## Critical Don'ts` #3, #4 (tool calling + workspace-wide context).
- **AI SDK docs** — use AI SDK Core + AI SDK UI stream protocol; no AI Gateway; no telemetry.
- **PRD §3** — Layer 1 / Layer 2 context model.
- **TASK-019** — LLM client + `complete()` + source-summary. This card extends `llm-client.ts` with streaming and is a good point to converge `complete()` and `streamComplete()` onto the same AI SDK abstraction path.
- **TASK-017** — block_highlights + `formatBlocksForAgent()`. Layer 2 reads from this.
- **TASK-013** — `handleOpenCitationBlock()` is the entry point for clickable `[blk]` citations in agent output.
- **AppShell** — `apps/web/src/components/layout/AppShell.tsx` already has `isAgentPanelOpen` state + toggle wired; this card replaces the placeholder `RightPanel.tsx`.

---

## Report Back

When done, append (or replace) the TASK-022 row in `docs/tasks/README.md`:

| TASK-022 | Agent v0.1 (summon-only) | ~3 days | TASK-019, TASK-017, TASK-013 | ✅ done |

Note in the README footer the date and that Phase 3 has its first user-visible AI surface live.

---

*Drafted 2026-04-29. Implementation begins after TASK-019.2 Phase B at the earliest, or in parallel if a second pair of hands is available. Agent UI work pulls forward TASK-019.2 Phase B/C tokens for the floating panel chrome.*
