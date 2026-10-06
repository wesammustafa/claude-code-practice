#!/bin/bash
# Blocks Edit and Write inside samples/: the tests depend on its exact files.
FILE_PATH=$(jq -r '.tool_input.file_path // empty')
FILE_PATH="${FILE_PATH//\\//}"
case "$FILE_PATH" in
  "$CLAUDE_PROJECT_DIR"/samples/*)
    echo "Blocked: $FILE_PATH is test data in samples/" >&2
    exit 2
    ;;
esac
exit 0
