/**
 * One database outage as a caller sees it, from the failures and successes
 * of its own queries: the first failure begins it, the first failure once it
 * outlasted `reportAfterMs` says it lasted (once — the place to report it),
 * and the first success ends it. `/events` watches the platform's database
 * this way (`realtime/hint-hub.ts`), each knowledge pool its own
 * (`core/knowledge/pool.ts`).
 */
export interface OutageHooks {
  /** The first failure of an outage. */
  began: (error: unknown) => void;
  /** The first failure once the outage outlasted `reportAfterMs`; once. */
  lasted: (error: unknown, outageMs: number) => void;
  /** The first success after a failure. */
  ended: (outageMs: number) => void;
}

export interface OutageWatch {
  failed: (error: unknown) => void;
  recovered: () => void;
}

export interface OutageWatchOptions {
  /**
   * A failure this long after the last one begins a new outage. For a
   * caller whose queries are sparse: the end of an outage is only seen by a
   * success, and without one in between, the next outage would otherwise
   * date from the first one's start — reported at once, or never again.
   */
  forgetAfterMs?: number;
}

export function createOutageWatch(
  reportAfterMs: number,
  hooks: OutageHooks,
  options: OutageWatchOptions = {},
): OutageWatch {
  const { forgetAfterMs } = options;
  let since: number | null = null;
  let last = 0;
  let reported = false;
  return {
    failed(error) {
      const now = Date.now();
      if (
        since !== null &&
        forgetAfterMs !== undefined &&
        now - last >= forgetAfterMs
      ) {
        since = null;
      }
      last = now;
      if (since === null) {
        since = now;
        reported = false;
        hooks.began(error);
        return;
      }
      const outageMs = now - since;
      if (!reported && outageMs >= reportAfterMs) {
        reported = true;
        hooks.lasted(error, outageMs);
      }
    },
    recovered() {
      if (since === null) return;
      const outageMs = Date.now() - since;
      since = null;
      reported = false;
      hooks.ended(outageMs);
    },
  };
}
