#!/bin/bash

INPUT=$(cat)

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

if [[ "$FILE_PATH" =~ \.(ts|tsx|js|jsx|mjs)$ ]]; then
  npx oxfmt -c "$CLAUDE_PROJECT_DIR/.oxfmtrc.json" "$FILE_PATH" 2>/dev/null
fi

if [[ "$FILE_PATH" =~ \.py$ ]]; then
  uv run ruff format "$FILE_PATH" 2>/dev/null
fi

exit 0
