---
name: convex
description: How to write Convex backend code in services/platform/convex — queries, mutations, actions, RLS wrappers, validators, auth, pagination, and the node/V8 bundling boundary. Read before editing anything under services/platform/convex/**, adding a query/mutation/action, touching auth in the backend, or wiring an HTTP route in http.ts. Schema migrations have their own guide: convex-migrations.
---

# convex

The contract for backend code in [`services/platform/convex/`](../../../services/platform/convex/).
Convex runs as its own service; function source is pushed on startup and `_generated/api.d.ts` is
committed (regen with `bun run --filter @tale/platform convex:codegen`). Filenames are **snake_case**
here (the one exception to the repo's dash-case rule). Data-model changes go through
[`convex-migrations`](../convex-migrations/SKILL.md); per-query/per-request performance lives in
[`performance`](../performance/SKILL.md).

## When this applies

Editing anything under `services/platform/convex/**` — adding a query/mutation/action, touching
backend auth, or wiring an HTTP route in `http.ts`. A change that reshapes _stored data_ (new
required field, rename, retype, table split/drop, backfill) is a migration first — see
[`convex-migrations`](../convex-migrations/SKILL.md).

## The rules

- **Never `.collect()`.** It pulls the whole result set into memory and scales badly. Iterate with
  `for await`, or use `.paginate()`. Reviewer- and perf-caught.
- **Use the RLS wrappers, not raw `query`/`mutation`.** `queryWithRLS` / `mutationWithRLS` (import
  from [`../lib/rls`](../../../services/platform/convex/lib/rls/index.ts)) inject a
  row-level-security-wrapped `ctx.db` and a request-scoped auth context. Raw `query`/`mutation`
  bypass access control — the IDOR/tenant-isolation boundary. Reviewer-caught.
- **Backend returns raw data.** Filtering, sorting, and pagination shaping happen on the client; a
  listing query shouldn't take `limit`/`cursor` unless a page is genuinely unbounded.
- **Validate args with `v` and declare `returns`.** Every function validates its `args` and its
  `returns` with `convex/values`. Shared shapes live in
  [`convex/lib/validators/`](../../../services/platform/convex/lib/validators/) (`common.ts`,
  `json.ts`); per-domain shapes in that domain's `validators.ts`.
- **Auth cost matters.** In read queries prefer `getAuthUserIdentity` (0 DB reads, JWT only) over
  `authComponent.getAuthUser` (2 DB reads) —
  [`lib/rls/auth/`](../../../services/platform/convex/lib/rls/auth/). The full per-request auth-cost
  doctrine is [`performance`](../performance/SKILL.md)'s.
- **No `@deprecated` tombstones.** Delete the dead function and update its callers; git is the
  record. Reviewer-caught.
- **Never `import 'node:*'` in V8 code.** File I/O and Node APIs live in `'use node'` modules; pass
  their _output_ into V8 functions — see the boundary pattern below.

## Patterns

A query — RLS wrapper, validated `args` + `returns`, `for await` (never `.collect()`), index lookup
([`customers/queries.ts`](../../../services/platform/convex/customers/queries.ts)):

```ts
import { v } from 'convex/values';
import { queryWithRLS } from '../lib/rls';
import { customerValidator } from './validators';

export const listCustomers = queryWithRLS({
  args: { organizationId: v.string() },
  returns: v.array(customerValidator),
  handler: async (ctx, args) => {
    const results = [];
    for await (const customer of ctx.db
      .query('customers')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      results.push(customer);
    }
    return results;
  },
});
```

Pagination — use the native `.paginate()` with `paginationOptsValidator` (from `convex/server`); for
heavily-filtered scans use `paginateWithFilter` from
[`convex/lib/pagination/helpers.ts`](../../../services/platform/convex/lib/pagination/helpers.ts) (it
tracks the last-_scanned_ id so a tail row isn't lost). Don't hand-roll cursors.

The **node/V8 boundary** — a V8 query/mutation can't import a `'use node'` module by value. Load the
file I/O in the Node action (or a `'use node'` helper like
[`convex/lib/file_io.ts`](../../../services/platform/convex/lib/file_io.ts)) and pass plain data
inward. Symptom of getting it wrong: `bun run dev` dies in Convex bundling with
`Could not resolve "node:*"`.

```ts
// ❌ V8 mutation importing fs transitively → bundling failure
import { readConfig } from './config-loader'; // a 'use node' module

// ✅ Node action reads, V8 receives data. (the action file opens with the
//    `'use node'` directive on its own first line — omitted so it isn't reflowed.)
import { readJsonFile } from '../lib/file_io';
export const sync = action({
  handler: async (ctx) => {
    const cfg = await readJsonFile('/path'); // Node side
    await ctx.runMutation(internal.x.apply, { cfg }); // V8 receives plain data
  },
});
```

HTTP routes register on the `httpRouter()` in
[`convex/http.ts`](../../../services/platform/convex/http.ts): validate every request body, keep auth
checks on the handler, and never log request secrets — see [`security`](../security/SKILL.md).

## Verify backend changes

Don't assume — exercise the function on the live deployment via the **Convex MCP** (run the
query/mutation, read logs + schema) and confirm the shape. See [`verify`](../verify/SKILL.md).
