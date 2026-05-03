# Sapientia Task Cards — Organized by Philosophy

This directory contains task cards for Sapientia implementation. Tasks are organized by where they sit in the **marginalia → Zettelkasten loop** — Sapientia's core product thesis (see [PHILOSOPHY.md](../PHILOSOPHY.md), [PRD_v1.md](../PRD_v1.md), and the v2 design upgrade in [PRD_v2.md](../PRD_v2.md)).

**Current state**: Phase 1 全部完成（8/8）。Phase 2 核心任务全部完成。TASK-018 marginalia v2 主体（A/B/D）已发，C/E/F 推迟。**Phase 3 已进入知识编译主线：TASK-019 已发；TASK-020 已形成 paper-local concept / semantic relation / paper graph checkpoint；TASK-022 已收尾为 note-native Ask checkpoint。** 2026-05-02 新增 [PRD_v2.md](../PRD_v2.md)：Phase 3 的用户侧方向从独立 wiki/graph 页面升级为 **Concept Lens + optional Concept Map**，source page/wiki 继续以 agent-facing substrate 为主；最新 v2 决策是：**用户不维护 concept wiki 或 graph，AI 在后台自主维护，用户行为默认只是阅读信号，显式操作只作为 correction/override**。paper-local concept 是 Sapientia 的 atom-like unit，`sourceLevelMeaning` 是 cross-paper clustering 的核心输入；agent 不再作为最终独立侧栏，而应折叠进 notes/marginalia，表现为 note-native AI replies。

---

## Phase 1 — Reading Foundation (Weeks 1-6) ✅ 已完成

**Goal**: A user can sign up, upload a PDF, and read it in the browser. The marginalia experience starts here. No AI synthesis yet, no notes yet.

| ID | Title | Est. effort | Depends on | Status |
|---|---|---|---|---|
| TASK-001 | Initialize TypeScript monorepo + Hono + Vite skeleton | 4-6h | — | ✅ 完成 |
| TASK-002 | Local infrastructure (Postgres, Redis, MinIO via Docker Compose) + config + healthcheck | 6-8h | TASK-001 | ✅ 完成 |
| TASK-003 | better-auth integration + protected routes | 8-10h | TASK-002 | ✅ 完成 |
| TASK-004 | Workspace + memberships data model + first migrations | 4-6h | TASK-002, TASK-003 | ✅ 完成 |
| TASK-005 | Paper upload endpoint with MinIO + dedup | 6-8h | TASK-003, TASK-004 | ✅ 完成 |
| TASK-006 | Frontend auth flow + minimal layout | 6-8h | TASK-003 | ✅ 完成 |
| TASK-007 | Frontend PDF upload UI + library list | 4-6h | TASK-005, TASK-006 | ✅ 完成 |
| TASK-008 | Frontend PDF.js viewer with react-pdf | 4-6h | TASK-007 | ✅ 完成 |

After phase 1: thin slice closed-alpha. Users can read PDFs in browser. Useful for proving infrastructure but no marginalia tools yet.

---

## Phase 2 — Block-Level Foundation + Marginalia ✅ 核心已完成

**Goal**: A complete marginalia loop. User can read papers (with MinerU-parsed blocks underneath), highlight with semantic colors, take notes pinned to PDF positions, and cite blocks from notes. This is **the user-facing half of the product thesis**.

| ID | Title | Est. effort | Depends on | Status |
|---|---|---|---|---|
| TASK-009 | BullMQ worker process + paper-parse stub | 5-7h | TASK-005 | ✅ 完成 |
| TASK-010 | MinerU API client + paper-parse job (real) | 8-10h | TASK-009 | ✅ 完成 |
| TASK-011 | Block schema + block API + paper detail block list | 5-7h | TASK-010 | ✅ 完成 |
| TASK-012 | BlockNote editor + notes data model | 8-10h | TASK-011 | ✅ 完成 |
| TASK-013 | Note → block citation | 8-10h | TASK-012 | ✅ 完成 |
| TASK-014 | Paper metadata enrichment + intelligent filenames + BibTeX export | 3 days | TASK-011 | ✅ 完成 |
| TASK-017 | Persistent highlights with selection UI + block-level agent context | 2.5-3 days | TASK-011 | ✅ 完成 |
| **TASK-018** | **Marginalia v2 — gutter + rail in preview, responsive across viewports** | **4-5 days · 6 PRs** | TASK-008, TASK-011, TASK-012, TASK-013, TASK-017 | 🟢 核心已发 (A/B/D)；C/E/F 推迟 |

ⓘ TASK-018 drafted 2026-04-29; Phases A (wide gutter+rail in PDF), B (compact 760-1280 overlay-card expand), and D (markdown-view parity) are shipped (`8ff8ba6` / `c1febd2` / `909722d`). Phases C (mobile drawer), E (zoom-floating gutter), and F (fullscreen writing escape hatch) are deferred — see [TASK-018.md](TASK-018.md) Status section for the rationale and re-open hooks. Visual spec: [`demo/marginalia-responsive.html`](../../demo/marginalia-responsive.html).

After phase 2: complete marginalia experience. User can read papers, mark them up, take pinned notes, cite blocks. The data substrate is in place for phase 3's AI synthesis.

---

## Phase 3 — Zettelkasten Output (Weeks 15-22, undrafted)

**Goal**: AI synthesis turns accumulated marginalia into a wiki + concept graph. This is **the AI half of the product thesis**.

| ID | Title | Status |
|---|---|---|
| TASK-019 | Source-summary auto-generation (per paper) | ✅ 完成 (`7f5ec60` / `79d086f`) |
| TASK-019.1 | Color-token compliance + dark theme | ✅ 完成 (`59b4a3e`) |
| TASK-019.2 | Spacing / motion / radius token alignment | 🚧 Phase A 已发 (`f58c448`)；B–F 待做 |
| TASK-020 | Knowledge compilation pipeline (summary + concept extraction + wiki refinement) | 🚧 已重写并拆成子卡 ([TASK-020.md](TASK-020.md), [020A](TASK-020A.md), [020B](TASK-020B.md), [020C](TASK-020C.md), [020D](TASK-020D.md), [020F](TASK-020F.md), [020G](TASK-020G.md), [020H](TASK-020H.md), [020I](TASK-020I.md), [020J](TASK-020J.md)); `020A` 已改为 `paper-compile-v1` 单次编译并进入 hardening；`020F` 已建立 workspace concept cluster substrate；`020G` AI-maintained source-level concept descriptions 基础闭环已落地；`020H` 建立 AI-maintained semantic candidate layer；`020I` 将 `/graph` 默认面改为 paper graph，concept evidence 作为 paper-paper edge 解释层；`020J` 已 checkpoint ready：note/highlight reader signal 与 embedding/LLM judgement 解耦，`readerSignalDirtyAt` 和 `semanticDirtyAt` 分层；[020E](TASK-020E.md) 已退休 |
| TASK-021 | Knowledge graph view (Cytoscape.js) | ⚠️ 需按 [PRD_v2.md](../PRD_v2.md) 和 [TASK-020I](TASK-020I.md) 重写：默认 Graph Page 应是 paper graph；Concept Lens + optional Concept Map 作为概念层入口 |
| TASK-022 | Agent v0.1 → note-native Ask (Layer 1 + Layer 2 context) | ✅ closed ([TASK-022.md](TASK-022.md)); Ask 已折叠进 notes/marginalia：选区、block、note selection 都写回 note，独立 AgentPanel 降级为 legacy infrastructure |
| TASK-025 | Prompt reliability, taxonomy alignment, and regression evaluation | 🆕 已起草 ([TASK-025.md](TASK-025.md)) — 覆盖所有生产 prompt 的可靠性与评测主线 |

ⓘ TASK-019 shipped 2026-04-29. It originally added `papers.summary`, the LLM client (`apps/api/src/services/llm-client.ts`), and the `paper-summarize` BullMQ worker auto-triggered after paper-parse. As of TASK-020A, that worker has evolved into the paper compile worker: it now runs `paper-compile-v1` to produce the agent-facing summary/source page plus local concept substrate in one pass. See [TASK-019.md](TASK-019.md) and [TASK-020A.md](TASK-020A.md).

**Recommended ordering** (by user-visible value and complexity):

1. **TASK-019 first**: source-summary is the cheapest demonstrable AI output. New paper uploaded → 30 seconds later wiki page appears. Immediate proof of the Zettelkasten side. ~1-2 days.
2. **TASK-022 closed**: agent summon-mode evolved into note-native Ask. Single-paper Layer 1 + Layer 2 context remains the backend contract, but the user-facing loop now lands in marginalia notes instead of a standalone agent sidebar.
3. **TASK-020 third**: knowledge compilation. This is now active. `020A` no longer runs a separate wiki compile pass: the existing `paper-summarize` queue now calls `paper-compile-v1`, producing the agent-facing summary/source page plus local concept/entity substrate in one LLM call. `020B v1` covers block-highlight/note-citation salience, source-page reference refresh, and agent-context consumption. `020D` has started with inner-paper concept edges; cross-paper clusters and concept-first retrieval remain. `020A`'s summary/wiki artifacts are agent-facing substrate, not a user-facing page. Before `020G`, `TASK-025` should tighten concept extraction so the substrate contains load-bearing concepts rather than incidental technical noun phrases.
4. **Rewrite TASK-021 before implementation**: PRD v2 changes the user-facing surface from a standalone graph page to **Concept Lens + optional Concept Map**. The compiled concept/wiki substrate from TASK-020 still powers it, but the default UX should stay inside the reader and foreground concepts/evidence rather than raw summary prose, graph dashboard, or user-maintained review queue.

These should be drafted **just before being implemented**, using lessons from phases 1-2. `TASK-022` is closed; future agent work should be framed as note-native AI polish or reader-signal integration, not as a standalone panel.

---

## Migration / Auxiliary

| ID | Title | Est. effort | Phase | Status |
|---|---|---|---|---|
| TASK-016 | Reference manager import (PaperLib + Zotero) | 2-3 days | v0.2 mid-late (convenience) | ⏸️ 推迟到 v0.2 |

Per ADR-020 (revised), TASK-016 is a migration convenience tool, not a cold-start path. With TASK-014's metadata enrichment in place, Sapientia works for users without existing libraries. TASK-016 serves users with curated corpora who want to bring them in bulk.

---

## 变化记录（Changes from Original Plan）

以下是与原任务规划相比的重要变化：

### 架构变化

| 变化 | 原计划 | 实际实现 |
|------|--------|----------|
| **双标注系统** | TASK-010/011 原计划统一的高亮系统 | 拆分为 `highlights`（语义颜色）+ `reader-annotations`（矩形/自由绘制标注）两个独立数据模型和 API |
| **加密凭证服务** | 未明确规划 | 新增 `services/crypto.ts` + `services/credentials.ts`，用户 API key 加密存储 |
| **AI 预备模块** | 未在 Phase 1-2 规划 | `packages/shared/src/format-blocks-for-agent.ts` 已就绪，为 Phase 3 AI agent 格式化 blocks |
| **Editor 迁移** | 原计划 BlockNote | 迁移到 Tiptap/Novel（见 CLAUDE.md sanctioned exception） |
| **知识编译单次化** | summary 后再 wiki/concept compile | `paper-compile-v1` 现在一次输出 summary/source page references/local concepts，减少一次 LLM 调用 |
| **OpenAI-compatible JSON mode** | 假设 structured output 可统一使用 | OpenAI-compatible 路径统一使用 `response_format: { type: "json_object" }`，schema 写入 system prompt 后再用 Zod 校验 |
| **Inner-paper graph substrate** | 仅规划 cross-paper graph | 已新增 `compiled_local_concept_edges` / `compiled_local_concept_edge_evidence`，先做 paper-local concept relations |
| **Prompt 可靠性主线** | 单个 prompt 出问题时局部修补 | 新增 TASK-025，把 taxonomy、JSON-mode、block evidence、回归样本统一为 prompt 系统治理 |
| **Concept lifecycle** | note/highlight 变化可直接推动 semantic refresh | TASK-020J 已落地：reader-signal 更新只进入 paper-level refine，semantic refresh 只由 source-level semantic dirty / explicit refresh / credential change 等低频路径触发 |

### 数据库演进

- 从最初的基础表经过 **17 次迁移**（0000-0016），增加了：
  - Papers 表：soft delete（`deletedAt`）、enrichment status 多状态追踪、解析进度
  - 新增 `reader_annotations` 表（矩形/自由绘制标注）
  - 新增 `user_credentials` 表（加密 API key 存储）
  - 新增 `highlights` 表（6 种语义颜色 + underline/ink）

### 新增文件/工具

| 新增 | 说明 |
|------|------|
| `services/bibtex.ts` | BibTeX 解析与导出 |
| `services/paper-metadata.ts` | 论文元数据提取（独立服务） |
| `services/filename.ts` | 智能文件名处理 |
| `scripts/backfill-blocks.ts` | 块数据回填脚本 |
| `scripts/check-pdf-dims.ts` | PDF 尺寸检查 |
| `scripts/inspect-mineru-zip.ts` | MinerU ZIP 检查 |
| `scripts/normalize-block-bboxes.ts` | 块边界框标准化 |
| `scripts/requeue-pending.ts` | 重排队列中挂起任务 |
| `packages/shared/src/citations.ts` | 引用解析与格式化 |
| `packages/shared/src/blocknote-to-md.ts` | BlockNote → Markdown 转换 |

### 测试覆盖

- API 端：14+ 测试文件（auth, block-parser, citations, crypto, health, mineru-client, mineru-zip, notes, paper-parse.worker, papers, queue, reader-annotations, workspaces 等）
- Web 端：PdfViewer 组件测试、BlocksPanel 组件测试
- Shared 端：citations、blocknote-to-md、format-blocks-for-agent 测试

---

## How to use this directory

- **Read the entire card before starting.** The "Do not" section is as important as "What to Build."
- **Check the acceptance criteria** to know when you're done.
- **Re-read PHILOSOPHY.md when in doubt.** Every implementation decision should pass the "marginalia or Zettelkasten?" test.
- **One task at a time.**
- **Report back at the end.** Each card has a "Report Back" section. Use it. Reports inform whether the next card needs adjustment.
- **If a card is wrong**, update it and tell the user. Cards are not stone tablets.

---

## Numbering note

The numbering is non-contiguous (TASK-015 is unused). This is intentional — when a task gets retired or merged into another, its number is left unused rather than renumbering everything. Don't read into the gaps.

---

*Last updated: 2026-05-01. Phase 1 + Phase 2 core complete; Phase 3 knowledge-compilation substrate is active.*
