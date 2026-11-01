import { createHash } from 'node:crypto';

import type { Sql } from 'postgres';

import type { SandboxStartFailure } from '../../../lib/chat/work-tools-status.ts';
import {
  sessionCreate,
  sessionDestroy,
  sessionDestroyIfIdle,
  sessionIsAlive,
  SpawnerBusyError,
  SpawnerUnreachableError,
} from '../../core/node_only/sandbox/helpers/session_client.ts';
import {
  getSessionBySessionId,
  markSessionDestroyed,
  reserveSessionSlot,
  SandboxQuotaError,
  setSessionStatus,
} from './sessions.ts';

/**
 * Light sandboxes — the small, throwaway sessions a conversation runs code
 * in to make a document, a chart or a conversion.
 *
 * A light sandbox is the spawner's hardened `default` profile (an
 * unprivileged user, a read-only system, no capabilities, one CPU), on the
 * deployment's own server, with nothing of an agent in it: no coding
 * harness, no gateway key, no secrets, no connectors. The turn's own model
 * writes the code and the platform runs it. It starts in well under a
 * second, so nothing is kept warm for it.
 *
 * One per owner — a conversation's lineage, later a native task run — under
 * a deterministic session id, so the turns of a conversation reuse it while
 * it lives and its scratch files carry from one call to the next. It is
 * disposable by contract: the files a person should keep leave it as
 * artifacts the moment a call ends, and everything else may go at any time.
 * That is what lets the platform treat it so lightly:
 *
 *  - it holds the organization's `light` budget (`sandbox_quota`), and when
 *    that budget is full the least recently used idle light sandbox of the
 *    organization gives its slot to the new one;
 *  - the sandbox watchdog destroys one a few minutes after its last use
 *    ({@link releaseIdleLightSessions}); the spawner's own idle stop is the
 *    backstop;
 *  - a light sandbox that vanished (a host restart, the OOM killer) is simply
 *    created again on the next call.
 */

/** The `sandbox_sessions.owner_type` of a light sandbox; its budget is
 * `light` (`core/sandbox/quota_policy.ts`). */
const LIGHT_SESSION_OWNER_TYPE = 'light';

/** How long after its last use the watchdog destroys a light sandbox. */
export const LIGHT_SESSION_IDLE_MS = 5 * 60_000;

/** The spawner's own idle stop — a backstop for a watchdog that did not
 * come round. */
const LIGHT_SESSION_SPAWNER_IDLE_MS = 15 * 60_000;

/** No light sandbox lives longer than this, however busy. */
const LIGHT_SESSION_TTL_MS = 60 * 60_000;

/** A light sandbox younger than this is never taken for another owner: it
 * may sit between two calls of a turn that is still writing its next one. */
const LIGHT_SESSION_PREEMPT_GRACE_MS = 30_000;

/** The deterministic session id of an owner's light sandbox. The org is in
 * the hash, so equal owner keys in two organizations never meet. */
export function lightSessionId(
  organizationId: string,
  ownerKey: string,
): string {
  const digest = createHash('sha256')
    .update(`${organizationId}\u0000light\u0000${ownerKey}`)
    .digest('hex');
  return `lt-${digest.slice(0, 40)}`;
}

/** No light sandbox could be had right now: the organization's light
 * budget is full of sandboxes in use (`budget`), or the sandbox host is at
 * its capacity (`host`). Either frees by itself. */
export class LightSandboxBusyError extends Error {
  readonly retryAfterMs: number | undefined;
  readonly kind: 'budget' | 'host';
  constructor(
    message: string,
    retryAfterMs?: number,
    kind: 'budget' | 'host' = 'budget',
  ) {
    super(message);
    this.name = 'LightSandboxBusyError';
    this.retryAfterMs = retryAfterMs;
    this.kind = kind;
  }
}

/** Why a light sandbox could not start other than for room: the host has
 * no runtime image to start one from yet (`not_ready`), the sandbox service
 * did not answer (`unreachable`), or the start failed (`failed`). The
 * spawner's own error is the `cause`, for the log; the message is for the
 * reader of the call. */
export class LightSandboxUnavailableError extends Error {
  readonly kind: 'not_ready' | 'unreachable' | 'failed';
  /** When the host asked to be asked again — a host preparing its image
   * says when it expects to be ready. */
  readonly retryAfterMs: number | undefined;
  constructor(
    kind: LightSandboxUnavailableError['kind'],
    message: string,
    options?: { cause?: unknown; retryAfterMs?: number },
  ) {
    super(
      message,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'LightSandboxUnavailableError';
    this.kind = kind;
    this.retryAfterMs = options?.retryAfterMs;
  }
}

/** The reason a reply's `run_code` step and the Run check of the Chat tool
 * status panel record when no light sandbox could be had: by the kind of
 * {@link LightSandboxBusyError} when there is no room, and by the kind of
 * {@link LightSandboxUnavailableError} when none could start. */
export const LIGHT_SANDBOX_FAILURES = {
  budget: 'sandboxes_busy',
  host: 'sandbox_host_busy',
  not_ready: 'sandbox_not_ready',
  unreachable: 'sandbox_unreachable',
  failed: 'sandbox_failed',
} as const satisfies Record<
  LightSandboxBusyError['kind'] | LightSandboxUnavailableError['kind'],
  SandboxStartFailure
>;

/** The reader-facing words for each way a light sandbox failed to start. */
const UNAVAILABLE_MESSAGES: Record<
  LightSandboxUnavailableError['kind'],
  string
> = {
  not_ready:
    'The sandbox host has no runtime image ready yet, so no sandbox can start.',
  unreachable: 'The sandbox service cannot be reached right now.',
  failed: 'The light sandbox could not start.',
};

/** A spawner failure on the way to a running sandbox, as the reader of the
 * call should hear it. Room that frees by itself is {@link
 * LightSandboxBusyError}; a host without its runtime image, a service that
 * does not answer and a start that failed are {@link
 * LightSandboxUnavailableError}. */
function lightSandboxStartError(error: unknown): Error {
  if (error instanceof SpawnerBusyError) {
    if (error.refusal === 'runtime_image') {
      return new LightSandboxUnavailableError(
        'not_ready',
        UNAVAILABLE_MESSAGES.not_ready,
        { cause: error, retryAfterMs: error.retryAfterMs },
      );
    }
    return new LightSandboxBusyError(
      'The sandbox host is busy right now.',
      error.retryAfterMs,
      'host',
    );
  }
  const kind =
    error instanceof SpawnerUnreachableError ? 'unreachable' : 'failed';
  return new LightSandboxUnavailableError(kind, UNAVAILABLE_MESSAGES[kind], {
    cause: error,
  });
}

/** The spawner verbs a light sandbox uses — injectable for tests. */
export interface LightSessionSpawner {
  create: typeof sessionCreate;
  isAlive: (sessionId: string) => Promise<boolean>;
  destroy: (sessionId: string) => Promise<boolean>;
  destroyIfIdle: (
    sessionId: string,
  ) => Promise<{ destroyed: boolean; busy: boolean }>;
}

const DEFAULT_SPAWNER: LightSessionSpawner = {
  create: (body) => sessionCreate(body),
  isAlive: (sessionId) => sessionIsAlive(sessionId),
  destroy: (sessionId) => sessionDestroy(sessionId),
  destroyIfIdle: (sessionId) => sessionDestroyIfIdle(sessionId),
};

export interface LightSessionOwner {
  readonly organizationId: string;
  /** The owner's stable key: a conversation's lineage root, a run's id. */
  readonly ownerKey: string;
  /** Who the row names as its creator, e.g. the person's id. */
  readonly createdBy: string;
}

export interface LightSessionLease {
  readonly sessionId: string;
  /** True when this call started the sandbox; false when it was running. */
  readonly created: boolean;
}

/** Acquires in flight in this process, by session id: two calls of one
 * round must share one create, not race two. */
const acquiring = new Map<string, Promise<LightSessionLease>>();

/**
 * The owner's light sandbox, running: the live one, or a new one. Throws
 * {@link LightSandboxBusyError} when no room can be made now, and {@link
 * LightSandboxUnavailableError} when the sandbox host cannot start one.
 */
export function acquireLightSession(
  sql: Sql,
  owner: LightSessionOwner,
  spawner: LightSessionSpawner = DEFAULT_SPAWNER,
): Promise<LightSessionLease> {
  const sessionId = lightSessionId(owner.organizationId, owner.ownerKey);
  const pending = acquiring.get(sessionId);
  if (pending !== undefined) return pending;
  const started = acquireNow(sql, owner, sessionId, spawner).finally(() => {
    acquiring.delete(sessionId);
  });
  acquiring.set(sessionId, started);
  return started;
}

async function acquireNow(
  sql: Sql,
  owner: LightSessionOwner,
  sessionId: string,
  spawner: LightSessionSpawner,
): Promise<LightSessionLease> {
  const existing = await getSessionBySessionId(
    sql,
    owner.organizationId,
    sessionId,
  );
  if (existing?.status === 'active') {
    let alive: boolean;
    try {
      alive = await spawner.isAlive(sessionId);
    } catch (error) {
      if (!(error instanceof SpawnerUnreachableError)) throw error;
      throw lightSandboxStartError(error);
    }
    if (alive) {
      await touchLightSession(sql, owner.organizationId, sessionId);
      return { sessionId, created: false };
    }
    // Gone spawner-side (a host restart, the OOM killer): the row settles
    // and a fresh sandbox takes its place. Nothing in it was the person's.
    await markSessionDestroyed(sql, {
      organizationId: owner.organizationId,
      sessionId,
    });
  } else if (existing?.status === 'creating') {
    // Another process is starting it — this owner has one turn at a time,
    // so that is a turn which died mid-create. Clear it and start over.
    await spawner.destroy(sessionId).catch((error: unknown) => {
      console.warn(
        `[light-session] clearing the stale create of ${sessionId} failed:`,
        error,
      );
    });
    await markSessionDestroyed(sql, {
      organizationId: owner.organizationId,
      sessionId,
    });
  }

  await reserveWithPreemption(sql, owner, sessionId, spawner);
  try {
    await spawner.create({
      sessionId,
      organizationId: owner.organizationId,
      profile: 'default',
      // The deployment's own work, like a crawler render: light sandboxes
      // never start on an organization's device.
      placement: 'server',
      idleTimeoutMs: LIGHT_SESSION_SPAWNER_IDLE_MS,
      ttlMs: LIGHT_SESSION_TTL_MS,
    });
  } catch (error) {
    await setSessionStatus(sql, {
      organizationId: owner.organizationId,
      sessionId,
      status: 'failed',
    }).catch((settle: unknown) => {
      console.warn(
        `[light-session] settling the failed create of ${sessionId} failed:`,
        settle,
      );
    });
    await spawner.destroy(sessionId).catch((cleanup: unknown) => {
      console.warn(
        `[light-session] cleaning up the failed create of ${sessionId} failed:`,
        cleanup,
      );
    });
    throw lightSandboxStartError(error);
  }
  await setSessionStatus(sql, {
    organizationId: owner.organizationId,
    sessionId,
    status: 'active',
  });
  return { sessionId, created: true };
}

/** Reserve the owner's slot; when the light budget is full, take the slot
 * of the organization's least recently used idle light sandbox, once. */
async function reserveWithPreemption(
  sql: Sql,
  owner: LightSessionOwner,
  sessionId: string,
  spawner: LightSessionSpawner,
): Promise<void> {
  const reserve = () =>
    reserveSessionSlot(sql, {
      organizationId: owner.organizationId,
      sessionId,
      profile: 'default',
      ownerType: LIGHT_SESSION_OWNER_TYPE,
      ownerId: owner.ownerKey,
      createdBy: owner.createdBy,
      ttlMs: LIGHT_SESSION_TTL_MS,
    });
  try {
    await reserve();
    return;
  } catch (error) {
    if (!(error instanceof SandboxQuotaError) || error.reason !== undefined) {
      throw error;
    }
  }
  const freed = await preemptIdleLightSession(
    sql,
    owner.organizationId,
    sessionId,
    spawner,
  );
  if (!freed) {
    throw new LightSandboxBusyError(
      "All of the organization's light sandboxes are in use right now.",
    );
  }
  try {
    await reserve();
  } catch (error) {
    if (error instanceof SandboxQuotaError && error.reason === undefined) {
      throw new LightSandboxBusyError(
        "All of the organization's light sandboxes are in use right now.",
      );
    }
    throw error;
  }
}

/**
 * Destroy the organization's least recently used light sandbox that is not
 * running code, to give its slot to another owner. False when every one is
 * busy or too young to take.
 */
async function preemptIdleLightSession(
  sql: Sql,
  organizationId: string,
  exceptSessionId: string,
  spawner: LightSessionSpawner,
): Promise<boolean> {
  const horizon = Date.now() - LIGHT_SESSION_PREEMPT_GRACE_MS;
  const candidates = await sql<{ sessionId: string }[]>`
    SELECT session_id AS "sessionId" FROM app.sandbox_sessions
    WHERE org_id = ${organizationId}
      AND owner_type = ${LIGHT_SESSION_OWNER_TYPE}
      AND status IN ('creating', 'active')
      AND session_id <> ${exceptSessionId}
      AND coalesce(last_activity_at_ms, created_at_ms) < ${horizon}
    ORDER BY coalesce(last_activity_at_ms, created_at_ms) ASC
    LIMIT 5
  `;
  for (const candidate of candidates) {
    let outcome: { destroyed: boolean; busy: boolean };
    try {
      outcome = await spawner.destroyIfIdle(candidate.sessionId);
    } catch (error) {
      console.warn(
        `[light-session] preempting ${candidate.sessionId} failed:`,
        error,
      );
      continue;
    }
    if (outcome.busy) continue;
    await markSessionDestroyed(sql, {
      organizationId,
      sessionId: candidate.sessionId,
    });
    return true;
  }
  return false;
}

/** Record a use of the sandbox: its idle window starts again. */
export async function touchLightSession(
  sql: Sql,
  organizationId: string,
  sessionId: string,
): Promise<void> {
  await sql`
    UPDATE app.sandbox_sessions SET last_activity_at_ms = ${Date.now()}
    WHERE org_id = ${organizationId} AND session_id = ${sessionId}
      AND owner_type = ${LIGHT_SESSION_OWNER_TYPE}
      AND status = 'active'
  `;
}

/**
 * Give an owner's light sandbox back now, when its work is over — a task run
 * that settled has no later call to reuse it, so it must not hold the
 * organization's light budget for the idle window. Destroys it unless it is
 * running code (the watchdog's idle release takes it then) and settles its
 * row. Best-effort: the idle release and the spawner's own stop are the
 * backstops, so a spawner that cannot be asked costs minutes, never the
 * caller. Returns whether a sandbox was destroyed.
 */
export async function releaseLightSession(
  sql: Sql,
  owner: Pick<LightSessionOwner, 'organizationId' | 'ownerKey'>,
  spawner: Pick<LightSessionSpawner, 'destroyIfIdle'> = DEFAULT_SPAWNER,
): Promise<boolean> {
  const sessionId = lightSessionId(owner.organizationId, owner.ownerKey);
  try {
    // Most runs never start one: ask the spawner only when a row says there
    // is a sandbox to give back.
    const live = await sql<{ id: string }[]>`
      SELECT id FROM app.sandbox_sessions
      WHERE session_id = ${sessionId} AND org_id = ${owner.organizationId}
        AND owner_type = ${LIGHT_SESSION_OWNER_TYPE}
        AND status IN ('creating', 'active', 'degraded')
      LIMIT 1
    `;
    if (live.length === 0) return false;
    const outcome = await spawner.destroyIfIdle(sessionId);
    if (outcome.busy) return false;
    await markSessionDestroyed(sql, {
      organizationId: owner.organizationId,
      sessionId,
    });
    return outcome.destroyed;
  } catch (error) {
    console.warn(`[light-session] releasing ${sessionId} failed:`, error);
    return false;
  }
}

/**
 * Destroy an owner's light sandbox now, even while it runs code, and settle
 * its row — for an owner that alone uses its sandbox and is done with it,
 * like the Run check of the Chat tool status panel, so the sandbox holds no
 * slot of the organization's light budget after it. Best-effort, like
 * {@link releaseLightSession}: a spawner that cannot be asked leaves the row
 * for the watchdog, so it never settles ahead of its container. Returns
 * whether a sandbox was destroyed.
 */
export async function destroyLightSession(
  sql: Sql,
  owner: Pick<LightSessionOwner, 'organizationId' | 'ownerKey'>,
  spawner: Pick<LightSessionSpawner, 'destroy'> = DEFAULT_SPAWNER,
): Promise<boolean> {
  const sessionId = lightSessionId(owner.organizationId, owner.ownerKey);
  try {
    const destroyed = await spawner.destroy(sessionId);
    await markSessionDestroyed(sql, {
      organizationId: owner.organizationId,
      sessionId,
    });
    return destroyed;
  } catch (error) {
    console.warn(`[light-session] destroying ${sessionId} failed:`, error);
    return false;
  }
}

/**
 * The sandbox watchdog's light lane: destroy every light sandbox unused for
 * `idleMs`, when it runs no code — one the sweep expired at its lifetime cap
 * or whose create failed included, since nothing of a light sandbox is kept.
 * A busy one waits for a later tick; a spawner that cannot be asked leaves
 * the row for a later tick too, so the row never settles ahead of its
 * container.
 *
 * A session id names every incarnation of one owner's sandbox, each its own
 * row, and the spawner and the settle both act on the id. So a stale row is
 * a candidate only when no newer incarnation of its id is live: the failed
 * start of a minute ago must not take the working sandbox its retry made.
 */
export async function releaseIdleLightSessions(
  sql: Sql,
  args: {
    now: number;
    idleMs?: number;
    batch?: number;
    signal?: AbortSignal;
  },
  spawner: Pick<LightSessionSpawner, 'destroyIfIdle'> = DEFAULT_SPAWNER,
): Promise<number> {
  const horizon = args.now - (args.idleMs ?? LIGHT_SESSION_IDLE_MS);
  const candidates = await sql<{ sessionId: string; orgId: string }[]>`
    SELECT session_id AS "sessionId", org_id AS "orgId"
    FROM app.sandbox_sessions stale
    WHERE owner_type = ${LIGHT_SESSION_OWNER_TYPE}
      AND status IN ('creating', 'active', 'failed', 'expired')
      AND destroyed_at_ms IS NULL
      AND coalesce(last_activity_at_ms, created_at_ms) < ${horizon}
      AND NOT EXISTS (
        SELECT 1 FROM app.sandbox_sessions newer
        WHERE newer.org_id = stale.org_id
          AND newer.session_id = stale.session_id
          AND newer.created_at_ms > stale.created_at_ms
          AND newer.status IN ('creating', 'active', 'degraded')
          AND newer.destroyed_at_ms IS NULL
      )
    ORDER BY coalesce(last_activity_at_ms, created_at_ms) ASC
    LIMIT ${args.batch ?? 50}
  `;
  let released = 0;
  for (const candidate of candidates) {
    if (args.signal?.aborted === true) break;
    let outcome: { destroyed: boolean; busy: boolean };
    try {
      outcome = await spawner.destroyIfIdle(candidate.sessionId);
    } catch (error) {
      console.warn(
        `[light-session] releasing ${candidate.sessionId} failed:`,
        error,
      );
      continue;
    }
    if (outcome.busy) continue;
    await markSessionDestroyed(sql, {
      organizationId: candidate.orgId,
      sessionId: candidate.sessionId,
    });
    released += 1;
  }
  return released;
}
