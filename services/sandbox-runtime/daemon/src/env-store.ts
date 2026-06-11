// Session env store — the daemon-held environment that every exec inherits.
//
// Seeded from TALE_SESSION_ENV (JSON, written by the spawner at create time)
// and mutated via POST /env. The deny-list keeps callers from clobbering the
// sandbox plumbing (HOME/PATH/TMPDIR, the proxy vars, TALE_RUNNERD_*); those
// always come from the daemon's own process env, never the store.

import {
  RUNNERD_ENV_MAX_ENTRIES,
  RUNNERD_ENV_MAX_VALUE_BYTES,
  isDeniedEnvName,
} from './protocol.ts';

export class EnvStore {
  private readonly store = new Map<string, string>();

  constructor(seed?: Record<string, string>) {
    if (seed) {
      for (const [k, v] of Object.entries(seed)) {
        if (!isDeniedEnvName(k)) this.store.set(k, v);
      }
    }
  }

  /** Apply a set/unset patch. Returns the names rejected by the deny-list or
   * the entry/size caps (reported, not fatal). */
  patch(set?: Record<string, string>, unset?: string[]): string[] {
    const denied: string[] = [];
    if (set) {
      for (const [k, v] of Object.entries(set)) {
        if (isDeniedEnvName(k) || !this.acceptable(k, v)) {
          denied.push(k);
          continue;
        }
        this.store.set(k, v);
      }
    }
    if (unset) {
      for (const k of unset) {
        if (isDeniedEnvName(k)) {
          denied.push(k);
          continue;
        }
        this.store.delete(k);
      }
    }
    return denied;
  }

  private acceptable(name: string, value: string): boolean {
    if (this.store.size >= RUNNERD_ENV_MAX_ENTRIES && !this.store.has(name)) {
      return false;
    }
    return Buffer.byteLength(value, 'utf8') <= RUNNERD_ENV_MAX_VALUE_BYTES;
  }

  /** Snapshot merged with a per-exec overlay (overlay wins, deny-list still
   * enforced on the overlay). The base process env (HOME/PATH/etc.) is added
   * by the caller — this returns only the session-level vars. */
  resolve(overlay?: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of this.store) out[k] = v;
    if (overlay) {
      for (const [k, v] of Object.entries(overlay)) {
        if (!isDeniedEnvName(k)) out[k] = v;
      }
    }
    return out;
  }
}
