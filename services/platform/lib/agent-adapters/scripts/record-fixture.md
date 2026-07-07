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

## Gemini CLI

Headless prompt rides stdin; force the API-key auth type via a system settings
file (with `GOOGLE_GEMINI_BASE_URL` set, env inference picks the "gateway"
auth type, which headless auth validation rejects at 0.49.0). Point the base
URL at a real gateway or a local GenAI-protocol mock:

```bash
cat > /tmp/gemini-settings.json <<'JSON'
{ "security": { "auth": { "selectedType": "gemini-api-key" } } }
JSON
GEMINI_API_KEY=… GOOGLE_GEMINI_BASE_URL=http://…/genai \
GEMINI_CLI_SYSTEM_SETTINGS_PATH=/tmp/gemini-settings.json \
  gemini --output-format stream-json --approval-mode yolo --skip-trust \
  -m gemini-2.5-pro <<<"Run echo hello" > /tmp/gemini-run.jsonl
```

`fixtures/gemini/shell-turn.jsonl` was captured this way from the pinned
0.49.0 CLI against a local mock GenAI gateway (the shell tool call ran for
real).
