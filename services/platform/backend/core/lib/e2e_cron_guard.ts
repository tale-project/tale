/**
 * Runtime E2E guard for sub-hourly cron handlers.
 *
 * `convex/crons.ts` drops sub-hourly crons at REGISTRATION time when
 * `TALE_E2E=1`, but that check runs during the analyze/push — and `TALE_E2E`
 * only reaches the deployment env AFTER the pre-warm `convex dev --once` and
 * the persistent `convex dev`'s initial push (the env sync runs later in
 * `scripts/dev-engine.ts`; `convex env set` doesn't trigger a code push, and a
 * `convex dev --once` re-push can't share port 3210 with the running
 * persistent backend). So the registration suppression is defeated and the
 * sub-hourly crons (every-1-min workflow scan, every-2/5-min recovery sweeps,
 * every-5-min crawl scheduler) fire throughout the E2E run, starving the shared
 * single-node backend past its ~1s function timeout mid-test — the dominant
 * source of suite flake (see `convex/crons.ts` header).
 *
 * The handlers therefore no-op under E2E at RUNTIME, when `TALE_E2E` is set in
 * the deployment env. Each sub-hourly cron handler checks this at the top and
 * returns its empty result.
 */
export function isE2ECronSuppressed(): boolean {
  return process.env.TALE_E2E === '1';
}
