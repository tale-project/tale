import type { Sql } from 'postgres';

import {
  sessionDestroy,
  sessionIsAlive,
  sessionSetPinned,
} from '../../core/node_only/sandbox/helpers/session_client.ts';
import {
  getSessionBySessionId,
  markSessionDestroyed,
  setSessionPinned,
} from './sessions.ts';

/**
 * Spawner-facing session orchestration for the management surface and the
 * drift sweep: teardown, pin/unpin on both sides, and the phantom-heal
 * reconcile. Provisioning itself is the hosts' business (the reused
 * `tasks/agent_run_host.ts` / `automations/agent_host.ts` choreography over
 * the shim's slot verbs) — there is deliberately no second copy of it here.
 * The HTTP client (`helpers/session_client.ts` — HMAC signing, drain retry,
 * SANDBOX_URL/SANDBOX_TOKEN env) is REUSED verbatim.
 */

/** Authorize before contacting the spawner; settle the row only after it
 * confirms destruction or absence. Failures leave the session retryable. */
export async function teardownSession(
  sql: Sql,
  args: { organizationId: string; sessionId: string },
): Promise<boolean> {
  const session = await getSessionBySessionId(
    sql,
    args.organizationId,
    args.sessionId,
  );
  if (session === null) return false;
  await sessionDestroy(args.sessionId);
  return markSessionDestroyed(sql, args);
}

/** Pin/unpin on both sides (platform TTL exemption + spawner reaper skip). */
export async function pinSession(
  sql: Sql,
  args: { organizationId: string; sessionId: string; pinned: boolean },
): Promise<boolean> {
  const patched = await setSessionPinned(sql, args);
  if (patched) {
    try {
      await sessionSetPinned(args.sessionId, args.pinned);
    } catch (error) {
      console.warn(
        `[sandbox] spawner pin patch failed for ${args.sessionId} (platform row updated):`,
        error,
      );
    }
  }
  return patched;
}

/** Watchdog reconcile for one row: a container gone spawner-side settles the
 * platform row as destroyed; a live one is left alone. The liveness probe is
 * injectable (the watchdog's scripted spawner in tests and the integration
 * probe); production asks the signed session client. */
export async function reconcileSession(
  sql: Sql,
  args: { organizationId: string; sessionId: string },
  deps: { isAlive: (sessionId: string) => Promise<boolean> } = {
    isAlive: sessionIsAlive,
  },
): Promise<'live' | 'healed'> {
  if (await deps.isAlive(args.sessionId)) {
    return 'live';
  }
  await markSessionDestroyed(sql, args);
  return 'healed';
}
