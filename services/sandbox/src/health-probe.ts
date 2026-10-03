// The /health probe cache: one backend liveness call at a time, its result
// reused for `ttlMs`. Two properties matter under the failure the healthcheck
// exists to detect (a wedged docker daemon / apiserver):
//   - concurrent callers SHARE the in-flight probe instead of each spawning
//     their own `docker version` (the compose healthcheck polls every 10 s;
//     a probe that outlives that interval used to fork one child per poll);
//   - a failed probe is cached like a healthy one for the TTL, so a dead
//     daemon is reported `unhealthy` once per cycle rather than re-probed on
//     every hit — except a transient one, which never asked the backend (no
//     docker CLI slot came free in time): the next hit probes again rather
//     than report a healthy daemon unhealthy for the whole TTL.

import type { HealthResult } from './backend/types.ts';

export function makeHealthProbe(
  probe: () => Promise<HealthResult>,
  ttlMs: number,
  now: () => number = Date.now,
): () => Promise<HealthResult> {
  let cached: { result: HealthResult; expiresAt: number } | null = null;
  let inFlight: Promise<HealthResult> | null = null;
  return () => {
    if (cached !== null && cached.expiresAt > now()) {
      return Promise.resolve(cached.result);
    }
    if (inFlight !== null) return inFlight;
    inFlight = probe()
      .then((result) => {
        if (result.ok || result.transient !== true) {
          cached = { result, expiresAt: now() + ttlMs };
        }
        return result;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}
