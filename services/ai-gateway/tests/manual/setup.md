# Setup for a manual round

Everything that has to be in place before the first box: the toolchain, the
stack, the accounts — and the things that silently invalidate a whole pass. The
suites themselves sit in [`suites/`](suites).

## Prerequisites

| Need | Get it |
|---|---|
| **Toolchain** | bun installs, node runs everything. `bun install` at the repo root once. |
| **Browser engines** | `npx playwright install chromium firefox webkit` once — the cross-engine boxes and every chauffeur script need them. |
| **A viewport** | 1440×900 is the default; responsive boxes name their own. |

| **Fixed secrets** | The four in [`../../.env.example`](../../.env.example), exported before the server starts. Development generates any that are absent — and a generated `AI_GATEWAY_ENCRYPTION_KEY` cannot read what the previous run sealed, so a round without fixed secrets loses its accounts at every restart. |
| **A Claude subscription** | A Pro or Max account you own, signed in in the round's browser. Needed from `ACCT-1`. |
| **A ChatGPT subscription** | A Plus or Pro account you own, signed in in the same browser. Needed from `ACCT-3`. |
| **Both vendor CLIs** | `claude` and `codex` on the path, for the hand-out boxes `ACCT-8` and `ACCT-9`. |
| **A scratch data directory** | `AI_GATEWAY_DATA_DIR` pointing somewhere disposable — the round adds and removes real credentials. |

## Baseline

A round is only honest about a tree whose gates were green **before** it
started. Run these on an untouched checkout and note the results in the
[session log](runs/template-session-log.md); anything already red is
environment, not a finding.

| Gate | Command | From |
|---|---|---|
| the whole check | `bun run check` | repo root |
| the manual layer's own shape | `bun run lint:manual` | repo root |

## Starting the stack

```bash
export AI_GATEWAY_API_KEY=…            # see ../../.env.example
export AI_GATEWAY_PANEL_PASSWORD=…
export AI_GATEWAY_SESSION_SECRET=…
export AI_GATEWAY_ENCRYPTION_KEY=…     # 32 base64 bytes
export AI_GATEWAY_DATA_DIR=/tmp/ai-gateway-round

bun run --filter @tale/ai-gateway dev   # Vite + the API on :3004
```

The app serves at **http://localhost:3004**. Wait for the first route to
render before continuing.

<a id="reset-choreography"></a>

## Reset choreography

The single source of truth — every "reset" elsewhere in these files means
exactly this.

1. **Reset only at the boundaries the suites name.** A reset in the middle of an
   ordered suite destroys the state its later boxes consume.
2. **The reset is `rm -f "$AI_GATEWAY_DATA_DIR/accounts.json"`, with the
   server stopped.** That file is the whole state: the accounts, their
   encrypted tokens and any half-finished authorization. Nothing else persists
   — there is no database, no cache and no server-side session store.
3. **A reset wipes the accounts, but not your sign-in.** The panel session is
   a signed cookie with nothing behind it, so an open tab stays signed in and
   simply shows the empty state on its next read. Changing
   `AI_GATEWAY_SESSION_SECRET` is what signs everyone out.
4. **The automated suites write nothing.** Every e2e spec stops at a closed
   door, so `bun run --filter @tale/ai-gateway test:e2e` cannot disturb a
   round's accounts — but it will reuse a dev server already on :3004 and send
   wrong-password attempts through it. See
   [`reference/automation.md`](reference/automation.md).
5. **Exactly one writer at a time.** The background refresh pass inside the
   running server is the other writer: it rewrites the document every
   `AI_GATEWAY_REFRESH_INTERVAL_SECONDS` and will recreate a file you delete
   underneath it. Stop the server before resetting — `lsof -ti :3004` names
   anything still holding the port.

## Accounts

Nothing is seeded: a credential pool starts empty by construction, and every
account a round uses is a real subscription its owner authorizes during the
round. Record which ones you used in the round's session log — a finding about
a plan's usage windows is unreadable without knowing which plan.

| Account | Role | Used by |
|---|---|---|
| the panel password | the only login there is; no roles, no user list | every suite |
| a Claude Pro/Max account you own | the Anthropic half of the pool | `ACCT-1`, `ACCT-2`, `ACCT-8` |
| a ChatGPT Plus/Pro account you own | the OpenAI half | `ACCT-3`, `ACCT-4`, `ACCT-9` |

## Clean room

When the working clone is busy — a dev server on the port, a half-applied
migration, uncommitted edits — take a clean room instead of judging a tree you
cannot describe: a fresh clone at the SHA under test, its own install, its own
stack. The round record names the SHA either way.
