#!/bin/bash
# PostToolUse(Edit|Write): format the just-edited file in place so the tree never drifts.
# Reads the hook payload on stdin; formats by extension. Silent on failure — never blocks an edit.

INPUT=$(cat)

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

if [[ "$FILE_PATH" =~ \.(ts|tsx|js|jsx|mjs|cjs|mts|cts|json|jsonc|md|mdx|css|scss|yaml|yml|html)$ ]]; then
  bunx oxfmt -c "$CLAUDE_PROJECT_DIR/.oxfmtrc.json" "$FILE_PATH" 2>/dev/null
fi

if [[ "$FILE_PATH" =~ \.py$ ]]; then
  uv run ruff format "$FILE_PATH" 2>/dev/null
fi

exit 0
