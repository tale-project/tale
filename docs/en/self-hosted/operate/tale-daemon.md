---
title: tale-daemon
description: Run task work on your own machines with local coding-agent CLIs (Claude Code, Codex, OpenCode) — setup, pacing, isolation, permissions, and failure handling.
---

`tale-daemon` executes Tale board tasks on a machine you control, using the coding-agent CLIs you already have: **Claude Code** (`claude`), **Codex** (`codex`), and **OpenCode** (`opencode`). Bind an agent to a runtime in its configuration and its assigned tasks are dispatched to the daemon instead of Tale's internal model loop; the result lands back on the task as a comment (with a diff stat) and the task parks at _In review_ like any other agent work.

## Setup

```sh
bunx tale-daemon setup    # base URL, API key, workspace, permission ceiling
bunx tale-daemon start    # register + claim loop (Ctrl-C drains the run)
bunx tale-daemon status   # config, detected CLIs, server connectivity
```

`setup` generates a stable daemon identity and stores configuration at `~/.tale-daemon/config.json` (mode 600). Use a normal Tale API key (**Settings → API → REST**); set `TALE_DAEMON_API_KEY` to keep the key out of the file. Connected daemons appear under **Settings → API → Runtimes** with live status.

## Privacy & permissions

- Local workspace **paths never leave the machine** — only the workspace _keys_ you choose are advertised to the server.
- The effective permission of a run is **min(server-configured, daemon ceiling)**. `full_auto` (skip-permissions / full sandbox access) therefore requires opting in on _both_ sides. The default is `safe`.

## How runs execute

- **Pacing**: the daemon polls for work with server-driven backoff (3 s after work, 15 s idle, capped at 60 s after ten idle minutes — an idle daemon costs about one request per minute). A 15 s heartbeat during runs renews the server lease and picks up cancellations (SIGTERM).
- **Isolation**: every run executes in its own git worktree on a `tale/run-…` branch. Nothing is pushed; the diff stat rides along with the report.
- **Sessions**: revision runs (review feedback) resume the previous CLI session where the adapter supports it.

## Failure handling

| Situation                               | Behavior                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------ |
| No daemon claims a run within 2 minutes | Run fails (`runtime_offline`), task rolls back to _To do_ with a comment |
| Daemon dies mid-run (lease lost)        | One retry from a clean worktree, then failure                            |
| Run exceeds 30 minutes                  | Hard timeout, failure handling as above                                  |
| CLI exits non-zero                      | One retry, then failure with the error excerpt                           |

All external runs share the internal run record, so budgets, concurrency caps, and metrics apply identically.
