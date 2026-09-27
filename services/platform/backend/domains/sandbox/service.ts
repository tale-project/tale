import type { Sql } from 'postgres';

import {
  SessionDuplicateError,
  sessionCreate,
  sessionDestroy,
  sessionIsAlive,
  sessionSetPinned,
  type SessionCreateBody,
} from '../../core/node_only/sandbox/helpers/session_client.ts';
import {
  getSessionBySessionId,
  markSessionDestroyed,
  setSessionPinned,
  type SessionRow,
} from './sessions.ts';

/**
 * Spawner-facing session orchestration for the management surface and the
 * drift sweep: teardown, pin/unpin on both sides, and the reconcile (phantom
 * heal, pin upkeep). Provisioning itself is the hosts' business (the reused
 * `tasks/agent_run_host.ts` / `automations/agent_host.ts` choreography over
 * the shim's slot verbs) — there is deliberately no second copy of it here:
 * the reconcile's recreate only restarts compute under a row that already
 * holds its slot and credentials. The HTTP client (`helpers/session_client.ts`
 * — HMAC signing, drain retry, SANDBOX_URL/SANDBOX_TOKEN env) is REUSED
 * verbatim.
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

/**
 * The spawner verbs the reconcile uses. Injectable so the unit layer, the
 * watchdog's scripted spawner and the integration probe drive it; production
 * uses the signed session client.
 */
export interface ReconcileSpawner {
  /** GET /v1/sessions/:id — false ONLY on a definitive 404; throws otherwise. */
  isAlive: (sessionId: string) => Promise<boolean>;
  /** PATCH /v1/sessions/:id/pin — true once the spawner holds the flag. */
  setPinned: (sessionId: string, pinned: boolean) => Promise<boolean>;
  /** POST /v1/sessions — under an id whose workspace the spawner preserved,
   * the create re-attaches that workspace (a resume, not a fresh one). */
  create: (body: SessionCreateBody) => Promise<unknown>;
}

/** The statuses under which a row holds compute — the reconcile pass's
 * candidates. A pin only keeps such a row running: a `stopped` row is
 * hibernated on purpose, a terminal one is history (a Destroy keeps the
 * row's pin flag). */
const COMPUTE_HOLDING_STATUSES: ReadonlySet<string> = new Set([
  'creating',
  'active',
  'degraded',
]);

export type ReconcileOutcome =
  /** Alive spawner-side and unpinned: nothing to do. */
  | 'live'
  /** Gone spawner-side and unpinned: the row settled as destroyed. */
  | 'healed'
  /** Alive and pinned: the pin re-asserted spawner-side. */
  | 'repinned'
  /** Gone and pinned: recreated in place and re-pinned. */
  | 'recreated'
  /** Pinned, but the row left the compute-holding statuses since the batch
   * named it (destroyed or hibernated meanwhile): not the reconcile's to
   * touch. */
  | 'skipped';

/**
 * Watchdog reconcile for one row. The spawner's liveness verdict comes first;
 * the row is then read fresh, because the batch that named it may be minutes
 * old and a pin toggled since decides which way the row goes.
 *
 * - Unpinned: a container gone spawner-side settles the row as destroyed
 *   (phantom heal); a live one is left alone.
 * - Pinned: the row is the durable truth of the pin, and nothing else pushes
 *   it back to the spawner — which forgets a pin whenever its container goes
 *   (a new create always starts unpinned). A live session has the pin
 *   re-asserted. A gone one is recreated under the same id — the spawner
 *   resolves the workspace by id, so the create re-attaches the preserved
 *   workspace (on the device it lives on, when it lives on one) — and
 *   re-pinned, never settled as destroyed. A create the spawner answers as a
 *   duplicate means the session is back already (a turn or a concurrent
 *   reconcile recreated it): it is re-pinned too, and deliberately not
 *   acquired, since no work follows. A pinned row that left the
 *   compute-holding statuses since the batch (a Destroy or a hibernation
 *   raced the probe) is left alone.
 *
 * Every spawner failure — a refused pin, a create the spawner could not
 * serve, an offline device — throws, so the caller leaves the row for its
 * next visit instead of settling it on a guess.
 */
export async function reconcileSession(
  sql: Sql,
  args: { organizationId: string; sessionId: string },
  spawner: ReconcileSpawner = {
    isAlive: sessionIsAlive,
    setPinned: sessionSetPinned,
    create: sessionCreate,
  },
): Promise<ReconcileOutcome> {
  const alive = await spawner.isAlive(args.sessionId);
  const row = await getSessionBySessionId(
    sql,
    args.organizationId,
    args.sessionId,
  );
  if (row === null || !row.pinned) {
    if (alive) return 'live';
    await markSessionDestroyed(sql, args);
    return 'healed';
  }
  if (!COMPUTE_HOLDING_STATUSES.has(row.status)) return 'skipped';
  if (!alive) {
    try {
      await spawner.create(recreateBody(row));
    } catch (error) {
      if (!(error instanceof SessionDuplicateError)) throw error;
      console.warn(
        `[sandbox] pinned session ${args.sessionId} is back spawner-side already; re-pinning it`,
      );
    }
  }
  if (!(await spawner.setPinned(args.sessionId, true))) {
    throw new Error(
      `the spawner did not take the pin of ${args.sessionId}${alive ? '' : ' after recreating it'}; the next reconcile retries`,
    );
  }
  return alive ? 'repinned' : 'recreated';
}

/** The body the row's own create site sent — same id, organization and
 * profile. Agent workspaces may live on one of the organization's devices
 * (the hub routes an id it placed back to that machine, and keeps a
 * server-side workspace on the server); renders never leave the server. */
function recreateBody(row: SessionRow): SessionCreateBody {
  const base = { sessionId: row.sessionId, organizationId: row.organizationId };
  if (row.profile === 'agent') {
    return { ...base, profile: 'agent', placement: 'device' };
  }
  if (row.profile === 'default') {
    return { ...base, profile: 'default', placement: 'server' };
  }
  throw new Error(
    `pinned session ${row.sessionId} carries no known profile (${JSON.stringify(row.profile)}); it cannot be recreated`,
  );
}
