# Dependency patches

Bun applies each patch here at install time, through the root `package.json`'s
`patchedDependencies`; `bun.lock` records the same map. Make or change one with
`bun patch <package>`, edit `node_modules/<package>`, then `bun patch --commit node_modules/<package>`
(drop any `.bun-tag-*` file the command adds to the diff).

`bun install` refuses to run when a listed patch file is missing, so every Dockerfile that installs
from the root manifests copies this directory (`COPY patches/ ./patches/`): the platform (its
`workspace-deps` stage and its pruner), web, docs, ui-docs, ai-gateway and the service template in
`tools/plop`.

## `postgres@3.4.7.patch`

**Why.** postgres.js 3.4.7 (and 3.4.9, the latest release) crashes the process when a PostgreSQL
server process dies under an open transaction or a reserved connection: a crash, the OOM killer, an
immediate shutdown, `docker kill` ([#4041](https://github.com/tale-project/tale/issues/4041)). The
closed connection's socket is nulled, then `begin()`'s `ROLLBACK`, or the reservation's next
statement, is written to it from an Immediate: an uncaught
`TypeError: Cannot read properties of null (reading 'write')`. Upstream:
[porsager/postgres#1154](https://github.com/porsager/postgres/issues/1154) and
[#1208](https://github.com/porsager/postgres/issues/1208), with the guard proposed in
[#1209](https://github.com/porsager/postgres/pull/1209); all open.

**What.** The same change goes into each build the package ships: `src/` (`import`, Bun), `cjs/src/`
(`require`) and `cf/src/` (workerd).

- `connection.js`, `nextWrite`: #1209's guard, verbatim. A write to a closed connection rejects
  the pending statements with `CONNECTION_CLOSED` instead of throwing.
- `connection.js`, `closed()`, beyond #1209:
  - It settles what is still pending even after a socket error. On a reset, the error event
    rejects what was pending then, but begin()'s `ROLLBACK` is written before the close. Unsettled,
    that `ROLLBACK` would take the reconnected connection's first answer.
  - It drops a cancelled write together with its timer, which would otherwise keep the next
    StartupMessage from ever being sent.
  - It no longer leaves the settled statement in `query`, where it kept `sql.end()` from resolving.
- `index.js`, beyond #1209 (the hunks marked `Tale:`):
  - A transaction's or a reservation's statement runs only while it still holds its connection
    (`c.reserved` is still its own); otherwise it rejects with `CONNECTION_CLOSED`.
  - Statements queued behind a busy connection reject when it closes.
  - `release()` changes nothing once the reservation no longer holds its connection.

  Without these, the regression suite caught several failures. A one-connection pool hung or kept
  failing on the dead connection. An idle transaction whose connection the pool had reconnected for
  another caller ran its next statement there, outside the transaction, where it committed on its own
  (as unpatched 3.4.7 does).

**Proof.** `services/platform/backend/db/connection-loss.test.ts` runs postgres.js in a child process
through both its ESM and its CommonJS build. The child talks to a fake server that closes or resets the
connection the way a killed server process or a proxy does. Without the patch, the cut cases crash the
child, hang it, or commit the stray statement. With #1209's guard alone, they hang or fail on the dead
connection.

**Behaviour change.** A statement issued on a transaction handle after its `COMMIT`, or on a
released reservation, now rejects with `CONNECTION_CLOSED` instead of running on the pool's
connection outside the transaction. No platform code does this (checked by grep).

**Not changed.** A `sql.reserve()` that waits for a connection can still be dropped if another
connection closes and the pool reconnects that one for it: upstream's `onclose` hands the request to
the reconnect, whose type fetch discards it.

**Remove it when** a postgres.js release fixes all of this. That means the write to a closed
connection, what `closed()` leaves pending, and the pool's hand-back of a closed connection. Then bump
the pin in `services/platform` and `packages/shared`, delete this file's entry and its
`patchedDependencies` line, and keep the regression suite: it must pass on that release unpatched. If a
release fixes only part of it, regenerate the rest against that release with `bun patch`.

## `@tanstack%2Frouter-core@1.168.9.patch`

**Why.** The platform build splits every route component outside the sign-in pages and the landing
into a chunk of its own (`services/platform/vite.config.ts`, `ENTRY_ROUTES`;
[#4089](https://github.com/tale-project/tale/issues/4089)), so preloading such a route waits on its
chunk. When a navigation commits during that wait, `clearExpiredCache` drops the cached matches of
routes without a loader, and `loadRouteMatch` then reads the vanished match: `TypeError: Cannot read
properties of undefined (reading '_nonReactive')`, which `preloadRoute` logs. The sidebar's links
preload their sections on render, so every landing through `/` or `/dashboard` logged it three
times. Router-core already returns early when the match is gone before its loader runs
(`shouldSkipLoader`); only the two reads after an await lacked the check. 1.168.18, the last 1.168
release, reads them the same way; 1.171.34 has a rewritten loader (`load-client.js`).

**What.** In `loadRouteMatch` (`dist/esm/load-matches.js` and `dist/cjs/load-matches.cjs`), each
`inner.router.getMatch(matchId)` after an await returns `inner.matches[index]` when the match is
gone, as the branch that skips the loader does. The hunks are marked `Tale:`.

**Proof.** `services/platform/app/lib/router-split-preload.test.ts` preloads a split route without a
loader, navigates elsewhere while its chunk is pending, then delivers the chunk: unpatched, the
preload logs the `TypeError`; patched, it settles quietly, and an uninterrupted preload still loads
the route.

**Behaviour change.** None beyond the missing error: the dropped match was never going to be used.

**Remove it when** the router packages move to a release whose loader passes the test unpatched
(1.171's rewrite is the candidate). Bump `@tanstack/react-router` and the router plugin together,
delete this entry and its `patchedDependencies` line, and keep the test.
