---
type: ADR
id: "0177"
title: "PR-first delivery through protected main"
status: active
date: 2026-08-03
supersedes: "0021"
---

# ADR 0177: PR-First Delivery Through Protected Main

## Context

ADR 0021 optimized for a single developer by requiring every local push to update `origin/main`. The Husky pre-push hook encoded that choice in `require_main_push`, rejecting feature branches before quality checks could run.

That local authorization rule now conflicts with the repository's contribution model and CI configuration:

- `CONTRIBUTING.md` invites focused pull requests.
- GitHub Actions already runs for pull requests targeting `main`.
- External contributors and parallel work need isolated branches.
- A client-side hook cannot protect `main` for users who do not install hooks.

## Decision

Sapientia uses a PR-first delivery workflow. Work starts from the latest `origin/main` on a short-lived branch, the branch is pushed after local checks pass, and the change reaches `main` only through a pull request.

The pre-push hook runs the same quality checks for feature branches, detached-HEAD branch pushes, and tags. It does not authorize updates to `main`.

GitHub branch protection is the authoritative merge boundary. It requires a pull request, an up-to-date branch, and the configured CI checks. Direct updates, force pushes, and branch deletion are rejected for `main`.

## Options Considered

- **Protected `main` with PRs** (chosen): supports review, external contributions, and server-side enforcement while keeping the full local feedback loop.
- **Direct-to-main with local hooks**: fast for one developer, but blocks PR branches locally and cannot enforce policy for every clone.
- **Feature branches merged locally**: isolates work but still bypasses review and server-side required checks.

## Consequences

### Positive

- Local and external contributors use the same branch workflow.
- Review history and CI evidence are attached to each change.
- Repository policy remains effective even when local hooks are absent.

### Negative

- Every change has PR lifecycle overhead.
- Branches must be updated when `main` advances before merge.

### Operational

- Never use `--no-verify`.
- Local pre-push remains a required feedback gate, while GitHub repeats required checks.
- Required check names must match the job names in `.github/workflows/ci.yml`.
- An administrative bypass is not part of the normal delivery path.

## Test Expectations

- A simulated feature-branch push reaches the normal pre-push checks instead of failing on branch identity.
- A direct update to protected `main` is rejected by GitHub.
- A pull request cannot merge until required checks pass and the branch is current.
