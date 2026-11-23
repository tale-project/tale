/**
 * The memory budget as tale-project/tale#4942 decided it (decision of
 * 2026-11-14), in the figures the benchmark reads against.
 *
 * - The limit: 500 MB, decimal, for everything `tale deploy` starts on one
 *   host by default. Sandbox sessions and sandbox-lane jobs are left out:
 *   the spawner admits them per job against the host's memory.
 * - The reading: each container's cgroup v2 `memory.stat`, sampled every
 *   250 ms. Six of its fields are counted (memory the kernel cannot simply
 *   drop); the page cache, `file`, is reported beside them and not counted.
 *   The deployment's reading at an instant is the sum over its containers at
 *   that instant, and the result is the peak of that sum.
 * - The shares: each part's slice of the budget, informative, read per part.
 * - A blue/green flip runs a second colour of the app tier for its drain.
 *   That overlap is outside the ceiling, bounded to one extra app-tier share.
 *
 * The limit, the shares and the overlap bound are the decision's figures,
 * written once in @tale/shared/memory-budget, where the CLI takes each
 * service's memory reservation from too
 * (tools/cli/src/lib/compose/services/memory-env.ts). What is the
 * benchmark's own is here: how it reads, and which services each part's
 * reading covers.
 */

import {
  MEMORY_BUDGET_OVERLAP_BOUND_MIB,
  MEMORY_BUDGET_SHARES_MIB,
  type MemoryBudgetShare,
} from '@tale/shared/memory-budget';

// The ceiling: 500 MB, 476.8 MiB.
export { MEMORY_BUDGET_BYTES } from '@tale/shared/memory-budget';

/** 2^20: the shares are decided in MiB. */
export const MIB = 1_048_576;

/** How often each container's `memory.stat` is read. */
export const SAMPLE_INTERVAL_MS = 250;

/**
 * The `memory.stat` fields the budget counts: anonymous memory, shared
 * memory (tmpfs, Postgres's shared buffers), unreclaimable kernel slab,
 * kernel stacks, page tables and socket buffers.
 */
export const COUNTED_FIELDS = [
  'anon',
  'shmem',
  'slab_unreclaimable',
  'kernel_stack',
  'pagetables',
  'sock',
] as const;

export type CountedField = (typeof COUNTED_FIELDS)[number];

/**
 * The page cache, reported and not counted. The kernel's `file` includes the
 * tmpfs and shared memory that `shmem` counts.
 */
export const PAGE_CACHE_FIELD = 'file';

export type ShareKey = MemoryBudgetShare;

export interface Share {
  readonly key: ShareKey;
  readonly label: string;
  /** The share, in MiB. */
  readonly mib: number;
  /** The compose services whose containers the share covers. */
  readonly services: readonly string[];
}

/**
 * How the benchmark reads each part that has a share: its name in the report
 * and the compose services whose containers it covers. One entry for each
 * share of the decision and for nothing else: a share added to
 * @tale/shared/memory-budget fails the type check here until the benchmark
 * says which services its reading covers.
 */
const PARTS: Readonly<Record<ShareKey, Omit<Share, 'key' | 'mib'>>> = {
  'app-tier': {
    label: 'App tier',
    services: ['platform', 'backend-api', 'backend-worker'],
  },
  postgres: { label: 'Postgres', services: ['db', 'knowledge-db'] },
  'object-store': { label: 'Object store', services: ['object-store'] },
  edge: { label: 'Edge', services: ['proxy', 'docker-api'] },
  'spawner-egress': {
    label: 'Spawner and egress',
    services: ['sandbox', 'sandbox-egress'],
  },
};

/**
 * The parts of the deployment and their shares, in the decision's order. The
 * app tier's covers the model relay inside it and one heavy slot; the edge is
 * Traefik with its responder and its read-only Docker API proxy;
 * `knowledge-db` exists only where a source compose still runs a second
 * Postgres.
 */
export const SHARES: readonly Share[] = (
  Object.keys(MEMORY_BUDGET_SHARES_MIB) as ShareKey[]
).map((key) => ({
  key,
  label: PARTS[key].label,
  mib: MEMORY_BUDGET_SHARES_MIB[key],
  services: PARTS[key].services,
}));

/** The share a compose service's containers count toward, or null. */
export function shareOf(service: string): Share | null {
  return SHARES.find((share) => share.services.includes(service)) ?? null;
}

/** The share's size in bytes. */
export function shareBytes(share: Share): number {
  return share.mib * MIB;
}

/** A blue/green overlap may add at most one app-tier share. */
export const OVERLAP_BOUND_BYTES = MEMORY_BUDGET_OVERLAP_BOUND_MIB * MIB;

/**
 * The services `tale deploy` starts on one host by default
 * (tools/cli/src/lib/compose/types.ts): the app tier as one `platform`
 * process, Postgres, the object store, the edge and its Docker API proxy,
 * the spawner and its egress proxy. A reading that misses one of them does
 * not cover what the budget covers.
 */
export const DEFAULT_SERVICES: readonly string[] = [
  'platform',
  'db',
  'object-store',
  'proxy',
  'docker-api',
  'sandbox',
  'sandbox-egress',
];
