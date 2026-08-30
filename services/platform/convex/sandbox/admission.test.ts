// Park-on-capacity admission queue — FIFO verdict math, ticket idempotency,
// the atomic reserve+claim (WAIT_FIFO when not front-of-queue), and the
// staleness reaper. convexTest (real in-memory DB) because the hazard is index
// iteration order + cross-row counting, exactly what a hand-rolled mock fakes
// away.

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { AppError } from '../../lib/shared/errors/app-error';
import { internal } from '../_generated/api';
import schema from '../schema';
import { isWaitFifoError, WAIT_FIFO_CODE } from './admission';
import { DEFAULT_SANDBOX_QUOTA } from './quota_policy';
import { SANDBOX_ADMISSION_TICKET_STALE_MS } from './sessions_schema';

// convex-test module map keyed relative to the convex/ root (this file is at
// convex/sandbox/, mirror session_lifecycle.test.ts).
const TEST_DIR_FROM_CONVEX_ROOT = 'sandbox';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}

type T = TestConvex<typeof schema>;

const ORG = 'org_admission';
// These tests exercise `ownerType: 'workflow_run'` owners, which draw from the
// per-workflow session budget (each budget — user / thread / workflow — is
// capped separately), so the relevant cap is `maxWorkflowSessionsPerOrg`.
const SESSION_CAP = DEFAULT_SANDBOX_QUOTA.maxWorkflowSessionsPerOrg; // 4

/** Seed an active session row that holds a per-org session slot. */
async function seedActiveSession(t: T, ownerId: string): Promise<void> {
  await t.run((ctx) =>
    ctx.db.insert('sandboxSessions', {
      organizationId: ORG,
      sessionId: `sid-${ownerId}`,
      profile: 'agent',
      status: 'active',
      ownerType: 'workflow_run',
      ownerId,
      createdBy: 'system',
      createdAt: 0,
      expiresAt: Date.now() + 60_000,
    }),
  );
}

/** Insert a WAITING ticket directly (a peer waiter ahead in the FIFO queue). */
async function seedWaitingTicket(
  t: T,
  ownerId: string,
  createdAt: number,
  lastSeenAt = Date.now(),
  source: 'chat' | 'workflow' = 'workflow',
  wfExecutionId?: string,
): Promise<void> {
  await t.run((ctx) =>
    ctx.db.insert('sandboxAdmissionTickets', {
      organizationId: ORG,
      kind: 'session',
      ownerType: 'workflow_run',
      ownerId,
      source,
      status: 'waiting',
      createdAt,
      lastSeenAt,
      ...(wfExecutionId !== undefined && { wfExecutionId }),
    }),
  );
}

/** Insert a wfExecutions row and return its id (so a workflow ticket can point
 * its `wfExecutionId` at a running/terminal owner for the reaper). */
async function seedOwnerExec(
  t: T,
  status: 'running' | 'completed' | 'failed',
): Promise<string> {
  return t.run((ctx) =>
    ctx.db.insert('wfExecutions', {
      organizationId: ORG,
      wfDefinitionId: 'issue-desk/desk-process',
      status,
      currentStepSlug: 'implement',
      startedAt: 1_000,
      updatedAt: 1_000,
    }),
  );
}

function poll(t: T, ownerId: string) {
  return t.mutation(internal.sandbox.admission.pollAdmission, {
    organizationId: ORG,
    kind: 'session',
    ownerType: 'workflow_run',
    ownerId,
    source: 'workflow',
  });
}

async function ticketsForOwner(t: T, ownerId: string) {
  return t.run((ctx) =>
    ctx.db
      .query('sandboxAdmissionTickets')
      .withIndex('by_owner', (q) =>
        q.eq('ownerType', 'workflow_run').eq('ownerId', ownerId),
      )
      .collect(),
  );
}

/** The `wakeHeadWaiters` nudges queued by the arrival/reaper edges (read off the
 * `_scheduled_functions` system table; we never run them — the wake imports the
 * workflow component, which isn't wired in unit tests). */
async function scheduledWakes(
  t: T,
): Promise<Array<{ organizationId: string; kind: string; count: number }>> {
  return t.run(async (ctx) => {
    const fns = await ctx.db.system.query('_scheduled_functions').collect();
    return (
      fns
        .filter((fn) => fn.name.includes('wakeHeadWaiters'))
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- _scheduled_functions.args is any[]
        .map(
          (fn) =>
            fn.args[0] as {
              organizationId: string;
              kind: string;
              count: number;
            },
        )
    );
  });
}

describe('pollAdmission verdict math', () => {
  it('admits when the org has a free slot', async () => {
    const t = convexTest(schema, modules);
    const res = await poll(t, 'owner_a');
    expect(res.verdict).toBe('admit');
    // The poll upserts a single WAITING ticket (the heartbeat/queue marker).
    const tickets = await ticketsForOwner(t, 'owner_a');
    expect(tickets).toHaveLength(1);
    expect(tickets[0]?.status).toBe('waiting');
  });

  it('waits when the org is at its session cap', async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < SESSION_CAP; i++) {
      await seedActiveSession(t, `holder_${i}`);
    }
    const res = await poll(t, 'owner_a');
    expect(res.verdict).toBe('wait');
  });
});

describe('FIFO ordering', () => {
  it('admits the oldest waiter and parks the newer when one slot is open', async () => {
    const t = convexTest(schema, modules);
    // Fill to exactly one open slot (cap - 1 active holders → slotsOpen = 1).
    for (let i = 0; i < SESSION_CAP - 1; i++) {
      await seedActiveSession(t, `holder_${i}`);
    }
    // An earlier waiter is already queued (createdAt far in the past).
    await seedWaitingTicket(t, 'owner_old', 1_000);

    // A newer owner polls: it ranks behind owner_old (rank 1 >= slotsOpen 1).
    const newer = await poll(t, 'owner_new');
    expect(newer.verdict).toBe('wait');

    // The older owner polls: rank 0 < slotsOpen 1 → admit.
    const older = await poll(t, 'owner_old');
    expect(older.verdict).toBe('admit');
  });
});

describe('arrival-wake (self-heal on a fresh park)', () => {
  it('parks with a slot still open but schedules no capacity wake — the wake is offline', async () => {
    const t = convexTest(schema, modules);
    // One slot open (cap - 1 active holders) and an older waiter ahead, so the
    // newcomer parks even though capacity is free — exactly the state that used
    // to trigger a self-heal wake. The wake targeted workflow-engine waiters,
    // offline while that engine is rebuilt, so parking here schedules nothing
    // (the FIFO verdict math itself is untouched — it still parks correctly).
    for (let i = 0; i < SESSION_CAP - 1; i++) {
      await seedActiveSession(t, `holder_${i}`);
    }
    await seedWaitingTicket(t, 'owner_old', 1_000);

    const res = await poll(t, 'owner_new');
    expect(res.verdict).toBe('wait');
    expect(await scheduledWakes(t)).toHaveLength(0);
  });

  it('schedules NO wake when the org is genuinely full', async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < SESSION_CAP; i++) {
      await seedActiveSession(t, `holder_${i}`);
    }
    const res = await poll(t, 'owner_a');
    expect(res.verdict).toBe('wait');
    // slotsOpen <= 0 → nothing to wake; an over-eager nudge would be wasteful.
    expect(await scheduledWakes(t)).toHaveLength(0);
  });

  it('schedules NO wake when it is admitted directly', async () => {
    const t = convexTest(schema, modules);
    const res = await poll(t, 'owner_a');
    expect(res.verdict).toBe('admit');
    expect(await scheduledWakes(t)).toHaveLength(0);
  });
});

describe('priority inheritance (workflow-completion priority)', () => {
  async function seedExecution(t: T, startedAt: number): Promise<string> {
    return t.run((ctx) =>
      ctx.db.insert('wfExecutions', {
        organizationId: ORG,
        wfDefinitionId: 'issue-desk/desk-process',
        status: 'running',
        currentStepSlug: 'review',
        startedAt,
        updatedAt: startedAt,
      }),
    );
  }

  it('keys a workflow ticket on the WORKFLOW start time, not the step park time', async () => {
    const t = convexTest(schema, modules);
    // One slot open (cap 2, one active holder).
    await seedActiveSession(t, 'holder');
    // A peer parked earlier IN WALL-CLOCK (createdAt 5000).
    await seedWaitingTicket(t, 'owner_peer', 5_000);
    // A workflow that STARTED earlier (1000) but whose later step only parks now.
    const execId = await seedExecution(t, 1_000);

    const res = await t.mutation(internal.sandbox.admission.pollAdmission, {
      organizationId: ORG,
      kind: 'session',
      ownerType: 'workflow_run',
      ownerId: 'wf_step2',
      source: 'workflow',
      wfExecutionId: execId,
      stepSlug: 'review',
    });

    // Inherited the workflow's start (1000) → ranks AHEAD of the peer (5000) →
    // admits. Without inheritance it would key on `now` (≫5000) and wait.
    expect(res.verdict).toBe('admit');
    expect(res.ticketCreatedAt).toBe(1_000);
  });
});

describe('ticket idempotency', () => {
  it('keeps ONE ticket per owner across re-polls with a stable createdAt', async () => {
    const t = convexTest(schema, modules);
    const first = await poll(t, 'owner_a');
    const second = await poll(t, 'owner_a');
    expect(second.ticketCreatedAt).toBe(first.ticketCreatedAt);
    const tickets = await ticketsForOwner(t, 'owner_a');
    expect(tickets).toHaveLength(1);
  });
});

describe('atomic reserve + claim', () => {
  function reserve(t: T, ownerId: string) {
    return t.mutation(
      internal.sandbox.session_mutations.reserveSessionSlotAndInsert,
      {
        organizationId: ORG,
        sessionId: `sid-${ownerId}`,
        profile: 'agent',
        ownerType: 'workflow_run',
        ownerId,
        createdBy: 'system',
        ticket: { source: 'workflow' },
      },
    );
  }

  it('claims the ticket (→ admitted) and inserts the session when front-of-queue', async () => {
    const t = convexTest(schema, modules);
    await poll(t, 'owner_a'); // park a waiting ticket
    const rowId = await reserve(t, 'owner_a');
    expect(rowId).toBeTruthy();
    const tickets = await ticketsForOwner(t, 'owner_a');
    expect(tickets[0]?.status).toBe('admitted');
    const sessions = await t.run((ctx) =>
      ctx.db
        .query('sandboxSessions')
        .withIndex('by_organizationId_and_status', (q) =>
          q.eq('organizationId', ORG).eq('status', 'creating'),
        )
        .collect(),
    );
    expect(sessions).toHaveLength(1);
  });

  it('throws WAIT_FIFO (not QUOTA_EXCEEDED) when the org is full', async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < SESSION_CAP; i++) {
      await seedActiveSession(t, `holder_${i}`);
    }
    await poll(t, 'owner_a');
    await expect(reserve(t, 'owner_a')).rejects.toThrow(
      // AppError message carries the WAIT_FIFO copy.
      /waiting|slot open yet/i,
    );
    // The waiter's ticket stays WAITING (never claimed) so it keeps its place.
    const tickets = await ticketsForOwner(t, 'owner_a');
    expect(tickets[0]?.status).toBe('waiting');
  });
});

describe('isWaitFifoError (the park-vs-fail discriminator)', () => {
  // The reserve mutations raise a AppError({ code: WAIT_FIFO }); callers use
  // this predicate to PARK (re-enter) rather than fail. (convex-test drops
  // AppError.data across a t.mutation rejection, so this exercises the
  // detector directly — the same .data.code mechanism the QUOTA_EXCEEDED path
  // already relies on in production.)
  it('matches a WAIT_FIFO AppError and nothing else', () => {
    expect(isWaitFifoError(new AppError({ code: WAIT_FIFO_CODE }))).toBe(true);
    expect(isWaitFifoError(new AppError({ code: 'QUOTA_EXCEEDED' }))).toBe(
      false,
    );
    expect(isWaitFifoError(new AppError('plain string'))).toBe(false);
    expect(isWaitFifoError(new Error('boom'))).toBe(false);
    expect(isWaitFifoError(undefined)).toBe(false);
  });
});

describe('recoverStuckAdmissionTickets (reaper)', () => {
  it('reaps a chat ticket whose poll-chain died (stale), spares a fresh one', async () => {
    const t = convexTest(schema, modules);
    const stale = Date.now() - (SANDBOX_ADMISSION_TICKET_STALE_MS + 5_000);
    await seedWaitingTicket(t, 'chat_dead', 1_000, stale, 'chat');
    await seedWaitingTicket(t, 'chat_live', 2_000, Date.now(), 'chat');

    const reaped = await t.mutation(
      internal.sandbox.admission.recoverStuckAdmissionTickets,
      {},
    );
    expect(reaped).toHaveLength(1);
    expect(await ticketsForOwner(t, 'chat_dead')).toHaveLength(0);
    expect(await ticketsForOwner(t, 'chat_live')).toHaveLength(1);
  });

  // The crux of the cron-free design: a parked WORKFLOW step blocks on awaitEvent
  // and never re-stamps `lastSeenAt`, so staleness is meaningless for it. The
  // reaper must SPARE it while its execution runs (no heartbeat needed — this is
  // what lets the reconcile cron go away) and reap it only once the owning
  // execution is terminal or gone.
  it('reaps a workflow ticket only when its execution is terminal/missing', async () => {
    const t = convexTest(schema, modules);
    // All three are "stale" (no heartbeat ever refreshes a workflow ticket), so
    // all are scanned — the EXECUTION state alone decides the reap.
    const stale = Date.now() - (SANDBOX_ADMISSION_TICKET_STALE_MS + 5_000);
    const running = await seedOwnerExec(t, 'running');
    const finished = await seedOwnerExec(t, 'failed');
    await seedWaitingTicket(t, 'wf_running', 1_000, stale, 'workflow', running);
    await seedWaitingTicket(
      t,
      'wf_terminal',
      2_000,
      stale,
      'workflow',
      finished,
    );
    // No wfExecutionId → owner is gone → reap.
    await seedWaitingTicket(t, 'wf_orphan', 3_000, stale, 'workflow');

    const reaped = await t.mutation(
      internal.sandbox.admission.recoverStuckAdmissionTickets,
      {},
    );
    expect(reaped).toHaveLength(2);
    expect(await ticketsForOwner(t, 'wf_running')).toHaveLength(1);
    expect(await ticketsForOwner(t, 'wf_terminal')).toHaveLength(0);
    expect(await ticketsForOwner(t, 'wf_orphan')).toHaveLength(0);
  });

  // Backstop liveness: a parked workflow waiter whose execution is still running
  // is SPARED, but its (kind, org) must be nudged so an open slot left idle by a
  // lost release/arrival wake can't strand it forever — this is what closes the
  // "frozen queue, no new arrivals" deadlock without a heavyweight reconcile cron.
  it('spares both live parked workflow waiters and schedules no nudge — the wake is offline', async () => {
    const t = convexTest(schema, modules);
    const stale = Date.now() - (SANDBOX_ADMISSION_TICKET_STALE_MS + 5_000);
    const running = await seedOwnerExec(t, 'running');
    // Two live parked waiters in the same (kind, org) — both are still spared
    // by the execution-terminal check regardless of the (now-offline) nudge.
    await seedWaitingTicket(t, 'wf_live_a', 1_000, stale, 'workflow', running);
    await seedWaitingTicket(t, 'wf_live_b', 2_000, stale, 'workflow', running);

    const reaped = await t.mutation(
      internal.sandbox.admission.recoverStuckAdmissionTickets,
      {},
    );
    expect(reaped).toHaveLength(0); // both spared (execution running)
    expect(await ticketsForOwner(t, 'wf_live_a')).toHaveLength(1);
    expect(await ticketsForOwner(t, 'wf_live_b')).toHaveLength(1);
    expect(await scheduledWakes(t)).toHaveLength(0);
  });
});

describe('dropAdmissionTicketsForExecution (terminal-edge ticket drop)', () => {
  // A step parked on awaitEvent that is CANCELLED never runs its own per-step
  // deleteAdmissionTicket, so handleWorkflowComplete clears the execution's
  // tickets on the terminal edge — WITHOUT waiting for the staleness reaper,
  // which would SPARE these fresh tickets (cancel → status 'failed', but the
  // reaper only scans lastSeenAt < cutoff). This is what stops a cancelled
  // parked run from wedging the org's FIFO head for a whole stale window.
  it('drops a FRESH ticket for the terminal execution but schedules no wake — the wake is offline', async () => {
    const t = convexTest(schema, modules);
    const cancelled = await seedOwnerExec(t, 'failed'); // cancel → status failed
    const stillRunning = await seedOwnerExec(t, 'running');
    // Both tickets are FRESH (lastSeenAt = now) — the staleness reaper would not
    // even scan them; only the terminal-edge drop reaches the dead one.
    await seedWaitingTicket(
      t,
      'wf_cancelled',
      1_000,
      Date.now(),
      'workflow',
      cancelled,
    );
    await seedWaitingTicket(
      t,
      'wf_behind',
      2_000,
      Date.now(),
      'workflow',
      stillRunning,
    );

    await t.mutation(
      internal.sandbox.admission.dropAdmissionTicketsForExecution,
      { organizationId: ORG, wfExecutionId: cancelled },
    );

    expect(await ticketsForOwner(t, 'wf_cancelled')).toHaveLength(0);
    expect(await ticketsForOwner(t, 'wf_behind')).toHaveLength(1);
    // The wake that used to nudge the live waiter behind the dropped head
    // targeted workflow-engine waiters, offline while that engine is rebuilt.
    expect(await scheduledWakes(t)).toHaveLength(0);
  });

  it('is a no-op when the execution holds no tickets (no delete, no wake)', async () => {
    const t = convexTest(schema, modules);
    const other = await seedOwnerExec(t, 'running');
    await seedWaitingTicket(
      t,
      'wf_other',
      1_000,
      Date.now(),
      'workflow',
      other,
    );

    await t.mutation(
      internal.sandbox.admission.dropAdmissionTicketsForExecution,
      { organizationId: ORG, wfExecutionId: 'exec_with_no_tickets' },
    );

    expect(await ticketsForOwner(t, 'wf_other')).toHaveLength(1);
    expect(await scheduledWakes(t)).toHaveLength(0);
  });
});
