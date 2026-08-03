---
type: ADR
id: "0178"
title: "Repository-owned quality gates without CodeScene"
status: active
date: 2026-08-03
supersedes: "0064"
---

# ADR 0178: Repository-Owned Quality Gates Without CodeScene

## Context

ADR 0064 made CodeScene scores and `.codescene-thresholds` a ratcheted release gate. That gate requires an external account, project identifier, API token, and tool access that are not available in the normal local Sapientia environment.

The integration had also become inconsistent: the local hook skipped CodeScene when credentials were absent, while CI expected repository secrets. This made the documented mandatory gate dependent on private external configuration and produced different developer experiences.

## Decision

Sapientia removes CodeScene as an operational development and release dependency.

The repository no longer contains a CodeScene threshold file, calls the CodeScene API from hooks or CI, requires CodeScene secrets, or keeps the legacy CodeScene hook. Quality remains enforced through repository-owned or reproducible checks:

- ESLint and TypeScript type checking
- Vite and Tauri build validation
- frontend and Rust tests with coverage thresholds
- Rust clippy and rustfmt
- curated Playwright smoke tests
- Codacy security and static analysis review
- focused human review through pull requests

## Options Considered

- **Remove CodeScene and retain reproducible gates** (chosen): every contributor can run the core checks without CodeScene credentials.
- **Keep CodeScene as optional local feedback**: avoids hard failures, but leaves dead configuration and two different quality workflows.
- **Keep CodeScene mandatory in CI only**: centralizes credentials, but PR delivery still depends on an external service that is not part of the local environment.

## Consequences

### Positive

- Local and CI quality requirements are explicit and reproducible.
- Pull requests do not depend on CodeScene availability or secrets.
- The pre-push hook no longer mutates and stages a threshold file.

### Negative

- The repository loses CodeScene hotspot and trend scoring.
- Reviewers must use test coverage, static analysis, and code review to catch maintainability regressions.

### Scope

Historical ADRs and release notes may still mention CodeScene because they describe earlier decisions and releases. Sponsor acknowledgements are not executable quality gates and are outside this decision.

This decision supersedes CodeScene-specific operational requirements in earlier ADRs, including ADR 0001, ADR 0175, and the proposed ADR 0176, without replacing their application architecture decisions.

## Test Expectations

- Local hook tests run without CodeScene binaries, environment variables, or network access.
- CI contains no CodeScene secret or API references.
- Lint, type, build, coverage, Rust, Playwright, and Codacy gates remain in place.
