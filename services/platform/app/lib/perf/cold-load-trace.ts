/**
 * Dev-only cold-load timeline.
 *
 * Logs `[cold-load] <label>: <ms>` (milliseconds since navigation start) the
 * first time each label is reached, so a single hard refresh reveals exactly
 * where the authenticated-bootstrap time goes:
 *
 *   module-load          → JS bundle download + parse (dev: Vite transform)
 *   convex-preauth       → a persisted last-known token pre-authenticates the
 *                          WebSocket (skipping the serial session→token hops)
 *   convex-authenticated → end of the WebSocket auth handshake
 *                          (getSession → convex token → setAuth → WS validate)
 *   account-bootstrap    → the consolidated 2FA / password-expiry gate query
 *   member-context       → the org membership gate query
 *
 * Compare the deltas: a large gap before `convex-authenticated` means the auth
 * handshake dominates; a large gap after means the gate queries do; a large
 * `module-load` means the bundle does.
 *
 * Every mark is also recorded so the numbers are machine-readable, not just
 * console noise (epic #2386 AC3):
 *
 * - `getColdLoadTrace()` returns the marks for this page load — tests and
 *   in-app tooling can assert on them.
 * - `performance.mark('cold-load:<label>')` mirrors each one into the
 *   Performance API, so an E2E run (or DevTools / a CDP session) can pull the
 *   timeline with `performance.getEntriesByType('mark')` and track regressions
 *   without scraping the console.
 *
 * Zero-cost in production. Enable in a production build with
 * `localStorage.tale_perf = '1'` then hard-refresh.
 */
const ENABLED =
  import.meta.env.DEV ||
  (typeof localStorage !== 'undefined' &&
    localStorage.getItem('tale_perf') === '1');

interface ColdLoadMark {
  label: string;
  /** Milliseconds since navigation start, rounded. */
  at: number;
}

const marks: ColdLoadMark[] = [];
const seen = new Set<string>();

export function markColdLoad(label: string): void {
  if (!ENABLED || typeof performance === 'undefined') return;
  if (seen.has(label)) return;
  seen.add(label);
  const at = Math.round(performance.now());
  marks.push({ label, at });
  if (typeof performance.mark === 'function') {
    performance.mark(`cold-load:${label}`);
  }
  console.info(`[cold-load] ${label}: ${at}ms`);
}

/** The marks recorded for this page load, in the order they were reached. */
export function getColdLoadTrace(): readonly ColdLoadMark[] {
  return marks;
}

/** Test-only: forget recorded marks so each test observes a fresh timeline. */
export function resetColdLoadTraceForTests(): void {
  seen.clear();
  marks.length = 0;
}
