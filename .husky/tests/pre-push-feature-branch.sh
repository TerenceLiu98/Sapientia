#!/bin/sh
set -eu

REPO_ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/sapientia-pre-push.XXXXXX")
trap 'rm -rf "$TEST_ROOT"' EXIT HUP INT TERM

REMOTE_PATH="$TEST_ROOT/remote.git"
WORK_PATH="$TEST_ROOT/work"
FAKE_BIN="$TEST_ROOT/bin"

git init --bare --quiet "$REMOTE_PATH"
git init --quiet "$WORK_PATH"
git -C "$WORK_PATH" config user.email "hook-test@example.com"
git -C "$WORK_PATH" config user.name "Hook Test"
git -C "$WORK_PATH" config core.hooksPath "$TEST_ROOT/empty-hooks"
git -C "$WORK_PATH" remote add origin "$REMOTE_PATH"
git -C "$WORK_PATH" checkout --quiet -b main

mkdir -p "$WORK_PATH/docs" "$WORK_PATH/.github/hooks" "$FAKE_BIN" "$TEST_ROOT/empty-hooks"
printf '%s\n' '# Baseline' > "$WORK_PATH/docs/hook-policy.md"
printf '%s\n' '#!/bin/sh' > "$WORK_PATH/.github/hooks/legacy-pre-push"
git -C "$WORK_PATH" add docs/hook-policy.md .github/hooks/legacy-pre-push
git -C "$WORK_PATH" commit --quiet -m "docs: add hook policy fixture"
git -C "$WORK_PATH" push --quiet --set-upstream origin main
git -C "$WORK_PATH" checkout --quiet -b feature/hook-policy

printf '%s\n' 'Feature branch update.' >> "$WORK_PATH/docs/hook-policy.md"
rm "$WORK_PATH/.github/hooks/legacy-pre-push"
git -C "$WORK_PATH" add docs/hook-policy.md .github/hooks/legacy-pre-push
git -C "$WORK_PATH" commit --quiet -m "docs: update hook policy fixture"

for TOOL in node pnpm; do
  printf '%s\n' '#!/bin/sh' 'echo "Unexpected application check" >&2' 'exit 99' > "$FAKE_BIN/$TOOL"
  chmod +x "$FAKE_BIN/$TOOL"
done

LOCAL_SHA=$(git -C "$WORK_PATH" rev-parse HEAD)
REMOTE_SHA=0000000000000000000000000000000000000000

if ! OUTPUT=$(
  cd "$WORK_PATH"
  PATH="$FAKE_BIN:$PATH" "$REPO_ROOT/.husky/pre-push" origin "$REMOTE_PATH" <<EOF
refs/heads/feature/hook-policy $LOCAL_SHA refs/heads/feature/hook-policy $REMOTE_SHA
EOF
); then
  printf '%s\n' "$OUTPUT"
  printf '%s\n' 'Expected pre-push to allow a feature branch.' >&2
  exit 1
fi

printf '%s\n' 'Feature-branch pre-push policy passed.'
