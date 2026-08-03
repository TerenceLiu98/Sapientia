# Git Hooks

This repo uses Husky hooks from `.husky/`. Those files are the source of truth.

## Installation

`pnpm install` runs the `prepare` script and installs the hooks into `.git/hooks`.

If you need to reinstall them manually:

```bash
pnpm exec husky
```

The hooks expect `node` and `pnpm` to be available. If they are installed via `nvm`, the hooks will try to load `~/.nvm/nvm.sh` automatically.

## Policy

- Work on a short-lived branch created from the latest `origin/main`.
- Push that branch and merge it through a pull request into protected `main`.
- Local hooks provide fast feedback; GitHub branch protection is the authoritative merge boundary.
- Never use `--no-verify`.

## Pre-commit

`.husky/pre-commit` blocks commits unless all of the following are true:

- staged TypeScript files pass `pnpm lint --quiet`

Documentation-only commits skip application linting. Full type, build, test, and coverage checks run at pre-push and again in GitHub Actions.

## Pre-push

`.husky/pre-push` blocks pushes unless all of the following are true:

- TypeScript and the Vite build pass
- frontend coverage passes
- Rust lint and Rust coverage pass when `src-tauri/` changed
- the curated Playwright core smoke lane passes via `pnpm playwright:smoke`

The hook accepts feature branches, detached-HEAD branch pushes, and tags. It does not decide who may update `main`; GitHub's protected-branch rule rejects direct updates and requires the PR checks.

Run the branch-policy regression directly with:

```bash
.husky/tests/pre-push-feature-branch.sh
```

## Legacy Files

Legacy hook implementations under `.github/hooks/` have been removed. Use Husky and `.husky/` only. `install-hooks.sh` remains as a reinstall helper that runs Husky.

## Troubleshooting

If a hook cannot find `node` or `pnpm`:

```bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm use node
```

Then retry the commit or push.
