/**
 * The memory budget of one host, as tale-project/tale#4942 decided it
 * (decision of 2026-11-14,
 * https://github.com/tale-project/tale/issues/4942#issuecomment-6882915134).
 *
 * The budget covers everything `tale deploy` starts on one host by default:
 * the app tier, Postgres, the object store, the edge, and the sandbox spawner
 * with its egress proxy. It leaves out sandbox sessions and sandbox-lane jobs,
 * which the spawner admits per job against the host's memory. It is read on
 * native Linux amd64 and arm64, at the deployment's peak across the reference
 * workload (tools/load/README.md, "Memory budget").
 *
 * These are the decision's figures, and the one place they are written for
 * code: the memory benchmark reads a deployment against them
 * (tools/load/src/budget/limits.ts), and the CLI makes each share the memory
 * reservation of the services that part runs
 * (tools/cli/src/lib/compose/services/memory-env.ts). compose.yml,
 * .env.example and the self-hosting docs spell the reservations out as
 * literals; the CLI's compose-parity test holds compose.yml to its
 * generators.
 */

/** The limit: 500 MB, decimal, which is 476.8 MiB. */
export const MEMORY_BUDGET_BYTES = 500_000_000;

/**
 * Each part's share of the budget, in MiB. The benchmark reads each part
 * against its share, for information; the CLI reserves it for the part's
 * services.
 *
 * - `app-tier`: the application in whatever shape it runs, the in-process
 *   model relay (16, measured as a delta) and one heavy slot included.
 * - `postgres`: the database.
 * - `object-store`: the object store.
 * - `edge`: the reverse proxy in front of the stack.
 * - `spawner-egress`: the sandbox spawner and its egress proxy together.
 */
export const MEMORY_BUDGET_SHARES_MIB = {
  'app-tier': 256,
  postgres: 120,
  'object-store': 35,
  edge: 35,
  'spawner-egress': 30,
} as const;

/** A part of the deployment that has a share of the budget. */
export type MemoryBudgetShare = keyof typeof MEMORY_BUDGET_SHARES_MIB;

/**
 * A blue/green flip runs a second colour of the app tier while the first
 * drains. That overlap is outside the limit, and bounded to one extra
 * app-tier share, in MiB.
 */
export const MEMORY_BUDGET_OVERLAP_BOUND_MIB =
  MEMORY_BUDGET_SHARES_MIB['app-tier'];
