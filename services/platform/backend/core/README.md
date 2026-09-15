# Reused domain logic

This tree contains domain logic called by the current PostgreSQL backend. Its
`ctx.runQuery` and `ctx.runMutation` syntax is a compatibility interface, not a
separate database runtime or an API for external clients.

## Follow a call

1. An authenticated route in [`../domains/`](../domains/) or a worker in
   [`../jobs/`](../jobs/) selects a domain operation.
2. The caller supplies SQL-backed handlers through
   [`ctx-shim.ts`](../lib/ctx-shim.ts).
3. A core function addresses a handler by its registered name. An unregistered
   call throws with that name, so a missing integration cannot silently succeed.

The Node loader resolves extensionless imports in this tree. Keep a reused
operation here when its callers still need it; place new endpoint and persistence
code in the native domain or job that owns the behavior. Search both locations
before adding a second implementation.

## Find the supporting types

- `lib/ctx.ts`: context interfaces used by reused functions.
- `lib/handler_names.ts`: callable handler-name vocabulary.
- `lib/rows.ts`: row and identifier types expected at the compatibility boundary.
- Domain directories: shared behavior, normalization, parsing and tests.

Follow the [backend transaction, authorization and testing rules](../README.md)
when changing a call. [`MIGRATION.md`](../MIGRATION.md) records the earlier port;
use current source and tests for today’s contract.
