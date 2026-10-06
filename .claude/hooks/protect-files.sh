#!/bin/bash
# Blocks Edit and Write on .env files (but not .env.example) and on anything
# in a secrets/ folder. Exit 2 blocks the call; stderr goes to Claude.
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
FILE_PATH="${FILE_PATH//\\//}"
NAME=$(basename "$FILE_PATH")

case "$NAME" in
  .env.example) ;;
  .env | .env.*)
    echo "Blocked: $FILE_PATH is an environment file" >&2
    exit 2
    ;;
esac

case "/$FILE_PATH" in
  */secrets/*)
    echo "Blocked: $FILE_PATH is in a secrets folder" >&2
    exit 2
    ;;
esac

exit 0
