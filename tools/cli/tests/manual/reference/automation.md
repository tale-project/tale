# What the automated suites already own

Manual effort is expensive; spend it where a headless run cannot judge. Read
this before hand-verifying anything, and read the seam notes before running any
suite alongside the automated ones.

## The lanes

A red lane is a failure of the gate, never a finding of a round.

| Lane | Command | What it proves |
|---|---|---|
| unit | `bun run --filter @tale/cli test` (repo root) | the CLI's modules and commands over fixtures and fakes, and the repository guards under `tools/cli/scripts/` |
| compiled binary | `TALE_BINARY=dist/tale bun run test tests/` (in `tools/cli`, after a build) | the command suites under `tests/` against the binary; `tests/smoke.test.ts` holds the binary itself: `--version`, `--help` and the grouped overview, the help of `init`, `dev`, `deploy` and `uninstall`, `uninstall --dry-run`, `init` scaffolding a project, `dev` run from a parent directory |

## Coverage map

One row per area. **Don't** re-verify an `automated` row by hand: a red there is
a spec failure and belongs in the gate, not in a round.

| Area | Owning spec | Manual scope |
|---|---|---|
| The compiled binary starts, names its version, prints its help and scaffolds a project | `tools/cli/tests/smoke.test.ts` | — |
| A deployment on Incus on real hosts: bootstrap, certificates from a real issuer, a reboot, a second host | — | **manual-only** — a fresh machine, a public name and a host that reboots are outside every automated lane: [incus-runtime](../suites/incus-runtime.md) |

Legend: a named spec owns the row end to end · a named spec **plus** a manual
scope is partial · `—` is manual-only.

## Seams

Anything that makes an automated run and a manual round interfere. Name it here,
and name the direction: which one destroys the other's state, and what the
survivor looks like when it happens.

- The unit and compiled-binary lanes work in temporary directories on the
  machine that runs them. Run them on a workstation, never on a round's host,
  where the `tale` they start is a second writer
  ([setup.md](../setup.md#reset-choreography)).

## Moving a box here

When a spec takes a box over end to end, **delete the box and add its row here
in the same commit**, naming the spec. A box that survives its automation is
manual effort spent twice; a row that names a deleted spec is worse, so
`bun run lint:manual` rejects a box ID here that no suite defines.
