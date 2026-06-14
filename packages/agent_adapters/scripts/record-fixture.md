# Recording adapter fixtures

The golden parser tests run against `fixtures/<agent>/*.jsonl` — sanitized
recordings of real agent runs. To add or refresh one (requires a developer
with live gateway/provider credentials; never run in CI):

## Claude Code

```sh
claude -p "your task" \
  --output-format stream-json --verbose --include-partial-messages \
  --permission-mode bypassPermissions --max-turns 5 \
  > fixtures/claude_code/<name>.jsonl
```

## OpenCode

```sh
opencode run --format json --dir /path/to/repo "your task" \
  > fixtures/opencode/<name>.jsonl
```

## Sanitize before committing

- Replace real session ids, repo URLs, file paths, and any secret-looking
  strings with placeholders.
- Keep the event ordering and the `usage` / `step_finish` token numbers — the
  golden test asserts the normalized usage totals.
- Verify the parser still produces the expected `AgentEvent[]`:
  `bun run --filter @tale/agent-adapters test`.
