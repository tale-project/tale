# backend/core — ported domain logic

The domain logic ported from Tale's 0.4 Convex backend during the 0.5
Convex → Postgres rewrite. **These are not Convex functions** — there is no
Convex runtime; [MIGRATION.md](../MIGRATION.md) is the record of how the port
landed and the semantics each surface carries.

The doors in [`../domains/`](../domains/) and the pg-boss jobs in
[`../jobs/`](../jobs/) drive these modules through the **ctx-shim**
([`../lib/ctx-shim.ts`](../lib/ctx-shim.ts)): a minimal `ActionCtx` stand-in
that dispatches a reused module's `ctx.runQuery` / `ctx.runMutation` calls, by
function name (`path/module:export`), to SQL-backed handlers the caller
registers — so the same 0.4 code path runs against Postgres. It is fail-loud:
an un-shimmed call throws with the exact name rather than misbehaving silently.

Keeping the ported tree here — imported unchanged (extensionless specifiers)
via the backend's `node-loader.mjs` — is port-by-reference: reuse instead of
fork-copying. New 0.5 code belongs in `../domains/` and `../jobs/`, not here.

## Layout

- domain directories (`chat/`, `tasks/`, `knowledge/`, `governance/`, …) — one
  per ported 0.4 domain, snake_case, mirroring the old `convex/` tree.
- `lib/` — the ported shared server utilities: crypto (`secret_box.ts`,
  `crypto/`), storage, RLS, config readers, and the hand-maintained `ctx.ts` /
  `handler_names.ts` / `rows.ts` vocabulary that replaced Convex's generated
  `_generated/` types.
