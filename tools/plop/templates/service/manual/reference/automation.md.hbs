# What the automated suites already own

Manual effort is expensive; spend it where a headless run cannot judge. Read
this before hand-verifying anything, and read the seam notes before running any
suite alongside the automated ones — they share one environment.

## Coverage map

One row per area. **Don't** re-verify an `automated` row by hand: a red there is
a spec failure and belongs in the gate, not in a round.

| Area | Owning spec | Manual scope |
|---|---|---|
| <area> | `tests/e2e/specs/<name>.spec.ts` | <what the spec cannot judge — layout, focus order, print, two live sessions> |
| <area> | — | **manual-only** — <why no spec owns it> |

Legend: a named spec owns the row end to end · a named spec **plus** a manual
scope is partial · `—` is manual-only.

## Seams

Anything that makes an automated run and a manual round interfere. Name it here,
and name the direction: which one destroys the other's state, and what the
survivor looks like when it happens.

- <e.g. `bun run test:e2e` resets the database at start and leaves it in its end
  state — never run it beside a round; reset before resuming.>

## Moving a box here

When a spec takes a box over end to end, **delete the box and add its row here
in the same commit**, naming the spec. A box that survives its automation is
manual effort spent twice; a row that names a deleted spec is worse, so
`bun run lint:manual` rejects a box ID here that no suite defines.
