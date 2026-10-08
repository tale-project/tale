import postgres, { type Sql, type TransactionSql } from 'postgres';

import {
  SessionDuplicateError,
  sandboxWorkspaceInventory,
  sessionCreate,
  sessionDestroy,
  sessionIsAlive,
  sessionObserve,
  sessionSetPinned,
  type SandboxWorkspaceInventory,
  type SessionCreateBody,
} from '../../core/node_only/sandbox/helpers/session_client.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import type { TaskPayloads } from '../../jobs/tasks.ts';
import {
  getSessionBySessionId,
  markRecreatedSessionActive,
  markSessionDestroyed,
  markSessionStopped,
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
    // Drop the spawner's own pin immediately, best-effort, so a failed
    // destroy does not wait for drift reconciliation to become reapable.
    // Asked of every row: a failed Unpin can leave the runtime pinned under
    // an unpinned row. The watchdog also repairs retained expired rows.
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

/** Persist desired pin and its delivery together. The immediate patch keeps
 * the toggle responsive; the durable job survives a lost response or process.
 * A queued job reads the latest value, never an obsolete toggle's boolean. */
export async function pinSession(
  sql: Sql,
  args: SessionArgs & { pinned: boolean },
  setPinned: (
    sessionId: string,
    pinned: boolean,
  ) => Promise<boolean> = sessionSetPinned,
): Promise<boolean> {
  return withSessionLifecycleLock(sql, args, async (sessionSql) => {
    const patched = await sessionSql.begin(async (tx) => {
      if (!(await setSessionPinned(tx, args))) return false;
      const row = await getSessionBySessionId(
        tx,
        args.organizationId,
        args.sessionId,
      );
      if (row === null) throw new Error('The sandbox pin has no session row');
      await scheduleSessionPinSync(tx, { ...args, rowId: row.id });
      return true;
    });
    if (patched) {
      try {
        if (!(await setPinned(args.sessionId, args.pinned))) {
          throw new Error(
            `the spawner did not confirm pin=${args.pinned} for ${args.sessionId}; the saved intent will be retried`,
          );
        }
      } catch (error) {
        console.warn(
          `[sandbox] spawner pin patch failed for ${args.sessionId} (the durable job retries):`,
          error,
        );
        throw error;
      }
    }
    return patched;
  });
}

/** `short` permits one waiting delivery while a previous one is active.
 * Unlike an exclusive queue, it cannot absorb a toggle that commits just
 * after an active delivery read the old desired value. */
async function scheduleSessionPinSync(
  sql: Sql | TransactionSql,
  args: TaskPayloads['sandbox.sync_pin'],
  retry = false,
): Promise<void> {
  await addJobInTx(
    sql,
    'sandbox.sync_pin',
    {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      rowId: args.rowId,
    },
    {
      singletonKey: JSON.stringify([
        args.organizationId,
        args.sessionId,
        args.rowId,
      ]),
      ...(retry ? { startAfter: new Date(Date.now() + 60_000) } : {}),
    },
  );
}

/** Deliver the current desired pin of exactly this incarnation. A failed
 * delivery schedules another durable attempt, including for an offline
 * device that stays away beyond the queue's crash-retry ladder. */
export async function syncSessionPin(
  sql: Sql,
  args: TaskPayloads['sandbox.sync_pin'],
  spawner: Pick<
    ReconcileSpawner,
    'isAlive' | 'setPinned'
  > = DEFAULT_RECONCILE_SPAWNER,
): Promise<void> {
  try {
    await withSessionLifecycleLock(sql, args, async (sessionSql) => {
      const row = await getSessionBySessionId(
        sessionSql,
        args.organizationId,
        args.sessionId,
      );
      if (row === null || row.id !== args.rowId || row.status === 'destroyed')
        return;
      // Expired rows still need their failed Unpin delivered. A true pin
      // belongs only to a live incarnation; its recreate is the sweep's job.
      if (
        row.pinned &&
        !COMPUTE_HOLDING_STATUSES.has(row.status) &&
        row.status !== 'stopped'
      )
        return;
      if (await spawner.setPinned(args.sessionId, row.pinned)) return;
      // Gone compute retains no runtime pin. A pinned live row's normal
      // reconcile recreates it; never resurrect a retired incarnation here.
      if (!(await spawner.isAlive(args.sessionId))) return;
      throw new Error('The spawner did not acknowledge the sandbox pin');
    });
  } catch (error) {
    // If queuing fails too, throw and let pg-boss retry this attempt. No
    // failed remote delivery may quietly lose its remaining durable work.
    await scheduleSessionPinSync(sql, args, true);
    console.warn(
      `[sandbox] pin synchronization for ${args.sessionId} will retry:`,
      error,
    );
  }
}

/**
 * The spawner verbs the reconcile uses. Injectable so the unit layer, the
 * watchdog's scripted spawner and the integration probe drive it; production
 * uses the signed session client.
 */
interface SessionRuntimeState {
  alive: boolean;
  pinned?: boolean;
  pinSynchronized?: boolean;
}

export interface ReconcileSpawner {
  /** One production GET also reports whether durable pin persistence completed. */
  observe?: (
    sessionId: string,
    signal?: AbortSignal,
  ) => Promise<{ pinned?: boolean; pinSynchronized?: boolean } | null>;
  /** GET /v1/sessions/:id — false ONLY on a definitive 404; throws otherwise. */
  isAlive: (
    sessionId: string,
    options?: { signal?: AbortSignal },
  ) => Promise<boolean>;
  /** PATCH /v1/sessions/:id/pin — true once the spawner holds the flag. */
  setPinned: (
    sessionId: string,
    pinned: boolean,
    options?: { signal?: AbortSignal },
  ) => Promise<boolean>;
  /** POST /v1/sessions — under an id whose workspace the spawner preserved,
   * the create re-attaches that workspace (a resume, not a fresh one). */
  create: (body: SessionCreateBody) => Promise<unknown>;
  /** GET /v1/workspaces — every workspace the spawner holds, stopped
   * sessions' preserved data included; `null` from a spawner without the
   * route. Where absent, an agent session whose compute is gone heals as
   * destroyed, as a render's always does. */
  inventory?: (options?: {
    signal?: AbortSignal;
  }) => Promise<SandboxWorkspaceInventory | null>;
}

const DEFAULT_RECONCILE_SPAWNER: ReconcileSpawner = {
  isAlive: sessionIsAlive,
  observe: (sessionId, signal) => sessionObserve(sessionId, signal),
  setPinned: sessionSetPinned,
  create: sessionCreate,
  inventory: sandboxWorkspaceInventory,
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
  /** Stop remote probes when the watchdog pass has spent its budget. */
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
  /** A stale runtime pin was removed to match the durable false. */
  | 'unpinned'
  /** Alive spawner-side and unpinned: nothing to do. */
  | 'live'
  /** Gone spawner-side and unpinned (or a pinned render): the row settled
   * — as stopped for an agent session whose workspace the spawner still
   * holds, as destroyed otherwise. */
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
 * - A row no longer holding compute keeps its workspace even when the
 *   spawner answers 404. Retained unpinned stopped/expired rows may receive
 *   metadata-only repair of a proven stale runtime pin.
 * - Unpinned compute-holding rows: a container gone spawner-side settles
 *   the row (phantom heal); `healed` counts only such a row. An agent
 *   session (`agent`, `agent-light`: a project agent's or an automation
 *   run's) whose workspace the spawner still holds — a container lost to a
 *   host reboot, a daemon restart, the OOM killer or the spawner's own TTL —
 *   settles as `stopped`: hibernated, its slot freed and its credentials
 *   reclaimed, and resumed in place by the next turn, which keeps the
 *   incarnation and so the harness conversation. Settled as destroyed, the
 *   next turn would open a fresh incarnation beside the kept files. An
 *   inventory that cannot be read keeps the workspace too; one that lists no
 *   workspace under the id, and a render session (disposable), settle as
 *   destroyed.
 * - Pinned: the row is the durable truth. Pin-change jobs deliver the latest
 *   intent; reconciliation restores it after lost compute (a new create
 *   always starts unpinned). A live session has the pin
 *   re-asserted. A gone agent workspace is recreated under the same id — the
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
  options.signal?.throwIfAborted();
  const observe = spawner.observe;
  const controlled: ReconcileSpawner =
    options.signal === undefined
      ? spawner
      : {
          ...spawner,
          ...(observe === undefined
            ? {}
            : {
                observe: (sessionId: string) =>
                  observe(sessionId, options.signal),
              }),
          isAlive: (sessionId) =>
            spawner.isAlive(sessionId, { signal: options.signal }),
          setPinned: (sessionId, pinned) =>
            spawner.setPinned(sessionId, pinned, { signal: options.signal }),
        };
  const seen = await getSessionBySessionId(
    sql,
    args.organizationId,
    args.sessionId,
  );
  if (seen === null || !canReconcile(seen, controlled)) return 'skipped';
  if (!seen.pinned || controlled.observe !== undefined) {
    const observed = await readRuntimeState(controlled, args.sessionId);
    if (
      observed.alive &&
      observed.pinSynchronized !== false &&
      (observed.pinned === seen.pinned ||
        (!seen.pinned && observed.pinned === undefined))
    )
      return 'live';
    if (!observed.alive && !COMPUTE_HOLDING_STATUSES.has(seen.status))
      return 'skipped';
  }
  const inline = options.recreate === 'inline';
  const locked = await lifecycleLocked(sql, args, inline, async (sessionSql) =>
    reconcileLocked(sessionSql, args, controlled, {
      inline,
      schedule: options.schedule ?? schedulePinnedRecreate,
      signal: options.signal,
    }),
  );
  return locked.acquired ? locked.value : 'skipped';
}

function canReconcile(row: SessionRow, spawner: ReconcileSpawner): boolean {
  return (
    COMPUTE_HOLDING_STATUSES.has(row.status) ||
    (spawner.observe !== undefined &&
      !row.pinned &&
      (row.status === 'stopped' || row.status === 'expired'))
  );
}

async function readRuntimeState(
  spawner: ReconcileSpawner,
  sessionId: string,
): Promise<SessionRuntimeState> {
  if (spawner.observe !== undefined) {
    const observed = await spawner.observe(sessionId);
    return observed === null ? { alive: false } : { ...observed, alive: true };
  }
  return { alive: await spawner.isAlive(sessionId) };
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
  mode.signal?.throwIfAborted();
  const observed = await readRuntimeState(spawner, args.sessionId);
  const alive = observed.alive;
  const row = await getSessionBySessionId(
    sessionSql,
    args.organizationId,
    args.sessionId,
  );
  if (row === null || !canReconcile(row, spawner)) return 'skipped';
  if (
    !row.pinned &&
    alive &&
    (observed.pinned === true || observed.pinSynchronized === false)
  ) {
    // Older failed Unpins had no durable job. Capture one before retrying
    // the drift, including a stopped/expired allocation whose compute is
    // still always-on. Missing compute in these statuses is never destroyed.
    await scheduleSessionPinSync(sessionSql, { ...args, rowId: row.id });
    if (!(await spawner.setPinned(args.sessionId, false))) {
      throw new Error(
        `the spawner did not remove the pin of ${args.sessionId}; the durable job retries`,
      );
    }
    return 'unpinned';
  }
  if (!COMPUTE_HOLDING_STATUSES.has(row.status)) return 'skipped';
  if (row.pinned && alive) {
    if (observed.pinned === true && observed.pinSynchronized !== false)
      return 'live';
    await requirePin(spawner, args.sessionId, 'repinned');
    return 'repinned';
  }
  if (alive) return 'live';
  const body = row.pinned ? recreateBody(row) : null;
  if (body === null) {
    if (!row.pinned && (await keepsWorkspace(spawner, row, mode.signal))) {
      return (await markSessionStopped(sessionSql, {
        ...args,
        rowId: row.id,
      }))
        ? 'healed'
        : 'skipped';
    }
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

/** How long the reconcile waits for the spawner's workspace inventory. It
 * is read under the session's lifecycle lock, so it gets the bound of the
 * reconcile's other spawner reads rather than the cleanup's minute; an
 * inventory slower than that is one that cannot be read. */
const RECONCILE_INVENTORY_TIMEOUT_MS = 15_000;

/** Does the spawner still hold the workspace of an agent session whose
 * compute is gone? A render session's workspace is disposable, so never. An
 * inventory that cannot be read answers yes: settling the row as stopped
 * frees its slot all the same, and a resume that finds no conversation
 * falls back to a fresh one, while settling it as destroyed would leave the
 * files to a fresh incarnation. The read stops with the caller's `signal`,
 * and then THROWS: a pass that ran out of time settles nothing on a guess,
 * and leaves the row to its next visit. */
async function keepsWorkspace(
  spawner: ReconcileSpawner,
  row: SessionRow,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  if (row.profile !== 'agent' && row.profile !== 'agent-light') return false;
  if (spawner.inventory === undefined) return false;
  let inventory: SandboxWorkspaceInventory | null;
  try {
    inventory = await spawner.inventory({
      signal: AbortSignal.any([
        AbortSignal.timeout(RECONCILE_INVENTORY_TIMEOUT_MS),
        ...(signal ? [signal] : []),
      ]),
    });
  } catch (error) {
    signal?.throwIfAborted();
    console.warn(
      `[sandbox] workspace inventory unavailable while healing ${row.sessionId}; its workspace is kept:`,
      error,
    );
    return true;
  }
  if (inventory === null) return true;
  return inventory.workspaces.some(
    (workspace) => workspace.sessionId === row.sessionId,
  );
}

async function requirePin(
  spawner: ReconcileSpawner,
  sessionId: string,
  outcome: 'repinned' | 'recreated',
): Promise<void> {
  const confirmed = await spawner.setPinned(sessionId, true);
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
  if (row.profile === 'agent' || row.profile === 'agent-light') {
    return {
      sessionId: row.sessionId,
      organizationId: row.organizationId,
      profile: row.profile,
      workload: row.ownerType === 'workflow_run' ? 'workflow' : 'project',
      placement: 'device',
    };
  }
  if (row.profile === 'default') return null;
  throw new Error(
    `pinned session ${row.sessionId} carries no known profile (${JSON.stringify(row.profile)}); it cannot be recreated`,
  );
}
