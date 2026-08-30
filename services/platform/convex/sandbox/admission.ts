// Park-on-capacity admission queue for sandbox requests.
//
// When a sandbox request hits a per-org concurrency cap it can WAIT instead of
// fail: it parks a `sandboxAdmissionTickets` row and re-polls until it is among
// the front `slotsOpen` oldest WAITING tickets for its (org, kind), then claims
// the freed slot. This module owns the ticket lifecycle + the FIFO math; the
// actual slot RESERVATION (and the same-txn claim) lives in
// `reserveSessionSlotAndInsert` / `reserveSlotAndInsert`, which import the
// helpers below so count + rank + claim + insert is ONE serializable
// transaction (no window where a slot is held but the ticket still says
// `waiting`, which would let a second waiter mis-rank).
//
// A `waiting` ticket is NOT a slot: it holds zero compute and counts toward no
// concurrency cap. Only the `sandboxSessions` row it eventually inserts does.
// This is why a parked request burns no agent wall-clock budget while it waits.

import { v } from 'convex/values';

import { AppError } from '../../lib/shared/errors/app-error';
import type { Doc, Id } from '../_generated/dataModel';
import { internalMutation, type MutationCtx } from '../_generated/server';
import { isE2ECronSuppressed } from '../lib/e2e_cron_guard';
import {
  readSandboxQuotaPolicy,
  requireSessionBudgetForOwnerType,
  type SessionBudget,
  sessionBudgetForOwnerType,
  sessionCapFor,
} from './quota_policy';
import { SANDBOX_ADMISSION_TICKET_STALE_MS } from './sessions_schema';

// Every sandbox run is a session now (chat run_code, external agents, both
// workflow agent AND script steps, and crawler renders). `kind` is retained as a
// single-value discriminator so the tickets FIFO index + capacity-wake plumbing
// stay put; the retired 'oneshot' value is gone.
export type AdmissionKind = 'session';

/** AppError code thrown by the reserve mutations when a parking caller is not
 * yet at the front of its org's FIFO queue. The caller re-parks (sleeps + polls
 * again) instead of failing — distinct from `QUOTA_EXCEEDED` (a hard policy stop
 * like the daily CPU budget, which never parks). */
export const WAIT_FIFO_CODE = 'WAIT_FIFO';

export const admissionKindValidator = v.literal('session');

/** True if a thrown error is the FIFO "wait, don't fail" signal a reserve
 * mutation raises (a AppError whose data.code is WAIT_FIFO, preserved across
 * the runMutation/runAction boundary). Distinct from QUOTA_EXCEEDED (a hard
 * policy stop like the daily CPU budget, which never parks). */
export function isWaitFifoError(e: unknown): boolean {
  if (!(e instanceof AppError)) return false;
  if (typeof e.data !== 'object' || e.data === null) return false;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- AppError data shape is loose
  return (e.data as { code?: string }).code === WAIT_FIFO_CODE;
}

/** The owner-identity + provenance an admission ticket carries. Shared by the
 * poll/park mutations and threaded into the reserve mutations' optional `ticket`
 * arg. */
export const admissionTicketArgs = {
  organizationId: v.string(),
  kind: admissionKindValidator,
  ownerType: v.string(),
  ownerId: v.string(),
  source: v.union(v.literal('chat'), v.literal('workflow')),
  threadId: v.optional(v.string()),
  wfExecutionId: v.optional(v.string()),
  stepSlug: v.optional(v.string()),
} as const;

export interface AdmissionTicketArgs {
  organizationId: string;
  kind: AdmissionKind;
  ownerType: string;
  ownerId: string;
  source: 'chat' | 'workflow';
  threadId?: string;
  wfExecutionId?: string;
  stepSlug?: string;
}

/** The optional `ticket` arg `reserveSessionSlotAndInsert` accepts to opt into
 * PARKING mode. Org/owner/kind already live on the reserve; presence flips the
 * per-org cap from a hard `QUOTA_EXCEEDED` throw into the FIFO `WAIT_FIFO` gate. */
export const reserveTicketArg = v.object({
  source: v.union(v.literal('chat'), v.literal('workflow')),
  threadId: v.optional(v.string()),
  wfExecutionId: v.optional(v.string()),
  stepSlug: v.optional(v.string()),
});

// --- shared helpers (imported by the reserve mutations) --------------------

/** Count of in-flight sessions that hold a slot for this org (scoped to one
 * `sessionBudget` when given). Mirrors the cap-count loop in the reserve mutation
 * EXACTLY so the queue math agrees with the gate it fronts. */
export async function admissionInFlight(
  ctx: MutationCtx,
  organizationId: string,
  sessionBudget?: SessionBudget,
): Promise<number> {
  let inFlight = 0;
  for (const status of ['creating', 'active'] as const) {
    for await (const row of ctx.db
      .query('sandboxSessions')
      .withIndex('by_organizationId_and_status', (q) =>
        q.eq('organizationId', organizationId).eq('status', status),
      )) {
      // Count only this budget's sessions when scoped (the workloads are
      // limited separately).
      if (
        sessionBudget !== undefined &&
        sessionBudgetForOwnerType(row.ownerType) !== sessionBudget
      ) {
        continue;
      }
      inFlight += 1;
    }
  }
  return inFlight;
}

/** Per-org session cap for a `sessionBudget`, from the `sandbox_quota`
 * governance policy (missing row → schema default). */
export async function admissionCap(
  ctx: MutationCtx,
  organizationId: string,
  sessionBudget?: SessionBudget,
): Promise<number> {
  const policy = await readSandboxQuotaPolicy(ctx.db, organizationId);
  return sessionBudget !== undefined
    ? sessionCapFor(sessionBudget, policy)
    : policy.maxSessionsPerOrg;
}

/** FIFO rank: number of WAITING tickets for this (org, kind) created strictly
 * before `createdAt`. Short-circuits at `ceiling` — we only care whether the
 * rank is below `slotsOpen`. Ties on `createdAt` (ms collision) compute the same
 * rank and are made safe by the OCC recount in the reserve insert: the second
 * claimer sees the first's freshly-inserted slot row and throws WAIT_FIFO. */
export async function admissionRank(
  ctx: MutationCtx,
  organizationId: string,
  kind: AdmissionKind,
  createdAt: number,
  ceiling: number,
  sessionBudget?: SessionBudget,
): Promise<number> {
  let rank = 0;
  for await (const t of ctx.db
    .query('sandboxAdmissionTickets')
    .withIndex('by_org_kind_status_createdAt', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('kind', kind)
        .eq('status', 'waiting')
        .lt('createdAt', createdAt),
    )) {
    // Rank only against same-budget waiters (the three workloads queue apart).
    if (
      sessionBudget !== undefined &&
      sessionBudgetForOwnerType(t.ownerType) !== sessionBudget
    ) {
      continue;
    }
    rank += 1;
    if (rank >= ceiling) break;
  }
  return rank;
}

async function findTicket(
  ctx: MutationCtx,
  ownerType: string,
  ownerId: string,
): Promise<Doc<'sandboxAdmissionTickets'> | null> {
  return ctx.db
    .query('sandboxAdmissionTickets')
    .withIndex('by_owner', (q) =>
      q.eq('ownerType', ownerType).eq('ownerId', ownerId),
    )
    .first();
}

/** Create the owner's WAITING ticket if absent; otherwise refresh its liveness
 * heartbeat (`lastSeenAt`). Returns the FIFO `createdAt`, which is stable across
 * re-polls — never re-stamped (that would forfeit the waiter's queue position).
 * Never resurrects an `admitted` ticket to `waiting` (use `parkAdmissionTicket`
 * for the 429-after-claim case). */
export async function upsertWaitingTicket(
  ctx: MutationCtx,
  args: AdmissionTicketArgs,
  now: number,
  /** FIFO ordering key for a NEW ticket. Defaults to `now`; the workflow path
   * passes the WORKFLOW's start time (priority inheritance — see
   * `resolveTicketCreatedAt`) so all of a workflow's sandbox steps share one
   * arrival priority and an in-progress workflow finishes before a newer one
   * starts. Ignored when the ticket already exists (its key is never restamped —
   * a waiter never loses its place). */
  createdAtForNew?: number,
): Promise<number> {
  const existing = await findTicket(ctx, args.ownerType, args.ownerId);
  if (existing) {
    await ctx.db.patch(existing._id, { lastSeenAt: now });
    return existing.createdAt;
  }
  const createdAt = createdAtForNew ?? now;
  await ctx.db.insert('sandboxAdmissionTickets', {
    organizationId: args.organizationId,
    kind: args.kind,
    ownerType: args.ownerType,
    ownerId: args.ownerId,
    source: args.source,
    ...(args.threadId !== undefined && { threadId: args.threadId }),
    ...(args.wfExecutionId !== undefined && {
      wfExecutionId: args.wfExecutionId,
    }),
    ...(args.stepSlug !== undefined && { stepSlug: args.stepSlug }),
    status: 'waiting',
    createdAt,
    lastSeenAt: now,
  });
  return createdAt;
}

/** Priority inheritance: a WORKFLOW ticket's FIFO key is the workflow's START
 * time (not the step's park time), so every sandbox step of one workflow shares
 * its arrival priority and the workflow runs to completion before a later one
 * starts. Chat (and any non-workflow waiter) keeps its park-time priority. Falls
 * back to `now` if the execution can't be read. */
async function resolveTicketCreatedAt(
  ctx: MutationCtx,
  args: AdmissionTicketArgs,
  now: number,
): Promise<number> {
  if (args.source !== 'workflow' || !args.wfExecutionId) return now;
  const execId = ctx.db.normalizeId('wfExecutions', args.wfExecutionId);
  if (!execId) return now;
  const execution = await ctx.db.get(execId);
  return execution?.startedAt ?? now;
}

/** Flip the owner's ticket to `admitted` — called INSIDE the reserve mutation,
 * the SAME txn as the slot insert. No-op if the ticket was reaped between poll
 * and reserve (the slot insert still proceeds; the ticket is advisory FIFO). */
export async function claimTicket(
  ctx: MutationCtx,
  ownerType: string,
  ownerId: string,
  now: number,
): Promise<void> {
  const existing = await findTicket(ctx, ownerType, ownerId);
  if (existing && existing.status !== 'admitted') {
    await ctx.db.patch(existing._id, { status: 'admitted', lastSeenAt: now });
  }
}

/** Authoritative FIFO gate, called INSIDE the reserve mutations right before the
 * slot insert. Throws WAIT_FIFO if this waiter (identified by its ticket's
 * `createdAt`) is not yet at the front of an open slot for its (org, kind). On
 * return the caller is cleared to `claimTicket` + insert in the same txn. */
export async function assertFifoEligible(
  ctx: MutationCtx,
  organizationId: string,
  kind: AdmissionKind,
  ticketCreatedAt: number,
  sessionBudget?: SessionBudget,
): Promise<void> {
  const cap = await admissionCap(ctx, organizationId, sessionBudget);
  const inFlight = await admissionInFlight(ctx, organizationId, sessionBudget);
  const slotsOpen = cap - inFlight;
  if (slotsOpen <= 0) {
    throw new AppError({
      code: WAIT_FIFO_CODE,
      message: 'No sandbox slot open yet; waiting.',
    });
  }
  const rank = await admissionRank(
    ctx,
    organizationId,
    kind,
    ticketCreatedAt,
    slotsOpen,
    sessionBudget,
  );
  if (rank >= slotsOpen) {
    throw new AppError({
      code: WAIT_FIFO_CODE,
      message: 'Waiting for an earlier sandbox request to start.',
    });
  }
}

/** Best-effort capacity wake scheduled (never inline) from the admission gate
 * itself — the ARRIVAL/REAP-edge twin of the slot-release wakes in
 * `session_mutations`/`internal_mutations`. A fresh waiter that parks while a
 * slot is OPEN, and a reaper pass that frees a wedged FIFO head, both kick the
 * open slots here so the queue can never freeze waiting on a release event that
 * never arrives. Routed via the scheduler ref (not a value import) so sandbox/*
 * never imports workflow_engine/engine (no import cycle). `wakeHeadWaiters`
 * self-gates — it no-ops when no slot is open and skips dead/terminal heads — so
 * an over-eager nudge is cheap. No-op on empty org / non-positive count. */
async function scheduleCapacityWake(
  ctx: MutationCtx,
  organizationId: string,
  kind: AdmissionKind,
  count: number,
): Promise<void> {
  if (!organizationId || count <= 0) return;
  // The head-waiter wake targeted workflow-engine waiters parked on
  // sandbox capacity. That engine is offline while it is rebuilt and no
  // workflow waiters exist, so there is nothing to wake; chat-side
  // admission below relies on its own release path plus the reaper cron.
  console.debug(
    `[sandbox] capacity wake skipped (org ${organizationId}, kind ${kind}, count ${count}) — no workflow waiters while the automation engine is rebuilt`,
  );
}

// --- mutations -------------------------------------------------------------

/** Early admission gate + liveness heartbeat for a parking caller. Upserts the
 * owner's WAITING ticket (re-stamping `lastSeenAt`) and returns whether it may
 * proceed to reserve. The reserve mutation re-checks atomically — this poll is
 * the cheap front gate that lets a still-full re-poll skip the expensive setup
 * (env resolution, session create) entirely. */
export const pollAdmission = internalMutation({
  args: admissionTicketArgs,
  returns: v.object({
    verdict: v.union(v.literal('admit'), v.literal('wait')),
    ticketCreatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    // Priority inheritance: a workflow's tickets are keyed on the workflow START
    // time so the whole workflow finishes before a later one starts.
    const createdAtForNew = await resolveTicketCreatedAt(ctx, args, now);
    const ticketCreatedAt = await upsertWaitingTicket(
      ctx,
      args,
      now,
      createdAtForNew,
    );
    // Sessions are budgeted per workload (project / workflow / render); a new
    // waiter must belong to a live lane.
    const sessionBudget = requireSessionBudgetForOwnerType(args.ownerType);
    const cap = await admissionCap(ctx, args.organizationId, sessionBudget);
    const inFlight = await admissionInFlight(
      ctx,
      args.organizationId,
      sessionBudget,
    );
    const slotsOpen = cap - inFlight;
    if (slotsOpen <= 0) return { verdict: 'wait' as const, ticketCreatedAt };
    const rank = await admissionRank(
      ctx,
      args.organizationId,
      args.kind,
      ticketCreatedAt,
      slotsOpen,
      sessionBudget,
    );
    if (rank < slotsOpen) return { verdict: 'admit' as const, ticketCreatedAt };
    // Parking with slots OPEN means an earlier waiter SHOULD already be running
    // but isn't — its release-wake was lost, or its FIFO head is wedged. Self-
    // heal on this ARRIVAL edge: kick the open slots so the queue can never
    // freeze with capacity sitting idle behind a parked head. This is the event-
    // driven twin of the slot-release wakes; it's what frees a parked step from
    // depending on a single release event that may never come (the awaitEvent it
    // blocks on has no timeout).
    await scheduleCapacityWake(ctx, args.organizationId, args.kind, slotsOpen);
    return { verdict: 'wait' as const, ticketCreatedAt };
  },
});

/** Return an admitted ticket to `waiting` (keeping its FIFO `createdAt`) after a
 * GLOBAL spawner 429 occurred POST-claim: the per-org slot was earned but the
 * host is at capacity, so release the slot row (caller's job) and re-queue here
 * to retry without losing position. Creates the ticket if absent. */
export const parkAdmissionTicket = internalMutation({
  args: admissionTicketArgs,
  returns: v.object({ ticketCreatedAt: v.number() }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await findTicket(ctx, args.ownerType, args.ownerId);
    if (existing) {
      await ctx.db.patch(existing._id, { status: 'waiting', lastSeenAt: now });
      return { ticketCreatedAt: existing.createdAt };
    }
    const createdAtForNew = await resolveTicketCreatedAt(ctx, args, now);
    const ticketCreatedAt = await upsertWaitingTicket(
      ctx,
      args,
      now,
      createdAtForNew,
    );
    return { ticketCreatedAt };
  },
});

/** Drop the owner's ticket — on proceed (run actually started), terminal fail,
 * or cancel. Idempotent. */
export const deleteAdmissionTicket = internalMutation({
  args: { ownerType: v.string(), ownerId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await findTicket(ctx, args.ownerType, args.ownerId);
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});

/** Drop ALL of an execution's admission tickets the instant it goes terminal —
 * the event-driven twin of the slot-release wake, scheduled by
 * `handleWorkflowComplete` beside the execution's session teardown. The per-step
 * `deleteAdmissionTicket` above only fires when a step actually RUNS; a step
 * parked on `awaitEvent` for capacity that is then CANCELLED (or an execution
 * that fails while a later step's ticket is still `waiting`) never reaches it, so
 * its ticket would linger until the staleness-gated reaper culls it — one stale
 * window + cron tick later, long enough to wedge the org's FIFO head behind a
 * dead ticket. Clearing it here on the terminal edge (and waking the live waiters
 * behind it) removes that latency; the reaper stays a pure backstop. Idempotent —
 * no matching tickets is a no-op. */
export const dropAdmissionTicketsForExecution = internalMutation({
  args: { organizationId: v.string(), wfExecutionId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!args.organizationId || !args.wfExecutionId) return null;
    let dropped = 0;
    // kind is the single 'session' discriminator; a waiter holds no slot, so the
    // scan is bounded by the org's (small, capped) queue depth, not table size.
    for (const status of ['waiting', 'admitted'] as const) {
      for await (const t of ctx.db
        .query('sandboxAdmissionTickets')
        .withIndex('by_org_kind_status_createdAt', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('kind', 'session')
            .eq('status', status),
        )) {
        if (t.source === 'workflow' && t.wfExecutionId === args.wfExecutionId) {
          await ctx.db.delete(t._id);
          dropped += 1;
        }
      }
    }
    // Deleting a dead FIFO head must let the live waiters behind it advance —
    // the wake self-caps at the open-slot count, so `dropped` is an upper bound.
    if (dropped > 0) {
      await scheduleCapacityWake(ctx, args.organizationId, 'session', dropped);
    }
    return null;
  },
});

/** Per-tick scan bound. Workflow tickets are no longer staleness-refreshed (they
 * have no heartbeat), so they ALL fall in the stale range and get walked every
 * run; cap the scan so one busy org can't blow the mutation's read budget —
 * leftovers are picked up on the next run. */
const ADMISSION_REAP_SCAN_LIMIT = 1_000;

/** Backstop nudge size: ask the wake to fill EVERY currently-open slot (it caps
 * internally at the live open-slot count and its own per-call ceiling, so this
 * is an upper bound, not a fan-out). The reaper is the last-resort liveness net
 * riding the EXISTING cron — not a new reconcile loop — so it asks for "all open
 * slots", not the single slot a release frees. */
const ADMISSION_BACKSTOP_WAKE_COUNT = 16;

/** A `workflow` ticket's owner is dead when its execution is gone or terminal —
 * the DURABLE signal that replaces the staleness timer for the event-driven
 * park. A parked step blocks on `awaitEvent` and never re-stamps `lastSeenAt`,
 * so a stale timestamp means "still waiting", not "dead"; only a terminal/missing
 * execution is a real death. This is what lets the per-tick reconcile heartbeat
 * cron go away: a parked-but-running step keeps its ticket with no refresh. */
async function workflowTicketOwnerIsDead(
  ctx: MutationCtx,
  ticket: Doc<'sandboxAdmissionTickets'>,
): Promise<boolean> {
  if (!ticket.wfExecutionId) return true;
  const execId = ctx.db.normalizeId('wfExecutions', ticket.wfExecutionId);
  if (!execId) return true;
  const execution = await ctx.db.get(execId);
  if (!execution) return true;
  return execution.status === 'completed' || execution.status === 'failed';
}

/** Reaper (2-min cron, sibling of `recoverStuckSessions`). Deletes tickets whose
 * owner is gone — otherwise a dead ticket wedges the org's FIFO head forever, and
 * under indefinite-wait this is the ONLY guard against permanent queue-head
 * starvation. The "owner is gone" signal differs BY SOURCE:
 *  - `chat`: self-polls every poll-backoff, so a `lastSeenAt` older than the
 *    staleness window means the poll-chain died → reap.
 *  - `workflow`: event-driven (blocks on `awaitEvent`, never re-polls), so
 *    staleness is meaningless — reap only when the owning EXECUTION is
 *    terminal/missing. This durable check is why there is no reconcile/heartbeat
 *    cron: a parked-but-running step keeps its ticket with no periodic refresh,
 *    and the event-driven slot-release wake resumes it directly.
 * The index range still scans on the staleness cutoff (workflow tickets all fall
 * in it, having no heartbeat); the per-source test decides the actual reap. */
export const recoverStuckAdmissionTickets = internalMutation({
  args: { limit: v.optional(v.number()) },
  returns: v.array(v.id('sandboxAdmissionTickets')),
  handler: async (ctx, args) => {
    if (isE2ECronSuppressed()) return [];
    const now = Date.now();
    const limit = args.limit ?? 100;
    const cutoff = now - SANDBOX_ADMISSION_TICKET_STALE_MS;
    const reaped: Id<'sandboxAdmissionTickets'>[] = [];
    // (kind, org) pairs to nudge once the scan finishes — deduped so one busy org
    // schedules at most one wake per kind. Two reasons to nudge:
    //  - REAP edge: deleting a dead FIFO head must let the live waiters behind it
    //    advance (the head was hogging the queue's attention, not a slot).
    //  - BACKSTOP: a LIVE parked workflow waiter whose org has an open slot but
    //    whose release/arrival wake was lost would otherwise sleep forever (its
    //    awaitEvent has no timeout). This is the last-resort liveness net, riding
    //    the EXISTING reaper cron rather than a new reconcile loop.
    // `wakeHeadWaiters` self-gates (no-op when no slot is open, skips dead heads),
    // so nudging every scanned org is cheap and usually a no-op.
    const toWake = new Map<
      string,
      { kind: AdmissionKind; organizationId: string }
    >();
    const remember = (kind: AdmissionKind, organizationId: string): void => {
      if (organizationId) {
        toWake.set(`${kind} ${organizationId}`, { kind, organizationId });
      }
    };
    let scanned = 0;
    let bound = false;
    for (const status of ['waiting', 'admitted'] as const) {
      if (bound) break;
      for await (const t of ctx.db
        .query('sandboxAdmissionTickets')
        .withIndex('by_status_lastSeen', (q) =>
          q.eq('status', status).lt('lastSeenAt', cutoff),
        )) {
        if (scanned >= ADMISSION_REAP_SCAN_LIMIT) {
          bound = true;
          break;
        }
        scanned += 1;
        // Workflow tickets reap on execution-terminal, not the staleness timer:
        // spare a still-running parked step (it just isn't self-polling) - but
        // remember its (kind, org) so the backstop nudge can still reach it.
        if (
          t.source === 'workflow' &&
          !(await workflowTicketOwnerIsDead(ctx, t))
        ) {
          if (status === 'waiting') remember('session', t.organizationId);
          continue;
        }
        await ctx.db.delete(t._id);
        reaped.push(t._id);
        remember('session', t.organizationId);
        if (reaped.length >= limit) {
          bound = true;
          break;
        }
      }
    }
    // Schedule the deduped nudges last so a wake failure can't abort the reap.
    for (const { kind, organizationId } of toWake.values()) {
      await scheduleCapacityWake(
        ctx,
        organizationId,
        kind,
        ADMISSION_BACKSTOP_WAKE_COUNT,
      );
    }
    return reaped;
  },
});
