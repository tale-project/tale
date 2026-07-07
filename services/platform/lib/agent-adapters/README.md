# @tale/agent-adapters

Entry-agnostic adapters for driving coding agents (Claude Code, Cursor,
OpenCode, Hermes Agent, Gemini CLI, Codex) inside a Tale sandbox session.

Two responsibilities, both pure logic with **zero runtime dependencies**:

1. **`buildExec(spec)`** — turn a normalized `AgentRunSpec` (prompt, model,
   resume handle, gateway endpoint+token, workdir) into a `SessionExecSpec`
   (`argv` + `env` + `cwd` + `stdin`) the sandbox session-exec API runs. Most
   agents ride the prompt on stdin; argv-positional runtimes (Cursor) are the
   documented exception.
2. **`createParser()`** — incrementally consume the agent's native stdout
   stream (Claude Code `--output-format stream-json`, Cursor `agent -p
--output-format stream-json`) and emit one normalized `AgentEvent` union, so
   any entry point (chat, workflow node, …) renders progress + meters usage the
   same way.

The sandbox service stays 100% agent-agnostic — it only ships the generic
session exec primitive. This package is the seam every entry point reuses.

```bash
bun run --filter @tale/agent-adapters typecheck
bun run --filter @tale/agent-adapters test
```

Source-only library — no build step. Consumers import directly from `./src/`.

## Fixtures

`fixtures/<agent>/*.jsonl` are sanitized recordings of real agent runs. Golden
tests feed them (including pathological mid-line chunk splits) through the
parser and assert the normalized `AgentEvent[]`. To record a new fixture see
`scripts/record-fixture.md`.
