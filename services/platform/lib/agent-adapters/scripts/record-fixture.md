# Recording agent stream-json fixtures

Golden fixtures live under `fixtures/<agent>/`. Each file is a sanitized NDJSON
recording of a real agent run.

## Steps

1. Run the agent in a sandbox session with `--output-format stream-json` (or the
   runtime's documented JSONL mode).
2. Capture stdout to a file, one JSON object per line.
3. Redact secrets, tokens, absolute paths, and org-specific ids.
4. Add the file under `fixtures/<agent>/` and extend `parse.test.ts` with a
   chunked parse assertion (sizes `1, 3, 7, 13, 37, 128`).

## Cursor

```bash
agent -p --force --trust --sandbox disabled \
  --output-format stream-json \
  --workspace /user/workspace \
  "Fix issue #1 and open a PR" > /tmp/cursor-run.jsonl
```

## Claude Code

```bash
claude -p --output-format stream-json --input-format stream-json \
  --permission-mode bypassPermissions \
  --max-turns 40 < prompt.txt > /tmp/claude-run.jsonl
```

## OpenCode

Inject the adapter's config via env (managed-only runtime — point the gateway
baseURL at a real gateway or a local OpenAI-compatible mock; the token rides
`{env:TALE_GATEWAY_TOKEN}`):

```bash
OPENCODE_CONFIG_CONTENT="$(cat config.json)" TALE_GATEWAY_TOKEN=… \
  opencode run --format json --dir /user/workspace \
  "Fix issue #1 and open a PR" > /tmp/opencode-run.jsonl
```

`fixtures/opencode/simple-turn.jsonl` was captured this way from the pinned
v1.17.3 CLI against a local mock gateway.
