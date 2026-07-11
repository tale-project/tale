/**
 * Boot-time health probe for the Convex NODE action executor (#2631).
 *
 * Intermittently the local backend's node executor boots into a state where
 * EVERY `'use node'` action fails —
 *   Cannot find module '/tmp/.../source/<uuid>/modules/<fn>.js' imported from /
 * — because the extracted action-source directory it resolved at push time no
 * longer exists (a suspected extraction race during the `tale dev` E2E boot's
 * `convex dev --once` preflight; see the issue for the root-cause notes). The
 * backend itself stays otherwise healthy (TCP up, `/api/auth/ok` 200), so
 * nothing upstream of this probe catches it — a CI shard then burns its full
 * ~15-minute budget retrying specs that happen to touch a node action (e.g.
 * `organizations/actions:initializeDefaultWorkflows` in the org-create
 * wizard), failing with an unrelated-looking UI timeout instead of a clear
 * cause.
 *
 * This probes ONE cheap, side-effect-free, unauthenticated node action —
 * `branding.file_actions.readBranding` with no `organizationId`, the exact
 * call the pre-auth login page itself makes to read the platform `default`
 * branding bucket — chosen because it needs no session/org context (so it can
 * run at boot, before any spec has authenticated), does no writes, and is one
 * of the two actions the issue's evidence shows failing with this signature.
 *
 * node-only by location; the orchestrator wires this in behind `TALE_E2E` (a
 * broken executor is a real defect, but this is a CI-boot mitigation, not a
 * behaviour normal `bun dev` should pay an extra round-trip for).
 */

import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';

/** The substring the local backend's node executor emits when its extracted
 *  action source directory is missing — the exact signature from #2631. */
const MODULE_NOT_FOUND_SIGNATURE = 'Cannot find module';

/**
 * Turn a probe failure into the distinctive, greppable boot error the issue
 * asks for — CI logs can `grep "node executor unhealthy"` instead of hunting
 * through 15 minutes of per-spec retry noise. Pure — no I/O — so it's
 * unit-testable without a backend.
 */
export function describeProbeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = message.includes(MODULE_NOT_FOUND_SIGNATURE)
    ? `its extracted action source is missing (${message})`
    : `the probe action failed (${message})`;
  return `node executor unhealthy: ${cause}`;
}

/** Injectable so the retry/timeout logic is testable without a real backend. */
export type ProbeAction = (convexUrl: string) => Promise<unknown>;

/** Calls the same public `readBranding` action the pre-auth login page uses,
 *  via a plain (unauthenticated) `ConvexHttpClient` — matching how the app
 *  itself reaches it, so a pass here is a real signal for the run ahead. */
export const callBrandingProbeAction: ProbeAction = (convexUrl) =>
  new ConvexHttpClient(convexUrl).action(
    anyApi.branding.file_actions.readBranding,
    {},
  );

export interface ProbeNodeExecutorOptions {
  convexUrl: string;
  /** Overall deadline for the retry loop. */
  timeoutMs: number;
  /** Delay between attempts. Defaults to 2s — cheap enough to retry often
   *  without hammering a still-warming backend. */
  intervalMs?: number;
  /** Overridable for tests; defaults to the real `readBranding` call. */
  callAction?: ProbeAction;
}

/**
 * Retry the probe action until it succeeds or `timeoutMs` elapses, then
 * throw the classified, distinctive error. Deliberately conservative — a
 * generous timeout and repeated retries so a backend that is merely still
 * warming up (not actually broken) is never mistaken for an unhealthy
 * executor (no false-positive boot failures).
 */
export async function probeNodeExecutor(
  options: ProbeNodeExecutorOptions,
): Promise<void> {
  const {
    convexUrl,
    timeoutMs,
    intervalMs = 2_000,
    callAction = callBrandingProbeAction,
  } = options;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = new Error('probe never attempted');
  for (;;) {
    try {
      await callAction(convexUrl);
      return;
    } catch (err) {
      lastError = err;
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(describeProbeFailure(lastError));
}
