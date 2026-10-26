# Dependency patches

Bun applies each patch here at install time, through the root `package.json`'s
`patchedDependencies`; `bun.lock` records the same map. Make or change one with
`bun patch <package>`, edit `node_modules/<package>`, then `bun patch --commit node_modules/<package>`
(drop any `.bun-tag-*` file the command adds to the diff).

`bun install` refuses to run when a listed patch file is missing, so every Dockerfile that installs
from the root manifests copies this directory (`COPY patches/ ./patches/`): the platform (its
`workspace-deps` stage and its pruner), web, docs, ui-docs and the service template in
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

A second defect, found by the 2026-10 load run: under load a transaction can start without owning its
connection. `begin()` learns which connection its `BEGIN` runs on only through the `onexecute` hook,
which `execute()` calls last in an `&&` chain behind `sent.length < max_pipeline` (and behind the
socket's backpressure answer). When the pool has pipelined `max_pipeline` (100) plain statements onto a
busy connection and the `BEGIN` is the one that fills it, the hook is skipped though the `BEGIN` is
written. Its `CommandComplete` then finds no reservation (`UNSAFE_TRANSACTION`) and the connection goes
back to the pool inside the transaction. The next `begin` on it logs `there is already a transaction in
progress` or fails with 25001 (`SET TRANSACTION ISOLATION LEVEL must be called before any query`), and
the aborted transaction never returns to idle, so its slot leaks. A 4,000-user spike answered HTTP 500s
and left `idle in transaction (aborted)` sessions; a steady 4,000-user run did not, because pipelines
stay shallow. Upstream:
[porsager/postgres#1189](https://github.com/porsager/postgres/issues/1189) (this ordering),
[#823](https://github.com/porsager/postgres/issues/823) (the intermittent symptom) and
[#1210](https://github.com/porsager/postgres/issues/1210); the earlier fix proposal #1159 was closed
unmerged.

**What.** The same change goes into each build the package ships: `src/` (`import`, Bun), `cjs/src/`
(`require`) and `cf/src/` (workerd).

- `connection.js`, `execute`: `onexecute` runs once the statement is written, whether or not the
  connection can take more pipelined statements, so a full pipeline or a backpressured socket no longer
  skips it. Its return value is unchanged: the connection still counts as full while a transaction
  holds it.

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
connection. The `begin-fills-the-pipeline` case (a pool of two with `max_pipeline: 3`, the `begin` the
seventh statement) fails unpatched with `UNSAFE_TRANSACTION`; patched, the transaction commits and no
other statement ever runs on a connection inside it.

**Behaviour change.** A statement issued on a transaction handle after its `COMMIT`, or on a
released reservation, now rejects with `CONNECTION_CLOSED` instead of running on the pool's
connection outside the transaction. No platform code does this (checked by grep).

**Not changed.** A `sql.reserve()` that waits for a connection can still be dropped if another
connection closes and the pool reconnects that one for it: upstream's `onclose` hands the request to
the reconnect, whose type fetch discards it.

**Remove it when** a postgres.js release fixes all of this. That means the write to a closed
connection, what `closed()` leaves pending, the pool's hand-back of a closed connection, and the order
in which `execute()` calls `onexecute` (#1189). Then bump
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

## `zod@4.6.6.patch`

**Why.** zod 4.6.6 is the first release that fixes
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) (memory exhaustion while
validating an oversized constrained collection), which the Security workflow's audit gates refuse.
The 4.4 and 4.5 releases on the way also changed four behaviours Tale is built on, and the patch
keeps them as 4.3.6 had them, so the upgrade changes nothing a caller sees:

- **String length.** `.min()`, `.max()` and `.length()` count Unicode code points since 4.5
  ([colinhacks/zod#6441](https://github.com/colinhacks/zod/pull/6441)). Tale states every string cap
  in UTF-16 code units, `String.length` ("most emoji count as 2"), in the API reference, the MCP
  page and its own refusals, and its domain checks measure the same unit.
- **Error precedence.** Since 4.5 a schema's own error map also phrases the issues its checks raise,
  ahead of the map the parse call passes ([#6426](https://github.com/colinhacks/zod/pull/6426)).
  The doors parse with `houseIssueMessage` and give a schema an error of its own for its type alone
  (`z.int({ error: 'must be a whole number' }).min(1)`), so a range, or an issue a refinement raises
  again, lost its house words; the repository has about 300 such schema-level errors.
- **JSON Schema.** Since 4.5 `toJSONSchema` folds an `anyOf` of bare types into a `type` array
  ([#6339](https://github.com/colinhacks/zod/pull/6339)). That rewrote ten nullable fields of the
  tool schemas the MCP endpoint advertises, and with them its contract fingerprint. The OpenAPI
  document renders for `openapi-3.0`, which Zod never folds.
- **Absent keys.** Since 4.4 an object refuses a missing key unless its schema is optional on input
  (`.optional()`, a default or a catch), even when the schema takes `undefined`: `z.unknown()`,
  `z.any()`, `.or(z.undefined())` or an unchecked `z.custom()`. The issue says `nonoptional`
  ([#5661](https://github.com/colinhacks/zod/pull/5661)). Tale reads keys like these as possibly
  missing: the `document` of an automation save or check, the `input` and `caller` of a connector
  action run on an automation's or a chat's behalf. The integration check's reader of a shared chat
  refused the snapshot, whose messages leave an empty `blockedReason` and `error` out.

**What.** The same change goes into each build the package ships: `v4/core/*.js` (`import`),
`v4/core/*.cjs` (`require`) and `src/v4/core/*.ts` (the `@zod/source` condition). The hunks are
marked `Tale:`.

- `util`, `codePointLength`: returns `str.length`. Every length check, interpreted or compiled
  (`compile`), measures a string through it.
- `util`, `finalizeIssue`: the owning schema's map is no longer asked about a check's issue.
- `to-json-schema`, `compactTypeUnion`: returns at once.
- `schemas`, `handlePropertyResult` and the compiled object parser (`$ZodObjectJIT`): an absent key
  is judged as in 4.3.6. No `nonoptional` issue is raised, an optional-out schema's issues are
  dropped, and the key is written only when the schema made a value of it.

**Proof.** `packages/shared/src/schemas/zod-patch.test.ts` states the four behaviours on plain
schemas; on unpatched 4.6.6 each of its cases fails. In context, these failed on 4.6.6 without the
patch: `services/platform/backend/rest/shared.test.ts` (an emoji counts 2 against a cap),
`services/platform/backend/domains/mcp/protocol.test.ts` (a range and a version field keep their
house words), `services/platform/lib/mcp/contract.test.ts` (the advertised schemas and their
fingerprint), and the integration check's two share-link checks (the snapshot's messages).

**Behaviour change.** None against 4.3.6, which Tale ran before. The other changes of 4.4 to 4.6 are
taken as they come; their "potentially breaking" fixes of the release notes leave every suite green.
The CLI's provider policy and break-glass checks say `.optional()` where a key may be absent, which
reads the same with the patch and without it.

**Remove it when** Tale decides each behaviour on purpose. That means counting caps in code points
(the API reference, the MCP page and the domain checks change with it, in every locale), scoping its
schema-level errors to the issues they name, advertising type arrays under a new
`API_CONTRACT_VERSION`, and marking `.optional()` every object key that may be missing. A hunk can
go on its own: regenerate the rest with `bun patch`, and keep the proof test's cases for the
behaviours that stay.
