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

<!-- Add every precondition a box assumes: credentials, seeded accounts, a
     fixture file, a second browser profile, a device. A precondition a round
     discovers at box 40 has already cost it the pass. -->

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
bun run --filter /ai-gateway dev   # Vite on :3004
```

The app serves at **http://localhost:3004**. Wait for the first route to
render before continuing.

<a id="reset-choreography"></a>

## Reset choreography

The single source of truth — every "reset" elsewhere in these files means
exactly this.

1. **Reset only at the boundaries the suites name.** A reset in the middle of an
   ordered suite destroys the state its later boxes consume.
2. <!-- The command, and what it needs to be allowed to run. -->
3. **A reset wipes everything, sessions included.** Say here what an open tab
   does when it happens, so a round does not file the bounce as a defect.
4. **The automated suites reset too, and leave the database in their end
   state.** Never run one beside a manual round; reset again before resuming.
5. **Exactly one writer at a time.** Name anything else that could be mutating
   the same deployment — a worker, a cron, a second browser profile — and how to
   prove it is stopped.

## Accounts

<!-- One row per seeded account: who they are, what they can see, what a round
     uses them for. A round that has to invent an account is a round whose
     findings nobody can reproduce. -->

| Account | Role | Used by |
|---|---|---|
| | | |

## Clean room

When the working clone is busy — a dev server on the port, a half-applied
migration, uncommitted edits — take a clean room instead of judging a tree you
cannot describe: a fresh clone at the SHA under test, its own install, its own
stack. The round record names the SHA either way.
