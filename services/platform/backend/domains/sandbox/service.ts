import postgres, { type Sql, type TransactionSql } from 'postgres';

import {
  SessionDuplicateError,
  sessionCreate,
  sessionDestroy,
  sessionIsAlive,
  sessionObserve,
  sessionSetPinned,
  type SessionCreateBody,
} from '../../core/node_only/sandbox/helpers/session_client.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import {
  getSessionBySessionId,
  markRecreatedSessionActive,
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

interface SessionArgs {
  organizationId: string;
  sessionId: string;
}

/** Serialize spawner transitions across replicas. The transaction holds ONLY
 * the advisory lock: lifecycle data commits independently so deleting a
 * gateway key cannot be followed by rollback of its booked spend.
 *
 * Each admitted lock holder gets one short-lived data connection with the
 * root pool's resolved connection options (including TLS and serializers).
 * Using the root pool for that work can deadlock once all its connections
 * are occupied by lock holders. Extra connections are bounded by that pool's
 * maximum; waiters never open one, and finally always closes the data pool.
 *
 * `wait: false` takes the lock only when it is free: a caller that must not
 * queue behind another transition (the reconcile's probes, which a recreate
 * can hold for minutes) gets `{ acquired: false }` and opens no connection. */
async function lifecycleLocked<T>(
  sql: Sql,
  args: SessionArgs,
  wait: boolean,
  work: (sessionSql: Sql) => Promise<T>,
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  let outcome: { acquired: true; value: T } | { acquired: false } = {
    acquired: false,
  };
  await sql.begin(async (lock) => {
    const key = `sandbox-lifecycle:${JSON.stringify([args.organizationId, args.sessionId])}`;
    if (wait) {
      await lock`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    } else {
      const taken = await lock<{ acquired: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS acquired
      `;
      if (!taken[0]?.acquired) return;
    }
    // postgres.js accepts these already-parsed options (its subscription
    // pool does the same). Its public overload only types raw host/port;
    // retain the resolved TLS, multi-host, credential and serializer state.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- postgres.js parseOptions explicitly accepts its own parsed options
    const options = {
      ...sql.options,
      max: 1,
    } as unknown as postgres.Options<{}>;
    const sessionSql = postgres(options);
    try {
      outcome = { acquired: true, value: await work(sessionSql) };
    } finally {
      await sessionSql.end();
    }
  });
  return outcome;
}

/** Wait for the session's lifecycle lock, then run `work` under it. Every
 * spawner-facing transition of one session — Destroy, pin, the reconcile's
 * recreate, the workspace cleanup's retire — holds it through its remote
 * call and row commit. */
export async function withSessionLifecycleLock<T>(
  sql: Sql,
  args: SessionArgs,
  work: (sessionSql: Sql) => Promise<T>,
): Promise<T> {
  const locked = await lifecycleLocked(sql, args, true, work);
  if (!locked.acquired) {
    throw new Error(`the lifecycle lock of ${args.sessionId} was not taken`);
  }
  return locked.value;
}

/** The Sandboxes page's Destroy, as its `sandbox.destroy_session` job runs
 * it (`destroy-schedule.ts`). Authorize before contacting the spawner;
 * settle the row only after it confirms destruction or absence. Failures
 * throw, for the job's retry, and leave the row unpinned on both sides.
 *
 * `rowId` names the incarnation the Destroy was asked for. A retry can run
 * long after the request: by then that row may have been settled another
 * way (the reconcile heals a row whose container is gone) and a turn may
 * have opened a fresh incarnation under the same deterministic id. That one
 * is not this Destroy's to remove, so the teardown leaves it alone. A turn
 * cannot have resumed the row it names in between: a pending Destroy closes
 * its row to admission (`destroy-schedule.ts`), since a resume keeps the
 * row id this check reads. */
export async function teardownSession(
  sql: Sql,
  args: SessionArgs & { rowId?: string },
  destroy: (sessionId: string) => Promise<boolean> = sessionDestroy,
  setPinned: (
    sessionId: string,
    pinned: boolean,
  ) => Promise<boolean> = sessionSetPinned,
): Promise<boolean> {
  const { rowId, ...sessionArgs } = args;
  return withSessionLifecycleLock(sql, sessionArgs, async (sessionSql) => {
    const session = await getSessionBySessionId(
      sessionSql,
      sessionArgs.organizationId,
      sessionArgs.sessionId,
    );
    if (session === null) return false;
    if (
      rowId !== undefined &&
      (session.id !== rowId || session.status === 'destroyed')
    ) {
      return false;
    }
    // Persist the no-recreate intent BEFORE an irreversible remote delete.
    // A lost response or a later database failure leaves a visible unpinned
    // row to retry/heal, never authority to recreate a wiped workspace. Only
    // a pinned row is written: an unpin restarts the row's lifetime, which a
    // failed Destroy must not hand an unpinned session.
    if (session.pinned) {
      await setSessionPinned(sessionSql, { ...sessionArgs, pinned: false });
    }
    // Drop the spawner's own pin as well, best-effort. Do not wait for the
    // drift sweep to repair a pin left on a failed destroy: this row may
    // expire before the next sweep sees it.
    try {
      await setPinned(sessionArgs.sessionId, false);
    } catch (error) {
      console.warn(
        `[sandbox] spawner unpin before destroying ${sessionArgs.sessionId} failed:`,
        error,
      );
    }
    await destroy(sessionArgs.sessionId);
    return markSessionDestroyed(sessionSql, sessionArgs);
  });
}

/** Pin/unpin on both sides (platform TTL exemption + spawner reaper skip). */
export async function pinSession(
  sql: Sql,
  args: SessionArgs & { pinned: boolean },
  setPinned: (
    sessionId: string,
    pinned: boolean,
  ) => Promise<boolean> = sessionSetPinned,
): Promise<boolean> {
  return withSessionLifecycleLock(sql, args, async (sessionSql) => {
    const patched = await setSessionPinned(sessionSql, args);
    if (patched) {
      try {
        if (!(await setPinned(args.sessionId, args.pinned))) {
          throw new Error(
            `the spawner did not confirm pin=${args.pinned} for ${args.sessionId}; the saved intent will be retried`,
          );
        }
      } catch (error) {
        console.warn(
          `[sandbox] spawner pin patch failed for ${args.sessionId} (platform row updated):`,
          error,
        );
        throw error;
      }
    }
    return patched;
  });
}

/**
 * The spawner verbs the reconcile uses. Injectable so the unit layer, the
 * watchdog's scripted spawner and the integration probe drive it; production
 * uses the signed session client.
 */
export interface ReconcileSpawner {
  /** GET /v1/sessions/:id — false ONLY on a definitive 404; throws otherwise. */
  isAlive: (sessionId: string) => Promise<boolean>;
  /** Optional for older scripted transports. Production compares both
   * directions instead of blindly reapplying a pin (which refreshes TTL). */
  observe?: (
    sessionId: string,
    signal?: AbortSignal,
  ) => Promise<{ pinned?: boolean; pinSynchronized?: boolean } | null>;
  /** PATCH /v1/sessions/:id/pin — true once the spawner holds the flag. */
  setPinned: (
    sessionId: string,
    pinned: boolean,
    signal?: AbortSignal,
  ) => Promise<boolean>;
  /** POST /v1/sessions — under an id whose workspace the spawner preserved,
   * the create re-attaches that workspace (a resume, not a fresh one). */
  create: (body: SessionCreateBody) => Promise<unknown>;
}

const DEFAULT_RECONCILE_SPAWNER: ReconcileSpawner = {
  isAlive: sessionIsAlive,
  observe: (sessionId, signal) => sessionObserve(sessionId, signal),
  setPinned: sessionSetPinned,
  create: sessionCreate,
};

/** Queues the recreate of one pinned session gone spawner-side. */
export type RecreateScheduler = (
  sql: Sql | TransactionSql,
  args: SessionArgs,
) => Promise<void>;

/** One `sandbox.recreate_pinned` job per session: the queue is `exclusive`,
 * so while one is queued or running for the key, a sweep tick or a page open
 * that finds the session still gone adds nothing. */
export const schedulePinnedRecreate: RecreateScheduler = async (sql, args) => {
  await addJobInTx(
    sql,
    'sandbox.recreate_pinned',
    { organizationId: args.organizationId, sessionId: args.sessionId },
    { singletonKey: JSON.stringify([args.organizationId, args.sessionId]) },
  );
};

export interface ReconcileOptions {
  signal?: AbortSignal;
  /**
   * How a pinned session gone spawner-side comes back. `schedule` (the
   * default: the sweep and the Sandboxes page probe) queues the recreate and
   * returns `recreating`. A create can take minutes (runnerd readiness alone
   * is allowed 180 s) under the session's lock and connections, and a batch
   * that waited for each one would stall its later rows, the sweep's other
   * lanes and the page's request. `inline` (that queued job) creates under
   * the lock and returns `recreated`.
   */
  recreate?: 'schedule' | 'inline';
  /** Where `schedule` queues the recreate — the job by default. */
  schedule?: RecreateScheduler;
}

/** The statuses under which a row holds compute — the reconcile pass's
 * candidates. Only such a row is the reconcile's to settle or keep running:
 * a `stopped` row is hibernated on purpose (its container is gone by design),
 * a terminal one is history. */
const COMPUTE_HOLDING_STATUSES: ReadonlySet<string> = new Set([
  'creating',
  'active',
  'degraded',
]);

export type ReconcileOutcome =
  /** Alive spawner-side with the desired pin state: nothing to do. */
  | 'live'
  /** Gone spawner-side and unpinned (or a pinned render): the row settled
   * as destroyed. */
  | 'healed'
  /** Alive and pinned: the pin re-asserted spawner-side. Also a gone pinned
   * session whose recreate the spawner answered as a duplicate — back
   * already, so this visit created nothing and only re-pinned it. */
  | 'repinned'
  /** Gone and pinned: its recreate queued (`recreate: 'schedule'`). */
  | 'recreating'
  /** Gone and pinned: recreated in place by this visit and re-pinned
   * (`recreate: 'inline'`); a `creating` row reads `active` after it. */
  | 'recreated'
  /** Not the reconcile's to touch: the row left the compute-holding
   * statuses since the batch named it (destroyed, hibernated or expired
   * meanwhile), another visit settled it first, or — for a probe that does
   * not wait — another lifecycle transition holds the session's lock. */
  | 'skipped';

/**
 * Watchdog reconcile for one row. An unlocked first look settles the common
 * visit — a live session whose pin agrees needs no write, so it takes no
 * lifecycle lock. Every other verdict is decided again under
 * the shared lifecycle lock: probe liveness, then read the row fresh (the
 * batch that named it may be minutes old). Destroy and pin/unpin hold this
 * lock through their remote operation and row commit, so the probe cannot
 * act on a half-completed transition. In `schedule` mode the lock is only
 * TRIED: a session whose lock another transition holds is skipped for the
 * next visit, so a probe never queues behind a Destroy or a recreate.
 *
 * - A row no longer holding compute is left alone, pinned or not — a
 *   hibernated project workspace keeps its workspace even when the spawner
 *   answers 404 for its container.
 * - Unpinned: a stale runtime pin is removed. A container gone spawner-side
 *   settles the row as destroyed (phantom heal); `healed` counts only a row
 *   this visit settled.
 * - Pinned: the row is the durable truth of the pin, and nothing else pushes
 *   it back to the spawner — which forgets a pin whenever its container goes
 *   (a new create always starts unpinned). A live session with pin drift has
 *   it repaired; a matching pin is left alone to avoid refreshing TTL. A gone agent workspace is recreated under the same id — the
 *   spawner resolves the workspace by id, so the create re-attaches the
 *   preserved workspace (on the device it lives on, when it lives on one) —
 *   and re-pinned, never settled as destroyed: queued in `schedule` mode,
 *   done in `inline` mode. A row still `creating` (its host died
 *   mid-provision) reads `active` once the recreate answers. A create the
 *   spawner answers as a duplicate means the session is back already (a turn
 *   or a concurrent reconcile recreated it): it is only re-pinned
 *   (`repinned`), and deliberately not acquired, since no work follows; its
 *   row is left to whoever created it. A gone pinned RENDER sandbox heals
 *   like an unpinned phantom: it serves one crawl batch and nothing ever
 *   reuses it, and its batch's own teardown does not take this lock, so a
 *   recreate could only leave an empty pinned container behind that
 *   teardown.
 *
 * Every spawner failure — a refused pin, a create the spawner could not
 * serve, an offline device, a pinned row with no known profile — throws, so
 * the caller leaves the row for its next visit instead of settling it on a
 * guess.
 */
export async function reconcileSession(
  sql: Sql,
  args: SessionArgs,
  spawner: ReconcileSpawner = DEFAULT_RECONCILE_SPAWNER,
  options: ReconcileOptions = {},
): Promise<ReconcileOutcome> {
  const seen = await getSessionBySessionId(
    sql,
    args.organizationId,
    args.sessionId,
  );
  if (seen === null || !COMPUTE_HOLDING_STATUSES.has(seen.status)) {
    return 'skipped';
  }
  if (options.signal?.aborted) return 'skipped';
  if (spawner.observe !== undefined) {
    const observation = await spawner.observe(args.sessionId, options.signal);
    if (
      observation !== null &&
      observation.pinSynchronized !== false &&
      observation.pinned === seen.pinned
    )
      return 'live';
  } else if (!seen.pinned && (await spawner.isAlive(args.sessionId)))
    return 'live';
  const inline = options.recreate === 'inline';
  const locked = await lifecycleLocked(sql, args, inline, async (sessionSql) =>
    reconcileLocked(sessionSql, args, spawner, {
      inline,
      schedule: options.schedule ?? schedulePinnedRecreate,
      signal: options.signal,
    }),
  );
  return locked.acquired ? locked.value : 'skipped';
}

/** The queued job's body: `reconcileSession` in `inline` mode, which waits
 * for the session's lock and recreates a pinned session still gone. */
export async function recreatePinnedSession(
  sql: Sql,
  args: SessionArgs,
  spawner: ReconcileSpawner = DEFAULT_RECONCILE_SPAWNER,
): Promise<ReconcileOutcome> {
  return reconcileSession(sql, args, spawner, { recreate: 'inline' });
}

async function reconcileLocked(
  sessionSql: Sql,
  args: SessionArgs,
  spawner: ReconcileSpawner,
  mode: { inline: boolean; schedule: RecreateScheduler; signal?: AbortSignal },
): Promise<ReconcileOutcome> {
  if (mode.signal?.aborted) return 'skipped';
  const observation =
    spawner.observe !== undefined
      ? await spawner.observe(args.sessionId, mode.signal)
      : (await spawner.isAlive(args.sessionId))
        ? {}
        : null;
  const alive = observation !== null;
  const row = await getSessionBySessionId(
    sessionSql,
    args.organizationId,
    args.sessionId,
  );
  if (row === null || !COMPUTE_HOLDING_STATUSES.has(row.status)) {
    return 'skipped';
  }
  if (row.pinned && alive) {
    if (observation?.pinned === true && observation.pinSynchronized !== false)
      return 'live';
    await requirePin(spawner, args.sessionId, 'repinned', mode.signal);
    return 'repinned';
  }
  if (alive) {
    if (
      (observation?.pinned === true ||
        observation?.pinSynchronized === false) &&
      !(await spawner.setPinned(args.sessionId, false, mode.signal))
    ) {
      throw new Error(
        `the spawner did not remove the pin of ${args.sessionId}; the next reconcile retries`,
      );
    }
    return 'live';
  }
  const body = row.pinned ? recreateBody(row) : null;
  if (body === null) {
    return (await markSessionDestroyed(sessionSql, args))
      ? 'healed'
      : 'skipped';
  }
  if (!mode.inline) {
    await mode.schedule(sessionSql, args);
    return 'recreating';
  }
  let created = true;
  try {
    await spawner.create(body);
  } catch (error) {
    if (!(error instanceof SessionDuplicateError)) throw error;
    created = false;
    console.warn(
      `[sandbox] pinned session ${args.sessionId} is back spawner-side already; re-pinning it`,
    );
  }
  // A create answers once runnerd is ready. A `creating` row's host died
  // before it could flip the row (a live host adopts this session as a
  // duplicate and flips it itself), so settle it here, BEFORE the pin: a
  // refused pin must not leave a ready container under `creating` for good.
  if (created && row.status === 'creating') {
    await markRecreatedSessionActive(sessionSql, {
      organizationId: args.organizationId,
      rowId: row.id,
    });
  }
  await requirePin(spawner, args.sessionId, created ? 'recreated' : 'repinned');
  return created ? 'recreated' : 'repinned';
}

async function requirePin(
  spawner: ReconcileSpawner,
  sessionId: string,
  outcome: 'repinned' | 'recreated',
  signal?: AbortSignal,
): Promise<void> {
  const confirmed =
    signal === undefined
      ? await spawner.setPinned(sessionId, true)
      : await spawner.setPinned(sessionId, true, signal);
  if (!confirmed) {
    throw new Error(
      `the spawner did not take the pin of ${sessionId}${outcome === 'recreated' ? ' after recreating it' : ''}; the next reconcile retries`,
    );
  }
}

/** The body the row's own create site sent — same id, organization and
 * profile — or null for a render sandbox, which is never recreated (see
 * `reconcileSession`). Agent workspaces may live on one of the
 * organization's devices (the hub routes an id it placed back to that
 * machine, and keeps a server-side workspace on the server). */
function recreateBody(row: SessionRow): SessionCreateBody | null {
  if (row.profile === 'agent') {
    return {
      sessionId: row.sessionId,
      organizationId: row.organizationId,
      profile: 'agent',
      workload: row.ownerType === 'workflow_run' ? 'workflow' : 'project',
      placement: 'device',
    };
  }
  if (row.profile === 'default') return null;
  throw new Error(
    `pinned session ${row.sessionId} carries no known profile (${JSON.stringify(row.profile)}); it cannot be recreated`,
  );
}
