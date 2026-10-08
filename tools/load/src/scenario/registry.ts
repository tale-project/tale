/**
 * Realtime propagation, measured across users of one process.
 *
 * When a user writes an org-wide entity (a task), the platform appends a
 * hint to its outbox and every open `/events` stream of that organization
 * receives `{entity: 'task', entityId}`. The writer registers the entity id
 * with the moment it CLICKED (the request's start); any user of the same
 * process who receives the hint records `realtime.hint_latency` — the time
 * another person's tab takes to learn of the change.
 *
 * Two things keep the number honest:
 *
 * - each tab records a write at most ONCE (its {@link HintReceiver} keeps
 *   the writes it already measured). The entity may change again from a
 *   user in ANOTHER process, whose write this registry never sees; without
 *   the guard, that later hint would be measured against the earlier local
 *   click and read as a propagation of tens of seconds;
 * - a hint can beat the writer's own HTTP response (the commit and the
 *   outbox tail race the response bytes), so a hint for an id not
 *   registered yet is parked briefly and matched when the registration
 *   arrives — but only if it came AFTER the click: a hint older than the
 *   click announced someone else's change.
 */

import type { MetricsRegistry } from '../metrics/index.ts';

export const HINT_LATENCY = 'realtime.hint_latency';

/** How long a write waits for its hints. */
const WRITE_TTL_MS = 60_000;
/** How long a hint waits for its write: about one request's lifetime. */
const EARLY_TTL_MS = 30_000;
/** Bound on either table: a burst never grows memory without limit. */
const MAX_ENTRIES = 50_000;
/** Writes one tab remembers having measured. */
const RECEIVER_MEMORY = 64;

interface Parked {
  /** When the first such hint arrived. */
  at: number;
  count: number;
}

/**
 * One tab's memory of the writes it measured: entity id → the click it was
 * measured against. Owned by the receiving user, bounded.
 */
export type HintReceiver = Map<string, number>;

export function createHintReceiver(): HintReceiver {
  return new Map();
}

export class HintRegistry {
  readonly #now: () => number;
  /** entityId → when its latest write was clicked. */
  readonly #writes = new Map<string, number>();
  /** entityId → hints received before the write registered. */
  readonly #early = new Map<string, Parked>();
  #lastSweep = Number.NEGATIVE_INFINITY;

  constructor(now: () => number = () => performance.now()) {
    this.#now = now;
  }

  /** A user wrote `entityId`; `clickedAt` is when the request started. */
  registerWrite(
    metrics: MetricsRegistry,
    entityId: string,
    clickedAt: number,
  ): void {
    this.#sweep();
    const parked = this.#early.get(entityId);
    if (parked !== undefined) {
      this.#early.delete(entityId);
      if (parked.at >= clickedAt) {
        const latency = parked.at - clickedAt;
        for (let i = 0; i < parked.count; i += 1) {
          metrics.timing(HINT_LATENCY, latency);
        }
      }
    }
    if (this.#writes.size >= MAX_ENTRIES) this.#evictOldest(this.#writes);
    this.#writes.delete(entityId);
    this.#writes.set(entityId, clickedAt);
  }

  /**
   * A user's `/events` stream delivered a hint for `entityId`. `receiver`
   * is that user's memory, so one tab measures one write once.
   */
  observeHint(
    metrics: MetricsRegistry,
    entityId: string,
    receiver: HintReceiver,
  ): void {
    this.#sweep();
    const now = this.#now();
    const clickedAt = this.#writes.get(entityId);
    if (clickedAt !== undefined && now - clickedAt <= WRITE_TTL_MS) {
      if (receiver.get(entityId) === clickedAt) return;
      receiver.delete(entityId);
      receiver.set(entityId, clickedAt);
      if (receiver.size > RECEIVER_MEMORY) this.#evictOldest(receiver);
      metrics.timing(HINT_LATENCY, Math.max(0, now - clickedAt));
      return;
    }
    const parked = this.#early.get(entityId);
    if (parked !== undefined) {
      parked.count += 1;
      return;
    }
    if (this.#early.size >= MAX_ENTRIES) this.#evictOldest(this.#early);
    this.#early.set(entityId, { at: now, count: 1 });
  }

  get size(): { writes: number; early: number } {
    return { writes: this.#writes.size, early: this.#early.size };
  }

  #evictOldest(map: Map<string, unknown>): void {
    const oldest = map.keys().next();
    if (oldest.done !== true) map.delete(oldest.value);
  }

  /** Drop entries past their TTL, at most once a second. Maps keep
   * insertion order, so the oldest entries come first and a sweep stops
   * at the first live one. */
  #sweep(): void {
    const now = this.#now();
    if (now - this.#lastSweep < 1_000) return;
    this.#lastSweep = now;
    for (const [id, at] of this.#writes) {
      if (now - at <= WRITE_TTL_MS) break;
      this.#writes.delete(id);
    }
    for (const [id, parked] of this.#early) {
      if (now - parked.at <= EARLY_TTL_MS) break;
      this.#early.delete(id);
    }
  }
}

/** The process-wide registry every user of this process shares. */
export const hintRegistry = new HintRegistry();
