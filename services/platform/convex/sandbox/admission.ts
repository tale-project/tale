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
// concurrency cap. Only the `sandboxSessions` / `sandboxExecutions` row it
// eventually inserts does. This is why a parked request burns no agent
// wall-clock budget while it waits.

import { ConvexError, v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import { internalMutation, type MutationCtx } from '../_generated/server';
import { readSandboxQuotaPolicy } from './quota_policy';
import {
  SANDBOX_ADMISSION_TICKET_STALE_MS,
  SANDBOX_WORKFLOW_ADMISSION_TICKET_STALE_MS,
} from './sessions_schema';

export type AdmissionKind = 'session' | 'oneshot';

/** ConvexError code thrown by the reserve mutations when a parking caller is not
 * yet at the front of its org's FIFO queue. The caller re-parks (sleeps + polls
 * again) instead of failing — distinct from `QUOTA_EXCEEDED` (a hard policy stop
 * like the daily CPU budget, which never parks). */
export const WAIT_FIFO_CODE = 'WAIT_FIFO';

export const admissionKindValidator = v.union(
  v.literal('session'),
  v.literal('oneshot'),
);

/** True if a thrown error is the FIFO "wait, don't fail" signal a reserve
 * mutation raises (a ConvexError whose data.code is WAIT_FIFO, preserved across
 * the runMutation/runAction boundary). Distinct from QUOTA_EXCEEDED (a hard
 * policy stop like the daily CPU budget, which never parks). */
export function isWaitFifoError(e: unknown): boolean {
  if (!(e instanceof ConvexError)) return false;
  if (typeof e.data !== 'object' || e.data === null) return false;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ConvexError data shape is loose
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

/** Like `reserveTicketArg` but carries the owner identity — the one-shot
 * `reserveSlotAndInsert` keys executions by thread/message, not by an owner, so
 * a parking script step must supply the (ownerType, ownerId) the ticket is keyed
 * on (the workflow-run step). */
export const reserveOneshotTicketArg = v.object({
  ownerType: v.string(),
  ownerId: v.string(),
  source: v.union(v.literal('chat'), v.literal('workflow')),
  threadId: v.optional(v.string()),
  wfExecutionId: v.optional(v.string()),
  stepSlug: v.optional(v.string()),
});

// --- shared helpers (imported by the reserve mutations) --------------------

/** Count of in-flight rows that hold a slot for this (org, kind). Mirrors the
 * cap-count loops in the reserve mutations EXACTLY so the queue math agrees with
 * the gate it fronts. */
export async function admissionInFlight(
  ctx: MutationCtx,
  organizationId: string,
  kind: AdmissionKind,
): Promise<number> {
  let inFlight = 0;
  if (kind === 'session') {
    for (const status of ['creating', 'active'] as const) {
      for await (const _row of ctx.db
        .query('sandboxSessions')
        .withIndex('by_organizationId_and_status', (q) =>
          q.eq('organizationId', organizationId).eq('status', status),
        )) {
        inFlight += 1;
      }
    }
  } else {
    for (const status of ['running', 'queued', 'installing'] as const) {
      for await (const _row of ctx.db
        .query('sandboxExecutions')
        .withIndex('by_organizationId_and_status', (q) =>
          q.eq('organizationId', organizationId).eq('status', status),
        )) {
        inFlight += 1;
      }
    }
  }
  return inFlight;
}

/** Per-org concurrency cap for a kind, from the `sandbox_quota` governance
 * policy (missing row → schema default). */
export async function admissionCap(
  ctx: MutationCtx,
  organizationId: string,
  kind: AdmissionKind,
): Promise<number> {
  const policy = await readSandboxQuotaPolicy(ctx.db, organizationId);
  return kind === 'session'
    ? policy.maxSessionsPerOrg
    : policy.maxConcurrentPerOrg;
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
): Promise<number> {
  let rank = 0;
  for await (const _t of ctx.db
    .query('sandboxAdmissionTickets')
    .withIndex('by_org_kind_status_createdAt', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('kind', kind)
        .eq('status', 'waiting')
        .lt('createdAt', createdAt),
    )) {
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
): Promise<void> {
  const cap = await admissionCap(ctx, organizationId, kind);
  const inFlight = await admissionInFlight(ctx, organizationId, kind);
  const slotsOpen = cap - inFlight;
  if (slotsOpen <= 0) {
    throw new ConvexError({
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
  );
  if (rank >= slotsOpen) {
    throw new ConvexError({
      code: WAIT_FIFO_CODE,
      message: 'Waiting for an earlier sandbox request to start.',
    });
  }
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
    const cap = await admissionCap(ctx, args.organizationId, args.kind);
    const inFlight = await admissionInFlight(
      ctx,
      args.organizationId,
      args.kind,
    );
    const slotsOpen = cap - inFlight;
    if (slotsOpen <= 0) return { verdict: 'wait' as const, ticketCreatedAt };
    const rank = await admissionRank(
      ctx,
      args.organizationId,
      args.kind,
      ticketCreatedAt,
      slotsOpen,
    );
    return {
      verdict: rank < slotsOpen ? ('admit' as const) : ('wait' as const),
      ticketCreatedAt,
    };
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

/** Reaper (2-min cron, sibling of `recoverStuckSessions`). Deletes tickets whose
 * `lastSeenAt` went stale: a WAITING ticket whose liveness signal stopped (the
 * workflow step / chat turn that owned it is gone) would otherwise wedge the
 * org's FIFO head forever — and under indefinite-wait this staleness sweep is the
 * ONLY guard against permanent queue-head starvation. Stale ADMITTED tickets are
 * orphans whose claimer died after the claim (their slot row is reclaimed by
 * `recoverStuckSessions` / the exec watchdog); drop them too.
 *
 * Two staleness windows, because the two ticket sources refresh `lastSeenAt`
 * differently: a `chat` ticket self-polls (fast 30s window); a `workflow` ticket
 * is event-driven and refreshed only by the minutely reconcile heartbeat, so it
 * needs a window WIDER than that cron interval — reaping a live parked workflow
 * ticket between heartbeats makes its `awaitEvent` step unwakeable forever. The
 * index range scans on the shorter (chat) cutoff; workflow rows not yet past the
 * wider cutoff are skipped. */
export const recoverStuckAdmissionTickets = internalMutation({
  args: { limit: v.optional(v.number()) },
  returns: v.array(v.id('sandboxAdmissionTickets')),
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = args.limit ?? 100;
    const chatCutoff = now - SANDBOX_ADMISSION_TICKET_STALE_MS;
    const workflowCutoff = now - SANDBOX_WORKFLOW_ADMISSION_TICKET_STALE_MS;
    const reaped: Id<'sandboxAdmissionTickets'>[] = [];
    for (const status of ['waiting', 'admitted'] as const) {
      for await (const t of ctx.db
        .query('sandboxAdmissionTickets')
        .withIndex('by_status_lastSeen', (q) =>
          q.eq('status', status).lt('lastSeenAt', chatCutoff),
        )) {
        // Event-driven workflow tickets live on the wider, heartbeat-sized
        // window — don't reap one that's merely older than the chat cutoff.
        if (t.source === 'workflow' && t.lastSeenAt >= workflowCutoff) continue;
        await ctx.db.delete(t._id);
        reaped.push(t._id);
        if (reaped.length >= limit) return reaped;
      }
    }
    return reaped;
  },
});
