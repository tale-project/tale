/**
 * Mode resolution for the dev orchestrator, extracted as pure functions so the
 * env-driven branching (TALE_DEV_SKIP_DOCKER / TALE_E2E* / browser-open) is
 * testable without booting anything.
 *
 * node-only by location; pure (no I/O).
 */

export function isTruthy(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value ?? '');
}

/**
 * Whether `bun run dev` should pop the app in a browser once it's READY.
 *
 * Opens by default (the common interactive case), with two ways out:
 *  - `CI` is set — never steal focus on a build agent.
 *  - `TALE_DEV_OPEN` is set to a falsy value (`0`/`false`/`no`/`off`) — the
 *    explicit opt-out for a headless / nested run (Playwright's webServer sets
 *    it, so a local e2e run never spawns a browser). Unset → open.
 */
export function shouldOpenBrowser(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isTruthy(env.CI)) return false;
  const flag = env.TALE_DEV_OPEN;
  if (flag === undefined || flag.trim() === '') return true;
  return isTruthy(flag);
}

/**
 * Adopt the backend endpoints allocated for THIS project from a
 * freshly-parsed .env.local. On a fresh checkout the CLI writes only
 * VITE_CONVEX_URL / VITE_CONVEX_SITE_URL (and CONVEX_DEPLOYMENT) — and when the
 * default ports are taken (a second stack on one machine, e.g. an isolated E2E
 * worktree beside `bun dev`) it picks OTHER ports. Everything that keys on
 * CONVEX_URL / CONVEX_SITE_PROXY_URL (the readiness probe, the health check,
 * the auth-route wait, the Vite proxy) falls back to :3210/:3211, so without
 * this back-fill an isolated stack false-positives its probes against a
 * NEIGHBOURING backend and silently proxies every /api and /ws_api request
 * into it — test writes landing in the dev database. Explicit values win:
 * only unset keys are filled. Pure given both env records.
 */
