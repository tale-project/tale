import type { Sql } from 'postgres';

import {
  SessionDuplicateError,
  SpawnerBusyError,
  sessionCreate,
  sessionDestroy,
  sessionIsAlive,
  sessionSetPinned,
} from '../../core/node_only/sandbox/helpers/session_client.ts';
import {
  getSessionBySessionId,
  markSessionDestroyed,
  parkAdmissionTicket,
  reserveSessionSlot,
  resumeSessionSlot,
  setSessionPinned,
  setSessionStatus,
  type AdmissionTicketInput,
} from './sessions.ts';

/**
 * Spawner-facing session orchestration — the 0.5 twin of the provisioning
 * flow the 0.4 hosts run (`tasks/agent_run_host.ts` et al), with the SAME
 * choreography: reserve the platform slot first, then create spawner-side;
 * a 409 duplicate ADOPTS the orphan container (the platform row went
 * missing, the compute did not); any other create failure releases the slot
 * by marking the row `failed`; a 429 host-capacity busy re-parks the
 * caller's FIFO ticket before rethrowing so the retry keeps its queue spot.
 * The HTTP client (`helpers/session_client.ts` — HMAC signing, drain retry,
 * SANDBOX_URL/SANDBOX_TOKEN env) is REUSED verbatim.
 */

export interface ProvisionSessionArgs {
  organizationId: string;
  sessionId: string;
  profile: 'default' | 'agent';
  ownerType: string;
  ownerId: string;
  createdBy: string;
  agentKind?: string;
  ttlMs?: number;
  idleTimeoutMs?: number;
  env?: Record<string, string>;
  ticket?: AdmissionTicketInput;
}

export interface ProvisionResult {
  /** False when a live platform row + live container were reused in place. */
  created: boolean;
}

export async function provisionSession(
  sql: Sql,
  args: ProvisionSessionArgs,
): Promise<ProvisionResult> {
  const existing = await getSessionBySessionId(
    sql,
    args.organizationId,
    args.sessionId,
  );
  if (existing !== null && existing.status !== 'destroyed') {
    // A live platform row: reuse it when the container is really there —
    // an idempotent slot refresh. A spawner-side 404 is the phantom-session
    // signal: heal the stale row and fall through to a fresh provision.
    if (await sessionIsAlive(args.sessionId)) {
      await resumeSessionSlot(sql, {
        organizationId: args.organizationId,
        sessionId: args.sessionId,
        ...(args.ticket !== undefined ? { ticket: args.ticket } : {}),
      });
      return { created: false };
    }
    console.warn(
      `[sandbox] healing phantom session row ${args.sessionId} (container gone spawner-side)`,
    );
    await markSessionDestroyed(sql, {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
    });
  }

  await reserveSessionSlot(sql, {
    organizationId: args.organizationId,
    sessionId: args.sessionId,
    profile: args.profile,
    ownerType: args.ownerType,
    ownerId: args.ownerId,
    createdBy: args.createdBy,
    ...(args.agentKind !== undefined ? { agentKind: args.agentKind } : {}),
    ...(args.ttlMs !== undefined ? { ttlMs: args.ttlMs } : {}),
    ...(args.ticket !== undefined ? { ticket: args.ticket } : {}),
  });
  try {
    await sessionCreate({
      sessionId: args.sessionId,
      organizationId: args.organizationId,
      profile: args.profile,
      ...(args.ttlMs !== undefined ? { ttlMs: args.ttlMs } : {}),
      ...(args.idleTimeoutMs !== undefined
        ? { idleTimeoutMs: args.idleTimeoutMs }
        : {}),
      ...(args.env !== undefined ? { env: args.env } : {}),
    });
  } catch (error) {
    if (error instanceof SessionDuplicateError) {
      console.warn(
        `[sandbox] adopting orphan container for ${args.sessionId} (no platform row tracked it)`,
      );
      await setSessionStatus(sql, {
        organizationId: args.organizationId,
        sessionId: args.sessionId,
        status: 'active',
      });
      return { created: true };
    }
    await setSessionStatus(sql, {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      status: 'failed',
    });
    if (error instanceof SpawnerBusyError && args.ticket !== undefined) {
      // Host capacity, not org quota: keep the FIFO spot for the retry.
      await parkAdmissionTicket(sql, args.ownerType, args.ownerId);
    }
    throw error;
  }
  await setSessionStatus(sql, {
    organizationId: args.organizationId,
    sessionId: args.sessionId,
    status: 'active',
  });
  return { created: true };
}

/** Idempotent teardown: spawner destroy (a 404 is success), then the row. */
export async function teardownSession(
  sql: Sql,
  args: { organizationId: string; sessionId: string },
): Promise<boolean> {
  try {
    await sessionDestroy(args.sessionId);
  } catch (error) {
    // Best-effort: the row must settle even when the spawner is unreachable
    // (the spawner's own reaper collects the container on TTL).
    console.warn(
      `[sandbox] spawner destroy failed for ${args.sessionId}; marking the row anyway:`,
      error,
    );
  }
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
 * platform row as destroyed; a live one is left alone. */
export async function reconcileSession(
  sql: Sql,
  args: { organizationId: string; sessionId: string },
): Promise<'live' | 'healed'> {
  if (await sessionIsAlive(args.sessionId)) {
    return 'live';
  }
  await markSessionDestroyed(sql, args);
  return 'healed';
}
