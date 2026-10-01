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
- `index.js`, beyond #1209 (the hunks marked `Tale:`). The guard alone still let the pool keep
  a closed connection. In the regression suite that left a one-connection pool hung or failing
  every statement. These hunks make a transaction's or a reservation's statement run only while it
  still holds its connection (`c.reserved` is still its own); otherwise it rejects with
  `CONNECTION_CLOSED`. `release()` also stops handing back a reservation whose connection closed.
  This closes a hazard that predates the crash: without the rule, a transaction that loses its
  connection while idle runs its next statement on the session the pool reconnected, outside the
  transaction, where it commits on its own.

**Proof.** `services/platform/backend/db/connection-loss.test.ts` runs postgres.js in a child process
through both its ESM and its CommonJS build. The child talks to a fake server that drops the
connection the way a killed server process does. Without the patch, the cut cases crash the child or
commit the stray statement. Without the `index.js` hunks, they hang or fail on the dead connection.

**Not changed.** After such a loss, `sql.end()` with no timeout never resolves. The closed connection
keeps its last statement, with or without this patch. The platform always ends a pool with a timeout.

**Remove it when** a postgres.js release fixes both the write to a closed connection and the pool's
hand-back. Then bump the pin in `services/platform` and `packages/shared`, delete this file's entry and
its `patchedDependencies` line, and keep the regression suite: it must pass on that release
unpatched. If a release fixes only the write, regenerate the `index.js` part against it.
