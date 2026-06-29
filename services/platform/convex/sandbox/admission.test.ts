// Park-on-capacity admission queue — FIFO verdict math, ticket idempotency,
// the atomic reserve+claim (WAIT_FIFO when not front-of-queue), and the
// staleness reaper. convexTest (real in-memory DB) because the hazard is index
// iteration order + cross-row counting, exactly what a hand-rolled mock fakes
// away.

import { convexTest, type TestConvex } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import schema from '../schema';
import { isWaitFifoError, WAIT_FIFO_CODE } from './admission';
import { DEFAULT_SANDBOX_QUOTA } from './quota_policy';
import {
  SANDBOX_ADMISSION_TICKET_STALE_MS,
  SANDBOX_WORKFLOW_ADMISSION_TICKET_STALE_MS,
} from './sessions_schema';

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
const SESSION_CAP = DEFAULT_SANDBOX_QUOTA.maxSessionsPerOrg; // 2

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
    // One active session → slotsOpen = cap - 1 = 1.
    await seedActiveSession(t, 'holder');
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
      // ConvexError message carries the WAIT_FIFO copy.
      /waiting|slot open yet/i,
    );
    // The waiter's ticket stays WAITING (never claimed) so it keeps its place.
    const tickets = await ticketsForOwner(t, 'owner_a');
    expect(tickets[0]?.status).toBe('waiting');
  });
});

describe('isWaitFifoError (the park-vs-fail discriminator)', () => {
  // The reserve mutations raise a ConvexError({ code: WAIT_FIFO }); callers use
  // this predicate to PARK (re-enter) rather than fail. (convex-test drops
  // ConvexError.data across a t.mutation rejection, so this exercises the
  // detector directly — the same .data.code mechanism the QUOTA_EXCEEDED path
  // already relies on in production.)
  it('matches a WAIT_FIFO ConvexError and nothing else', () => {
    expect(isWaitFifoError(new ConvexError({ code: WAIT_FIFO_CODE }))).toBe(
      true,
    );
    expect(isWaitFifoError(new ConvexError({ code: 'QUOTA_EXCEEDED' }))).toBe(
      false,
    );
    expect(isWaitFifoError(new ConvexError('plain string'))).toBe(false);
    expect(isWaitFifoError(new Error('boom'))).toBe(false);
    expect(isWaitFifoError(undefined)).toBe(false);
  });
});

describe('recoverStuckAdmissionTickets (reaper)', () => {
  it('deletes stale waiting tickets and spares fresh ones', async () => {
    const t = convexTest(schema, modules);
    // A workflow ticket is only stale past the WIDER heartbeat-sized window.
    const stale =
      Date.now() - (SANDBOX_WORKFLOW_ADMISSION_TICKET_STALE_MS + 5_000);
    await seedWaitingTicket(t, 'owner_dead', 1_000, stale);
    await seedWaitingTicket(t, 'owner_live', 2_000, Date.now());

    const reaped = await t.mutation(
      internal.sandbox.admission.recoverStuckAdmissionTickets,
      {},
    );
    expect(reaped).toHaveLength(1);
    expect(await ticketsForOwner(t, 'owner_dead')).toHaveLength(0);
    expect(await ticketsForOwner(t, 'owner_live')).toHaveLength(1);
  });

  // Regression gate: the event-driven park bug. A parked workflow ticket is
  // refreshed only by the minutely reconcile heartbeat (the step itself no
  // longer polls), so its staleness window MUST exceed that 60s interval —
  // otherwise the reaper deletes a live parked ticket between heartbeats and the
  // `awaitEvent` step becomes unwakeable, wedging the org's capacity queue.
  it('spares a workflow ticket past the chat window but keeps the longer one', async () => {
    const t = convexTest(schema, modules);
    // Stale by the chat window (30s) but NOT the workflow window (180s): a live
    // parked step between heartbeats. Must survive.
    const betweenHeartbeats =
      Date.now() - (SANDBOX_ADMISSION_TICKET_STALE_MS + 5_000);
    await seedWaitingTicket(
      t,
      'wf_parked',
      1_000,
      betweenHeartbeats,
      'workflow',
    );
    // A chat waiter at the same age self-polls, so this age means its poll-chain
    // died → reap it on the short window.
    await seedWaitingTicket(t, 'chat_dead', 2_000, betweenHeartbeats, 'chat');
    // A workflow ticket past the wider window IS dead → reap it.
    const pastWorkflowWindow =
      Date.now() - (SANDBOX_WORKFLOW_ADMISSION_TICKET_STALE_MS + 5_000);
    await seedWaitingTicket(
      t,
      'wf_dead',
      3_000,
      pastWorkflowWindow,
      'workflow',
    );

    const reaped = await t.mutation(
      internal.sandbox.admission.recoverStuckAdmissionTickets,
      {},
    );
    expect(reaped).toHaveLength(2);
    expect(await ticketsForOwner(t, 'wf_parked')).toHaveLength(1);
    expect(await ticketsForOwner(t, 'chat_dead')).toHaveLength(0);
    expect(await ticketsForOwner(t, 'wf_dead')).toHaveLength(0);
  });
});
