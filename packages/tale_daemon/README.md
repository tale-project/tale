# tale-daemon

Run Tale task work on your own machine with the coding-agent CLIs you
already use. Agents bound to an external runtime (`runtime` in the agent
config) get their board tasks dispatched here instead of Tale's internal
LLM loop; the daemon executes the run in an isolated git worktree and
reports the result back, where it lands as a task comment and parks the
task at **In review** for a human.

## Quick start

```sh
bunx tale-daemon setup    # base URL, API key, workspace, permission ceiling
bunx tale-daemon start    # register + claim loop (Ctrl-C drains the run)
bunx tale-daemon status   # config, detected CLIs, server connectivity
```

Supported CLIs (auto-detected on PATH): **Claude Code** (`claude`),
**Codex** (`codex`), **OpenCode** (`opencode`).

## How it works

- **Identity**: `setup` generates a stable `daemonId`; the API key is a
  normal Tale API key (Settings → API). Config lives at
  `~/.tale-daemon/config.json` (chmod 600); set `TALE_DAEMON_API_KEY` to
  keep the key out of the file.
- **Privacy**: local workspace paths never leave the machine — only the
  workspace _keys_ you choose are advertised to the server.
- **Pacing**: claim polling is server-driven (3s after work, 15s idle,
  client-capped at 60s after ten idle minutes); a 15s heartbeat renews the
  run lease and picks up server-side cancellations (SIGTERM).
- **Isolation**: every run executes in its own git worktree on a
  `tale/run-…` branch; the diff stat rides along with the report. Nothing
  is ever pushed.
- **Permissions**: the effective mode is
  `min(server-configured, local ceiling)` — `full_auto`
  (skip-permissions / danger-full-access) requires opting in on **both**
  sides. Default is `safe`.
- **Failure handling**: lease loss and CLI crashes retry once on the
  server side; unclaimed runs fail after 2 minutes and the task rolls
  back to To do with an explanatory comment.
