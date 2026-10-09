#!/bin/bash
# Runs one unattended task inside the bounds in .claude/bounded-run.json.
# Usage: scripts/bounded-run.sh "<task>" <result.json>
set -u
if [ $# -ne 2 ]; then
  echo 'Usage: scripts/bounded-run.sh "<task>" <result.json>' >&2
  exit 2
fi
before=$(git rev-parse --short HEAD)
claude -p "$1" \
  --setting-sources project \
  --settings .claude/bounded-run.json \
  --permission-mode dontAsk \
  --model sonnet \
  --max-turns 15 \
  --max-budget-usd 2 \
  --output-format json > "$2"
status=$?
jq '{subtype, num_turns, total_cost_usd, denied: [.permission_denials[]? | .tool_input.command // .tool_name]}' "$2"
echo "HEAD before: $before, after: $(git rev-parse --short HEAD)"
git status --short
exit "$status"
