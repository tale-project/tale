/**
 * Dev-only cold-load timeline.
 *
 * Logs `[cold-load] <label>: <ms>` (milliseconds since navigation start) the
 * first time each label is reached, so a single hard refresh reveals exactly
 * where the authenticated-bootstrap time goes:
 *
 *   module-load          → JS bundle download + parse (dev: Vite transform)
 *   convex-authenticated → end of the WebSocket auth handshake
 *                          (getSession → convex token → setAuth → WS validate)
 *   account-bootstrap    → the consolidated 2FA / password-expiry gate query
 *   member-context       → the org membership gate query
 *
 * Compare the deltas: a large gap before `convex-authenticated` means the auth
 * handshake dominates; a large gap after means the gate queries do; a large
 * `module-load` means the bundle does.
 *
 * Zero-cost in production. Enable in a production build with
 * `localStorage.tale_perf = '1'` then hard-refresh.
 */
const ENABLED =
  import.meta.env.DEV ||
  (typeof localStorage !== 'undefined' &&
    localStorage.getItem('tale_perf') === '1');

const seen = new Set<string>();

export function markColdLoad(label: string): void {
  if (!ENABLED || typeof performance === 'undefined') return;
  if (seen.has(label)) return;
  seen.add(label);
  console.info(`[cold-load] ${label}: ${Math.round(performance.now())}ms`);
}
