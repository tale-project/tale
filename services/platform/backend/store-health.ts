import type { Sql } from 'postgres';

import {
  getKnowledgePool,
  isConnectionFailure,
} from './core/knowledge/pool.ts';
import {
  objectUrl,
  resolveOrgObjectStore,
} from './core/lib/storage/object_store.ts';

/**
 * Is each of this deployment's three stores actually reachable?
 *
 * The question only became interesting when the stores moved out of the
 * process's own compose project. While they were containers next to it, a
 * store that was down took the whole stack down with it and nobody needed
 * telling. Point any of them at infrastructure an operator brings — a managed
 * Postgres, someone else's S3 — and the failure modes go quiet instead:
 * expired credentials, a revoked bucket policy, a security group that stopped
 * allowing the subnet. The backend keeps answering `/ping`, keeps passing
 * `/ready`, keeps taking traffic, and the first thing anybody learns is a user
 * failing to upload a file.
 *
 * So: probe all three, cheaply, and export the answer.
 *
 * Deliberately NOT wired into `/ready`. That endpoint is the deploy's question
 * — "may this replica take new work" — and answering it with the health of an
 * external S3 would let one flapping bucket cut a whole colour out of DNS,
 * which is a far worse outage than the one it would be reporting.
 *
 * The result is cached: Prometheus scrapes on its own schedule and several
 * gauges read one probe, so an uncached version would put a round-trip to
 * every store on every scrape.
 */

export type StoreName = 'app_db' | 'knowledge_db' | 'object_store';

export interface StoreStatus {
  name: StoreName;
  up: boolean;
  /** Why it is down. Absent while it is up. */
  detail?: string;
}

/** Long enough that a 15 s scrape interval costs one probe per store per
 * minute or so; short enough that a recovery shows up while someone is still
 * looking at the dashboard. */
const PROBE_TTL_MS = 30_000;

/** Bound on one store's probe — a reachable store answers immediately, and a
 * hung one must not stall a metrics scrape. */
const PROBE_TIMEOUT_MS = 5_000;

interface CachedProbe {
  statuses: StoreStatus[];
  expires: number;
}

let cached: CachedProbe | null = null;
let inFlight: Promise<StoreStatus[]> | null = null;

/** What each store was last seen doing, so only CHANGES reach the log. */
const lastSeen = new Map<StoreName, boolean>();

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Bound a probe that has no timeout of its own.
 *
 * A Postgres pool waits out its own `connect_timeout` — 10 s for the app
 * database, 30 s for a corpus — and this runs on the metrics scrape path,
 * where that would hold the whole `/metrics` response open. A store that has
 * not answered in this long is down as far as the gauge is concerned; the
 * losing query is left to settle on its own.
 */
async function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `${label} did not answer within ${PROBE_TIMEOUT_MS} ms`,
              ),
            ),
          PROBE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function probeAppDatabase(sql: Sql): Promise<StoreStatus> {
  try {
    await withTimeout(Promise.resolve(sql`SELECT 1`), 'the app database');
    return { name: 'app_db', up: true };
  } catch (error: unknown) {
    return { name: 'app_db', up: false, detail: describe(error) };
  }
}

/**
 * The DEPLOYMENT-DEFAULT corpus. This is the sanctioned use of the default
 * pool the module note in `core/knowledge/pool.ts` describes — deployment-wide
 * maintenance, touching no tenant rows. An organization that brings its own
 * database is not probed here: its corpus is its own to monitor, and probing
 * every one of them would put an unbounded number of round-trips on a scrape.
 */
async function probeKnowledgeDatabase(): Promise<StoreStatus> {
  try {
    await withTimeout(
      Promise.resolve(getKnowledgePool()`SELECT 1`),
      'the knowledge database',
    );
    return { name: 'knowledge_db', up: true };
  } catch (error: unknown) {
    // A statement that fails against a healthy connection says nothing about
    // reachability, which is the only thing this gauge claims.
    if (!isConnectionFailure(error)) {
      return { name: 'knowledge_db', up: true };
    }
    return { name: 'knowledge_db', up: false, detail: describe(error) };
  }
}

/**
 * The deployment-default bucket, by the cheapest request that proves both the
 * credentials and the bucket: `HEAD` on the bucket. 403 counts as up — it
 * means the bucket is there and this key may not LIST it, which is the normal
 * shape of a least-privilege key that can still read and write objects.
 */
async function probeObjectStore(): Promise<StoreStatus> {
  try {
    const store = await resolveOrgObjectStore('default');
    const response = await store.client.fetch(
      objectUrl(store, '').replace(/\/+$/, ''),
      { method: 'HEAD', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) },
    );
    if (response.ok || response.status === 403) {
      return { name: 'object_store', up: true };
    }
    return {
      name: 'object_store',
      up: false,
      detail: `HEAD bucket answered ${response.status}`,
    };
  } catch (error: unknown) {
    return { name: 'object_store', up: false, detail: describe(error) };
  }
}

/** Log only transitions, so a store that is down does not fill the log. */
function reportTransitions(statuses: StoreStatus[]): void {
  for (const status of statuses) {
    const previous = lastSeen.get(status.name);
    if (previous === status.up) continue;
    lastSeen.set(status.name, status.up);
    if (status.up) {
      // Never announce a store that was healthy the first time we looked.
      if (previous !== undefined) {
        console.log(`[backend] store "${status.name}" is reachable again`);
      }
      continue;
    }
    console.error(
      `[backend] store "${status.name}" is unreachable: ${status.detail ?? 'no detail'}`,
    );
  }
}

/**
 * All three stores' reachability, cached for {@link PROBE_TTL_MS}. Concurrent
 * callers share one round of probes.
 */
export async function probeStores(sql: Sql): Promise<StoreStatus[]> {
  const now = Date.now();
  if (cached !== null && cached.expires > now) return cached.statuses;
  if (inFlight !== null) return inFlight;

  inFlight = (async () => {
    const statuses = await Promise.all([
      probeAppDatabase(sql),
      probeKnowledgeDatabase(),
      probeObjectStore(),
    ]);
    reportTransitions(statuses);
    cached = { statuses, expires: Date.now() + PROBE_TTL_MS };
    return statuses;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Test seam: forget the cached probe and every remembered transition. */
export function resetStoreHealth(): void {
  cached = null;
  inFlight = null;
  lastSeen.clear();
}
