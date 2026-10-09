#!/usr/bin/env bash
# Reviews the staged diff with Claude Code and saves the JSON result.
# Usage: scripts/review-staged.sh [result.json]   (default: .practice/a-4-result.json)
set -uo pipefail
out="${1:-.practice/a-4-result.json}"

if git diff --cached --quiet; then
  echo "Nothing is staged. Stage a change with git add, then run this again." >&2
  exit 2
fi

mkdir -p "$(dirname "$out")"
git diff --cached | claude -p "Review this staged diff for bugs, missing tests and unclear code. List each problem as file:line and one sentence, then say whether it is ready to commit." \
  --output-format json --permission-mode dontAsk --allowedTools "Read,Grep,Glob" --max-turns 5 > "$out"
status=$?

jq -r '.result // empty' "$out"
if [ "$status" -ne 0 ] || [ "$(jq -r '.is_error' "$out")" != "false" ]; then
  subtype=$(jq -r '.subtype // empty' "$out" 2>/dev/null)
  echo "The review failed${subtype:+ ($subtype)}." >&2
  exit 1
fi
