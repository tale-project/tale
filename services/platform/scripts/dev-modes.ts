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
