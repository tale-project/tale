# Setup for a manual round

Everything that has to be in place before the first box: the toolchain, the
binary under test, the hosts, the accounts — and the things that silently
invalidate a whole pass. The suites themselves sit in [`suites/`](suites).

## Prerequisites

| Need | Get it |
|---|---|
| **Toolchain** | Bun, the version the root `package.json` pins in `packageManager`: it builds and tests the CLI and is compiled into the binary. `bun install --frozen-lockfile` at the repo root once. |
| **The binary under test** | the compiled `tale`, built from the SHA under test ([below](#the-binary-under-test)) — never `bun tools/cli/src/index.ts`, which is not what an operator runs. |
| **Hosts** | Linux machines you may wipe, reachable over SSH: a virtual machine with a snapshot of its just-installed state is the cheapest. A suite's group names what it needs — a fresh host, a second host, a public name. |

<!-- Add every precondition a box assumes: the runtime a host needs and how it
     is installed, a public DNS name and the ports it must reach, credentials, a
     second host. A precondition a round discovers at box 40 has already cost it
     the pass. -->

## Baseline

A round is only honest about a tree whose gates were green **before** it
started. Run these on an untouched checkout and note the results in the
[session log](runs/template-session-log.md); anything already red is
environment, not a finding.

| Gate | Command | From |
|---|---|---|
| the whole check | `bun run check` | repo root |
| the manual layer's own shape | `bun run lint:manual` | repo root |

<a id="the-binary-under-test"></a>

## The binary under test

```bash
bun run --filter @tale/cli build:host    # tools/cli/dist/tale for this machine
bun run --filter @tale/cli generate      # or, for a Linux host: embed the reference files,
bun run --filter @tale/cli build:linux   # then compile for x64 (build:linux-arm64 for arm64)
```

Each writes `tools/cli/dist/tale`; build one target at a time.

Copy the binary to each host and run it there the way an operator does: as the
operator account, from the deployment's directory, with nothing on `PATH` or in
the environment that production would not have. Record `tale --version` and the
SHA it was built from in the session log.

<a id="reset-choreography"></a>

## Reset choreography

The single source of truth — every "reset" elsewhere in these files means
exactly this.

1. **Reset only at the boundaries the suites name.** A reset in the middle of an
   ordered group destroys the state its later boxes consume.
2. **A reset is the host's snapshot, never a `tale` command.** Restore the
   machine to its just-installed snapshot: `tale reset`, `tale uninstall` and
   their kind are behaviour under test, and a reset that runs them judges
   nothing.
3. **A reset wipes everything on that host** — the deployment, its data, its
   backups and its certificates. Copy out what a later box still needs first.
4. **The automated suites bring their own hosts and names.** Never point one at
   a round's host, and never run a round on a host an automated run uses.
5. **Exactly one writer at a time.** Nothing else may run `tale`, a deploy, or
   the runtime's own client against the same host during a round — no second
   shell, no scheduled job, no deploy pipeline. Prove it before the first box.

## Accounts

| Account | Role | Used by |
|---|---|---|
| the operator | the SSH login on each host that runs `tale` | every box |

<!-- One row per further account a box signs in as: the platform's first
     administrator a deployment creates, a second operator. A round that has
     to invent an account is a round whose findings nobody can reproduce. -->

## Clean room

When the working clone is busy — a dev server on the port, a half-applied
migration, uncommitted edits — take a clean room instead of judging a tree you
cannot describe: a fresh clone at the SHA under test, its own install, its own
binary. The round record names the SHA either way.
