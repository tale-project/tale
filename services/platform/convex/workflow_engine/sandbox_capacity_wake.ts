// Event-driven "capacity wake" for parked workflow sandbox steps.
//
// A workflow sandbox step that can't get a capacity slot returns
// `awaiting_capacity`; the durable handler then BLOCKS on
// `step.awaitEvent({ name: sandboxCapacityWakeEventName(...) })` instead of
// re-running the whole executeStep action on a backoff timer. This module sends
// that wake event so a parked step resumes the instant a slot frees:
//   - `wakeHeadWaiters` — fired (best-effort, scheduled) by the slot-release
//     mutations so admit is instant.
//   - `reconcileAdmissionWakes` — the cron backstop that (a) re-fires any wake
//     that was never delivered and (b) refreshes the liveness heartbeat the
//     workflow no longer writes per-poll (so the existing staleness reaper stays
//     valid for event-driven, non-polling tickets).
//
// It lives under workflow_engine/ (NOT sandbox/) on purpose: it imports the
// workflow component `workflowManagers` by value, and sandbox/* must not import
// workflow_engine/engine by value (that would create an import cycle). The
// slot-release mutations in sandbox/* reach this module only via the scheduler
// (`internal.workflow_engine.sandbox_capacity_wake.*`), never by value.

import type { WorkflowId } from '@convex-dev/workflow';
import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from '../_generated/server';
import {
  type AdmissionKind,
  admissionCap,
  admissionInFlight,
  admissionKindValidator,
} from '../sandbox/admission';
import { sandboxCapacityWakeEventName } from '../sandbox/sessions_schema';
import { workflowManagers } from './engine';
import { safeShardIndex } from './helpers/engine/shard';

/** Hard cap on wakes emitted per call, so a large `slotsOpen` (or a long FIFO
 * queue) can't turn one release / reconcile tick into an unbounded sendEvent
 * fan-out. A spurious extra wake is cheap (one reserve attempt that re-parks),
 * so this only needs to be "sane", not exact. */
const MAX_WAKES_PER_CALL = 16;

/**
 * Wake up to `count` FIFO-head WAITING workflow tickets for one (org, kind), but
 * never more than the slots currently open (no point waking a waiter that would
 * just re-park) and never more than `MAX_WAKES_PER_CALL`. Each `sendEvent` is
 * best-effort: a failure is logged and skipped so one dead workflow can't abort
 * the rest of the queue. Returns the number actually woken. Shared by
 * `wakeHeadWaiters` and `reconcileAdmissionWakes` — NOT an exported mutation.
 */
async function wakeHeadsForOrgKind(
  ctx: MutationCtx,
  organizationId: string,
  kind: AdmissionKind,
  count: number,
): Promise<number> {
  if (count <= 0) return 0;
  const cap = await admissionCap(ctx, organizationId, kind);
  const inFlight = await admissionInFlight(ctx, organizationId, kind);
  const slotsOpen = cap - inFlight;
  if (slotsOpen <= 0) return 0;
  const toWake = Math.min(count, slotsOpen, MAX_WAKES_PER_CALL);

  let woken = 0;
  for await (const ticket of ctx.db
    .query('sandboxAdmissionTickets')
    .withIndex('by_org_kind_status_createdAt', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('kind', kind)
        .eq('status', 'waiting'),
    )) {
    if (woken >= toWake) break;
    // Only workflow tickets are event-driven; chat waiters re-poll on their own.
    if (
      ticket.source !== 'workflow' ||
      !ticket.wfExecutionId ||
      !ticket.stepSlug
    ) {
      continue;
    }
    const execId = ctx.db.normalizeId('wfExecutions', ticket.wfExecutionId);
    if (!execId) continue;
    const execution = await ctx.db.get(execId);
    if (
      !execution ||
      !execution.componentWorkflowId ||
      execution.status === 'completed' ||
      execution.status === 'failed'
    ) {
      // Missing/terminal execution → no live awaitEvent to resume; let the
      // staleness reaper cull the ticket. Don't count it against `toWake`.
      continue;
    }
    try {
      await workflowManagers[safeShardIndex(execution.shardIndex)].sendEvent(
        ctx,
        {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- componentWorkflowId stored as string, WorkflowId is a branded type
          workflowId: execution.componentWorkflowId as unknown as WorkflowId,
          name: sandboxCapacityWakeEventName(
            ticket.wfExecutionId,
            ticket.stepSlug,
          ),
        },
      );
      woken += 1;
    } catch (err) {
      // Best-effort: one failed wake must not abort the rest of the queue. The
      // reconciler cron re-fires any wake that never landed.
      console.warn(
        `[sandbox.wake] sendEvent failed for execution ${ticket.wfExecutionId} step ${ticket.stepSlug}:`,
        err,
      );
    }
  }
  return woken;
}

/**
 * Instant wake of the FIFO-head waiter(s) for one (org, kind). Scheduled
 * best-effort by the slot-release mutations (`runAfter(0, ...)`) so a freed slot
 * resumes a parked step immediately rather than waiting for the reconciler tick.
 * Caps wakes at the open slots so a wake never outruns capacity. Returns the
 * number actually woken.
 */
export const wakeHeadWaiters = internalMutation({
  args: {
    organizationId: v.string(),
    kind: admissionKindValidator,
    count: v.number(),
  },
  returns: v.number(),
  handler: async (ctx, args) =>
    wakeHeadsForOrgKind(ctx, args.organizationId, args.kind, args.count),
});

/** Bound on the WAITING tickets scanned per reconcile tick, so one busy
 * deployment can't blow the mutation's read budget. Leftover heads are picked up
 * on the next tick. */
const RECONCILE_SCAN_LIMIT = 500;

/** Bound on running executions scanned by the recovery pass per tick. */
const RECOVERY_SCAN_LIMIT = 500;
/** Bound on ticketless parked executions re-woken per tick. One wake re-tickets
 * an execution (its re-entered step re-polls), so a backlog only needs chipping
 * down over a few ticks, not clearing in one. */
const MAX_RECOVERED_PARKS_PER_CALL = 16;

/**
 * RECOVERY backstop — drives off the DURABLE execution marker, not the ticket.
 *
 * The heartbeat + re-wake passes can only act on a parked step that still has a
 * `sandboxAdmissionTickets` row. But a step blocked on `step.awaitEvent(...)`
 * whose ticket was LOST — reaped in a reconcile gap longer than the staleness
 * window, or before that window was widened — is invisible to them and wedges
 * forever (the wake keys off the ticket; no ticket ⇒ no wake ⇒ no re-poll ⇒ no
 * new ticket). So recover from the durable signal instead: a `wfExecutions` row
 * still `running` with a non-empty `awaitingCapacityStepSlug`. For each such
 * execution lacking a live ticket, send the wake directly; the re-entered step
 * re-polls `pollAdmission`, which re-creates the ticket (correct kind, inherited
 * FIFO priority) and hands it back to the normal machinery — or re-parks if
 * still capped. Ticket-independent ⇒ self-heals any lost-ticket backlog.
 * Bounded + best-effort; skips executions that already have a ticket so a
 * healthy queue does no extra work.
 */
/** A parked execution the recovery pass should re-wake: still `running` with a
 * marker, and no live admission ticket. */
interface RecoveryTarget {
  executionId: Id<'wfExecutions'>;
  stepSlug: string;
  componentWorkflowId: string;
  shardIndex: number | undefined;
}

/**
 * SELECTION half of the recovery backstop (read-only, so it is unit-testable
 * against a real index without the workflow component): the parked executions
 * that have LOST their admission ticket. Scans `running` executions still
 * flagged `awaitingCapacityStepSlug` (via the dedicated index), skipping those
 * that still have a `workflow_run` ticket (owned by the heartbeat/re-wake passes)
 * and those missing a `componentWorkflowId` (never started — nothing to wake).
 * Returns at most `limit`, scanning at most `RECOVERY_SCAN_LIMIT`.
 */
async function collectTicketlessParkedExecutions(
  ctx: QueryCtx,
  limit: number,
): Promise<RecoveryTarget[]> {
  const targets: RecoveryTarget[] = [];
  let scanned = 0;
  for await (const exec of ctx.db
    .query('wfExecutions')
    .withIndex('by_status_awaitingCapacity', (q) =>
      q.eq('status', 'running').gt('awaitingCapacityStepSlug', ''),
    )) {
    if (targets.length >= limit) break;
    if (scanned >= RECOVERY_SCAN_LIMIT) break;
    scanned += 1;
    const stepSlug = exec.awaitingCapacityStepSlug;
    if (!stepSlug || !exec.componentWorkflowId) continue;
    const ownerId = `${exec._id}:${stepSlug}`;
    const ticket = await ctx.db
      .query('sandboxAdmissionTickets')
      .withIndex('by_owner', (q) =>
        q.eq('ownerType', 'workflow_run').eq('ownerId', ownerId),
      )
      .first();
    if (ticket) continue;
    targets.push({
      executionId: exec._id,
      stepSlug,
      componentWorkflowId: exec.componentWorkflowId,
      shardIndex: exec.shardIndex,
    });
  }
  return targets;
}

/** Exposed for tests: the recovery SELECTION (no side effects). The wake itself
 * lives in `reconcileAdmissionWakes` because `sendEvent` needs a mutation ctx. */
export const listParkedExecutionsNeedingRecovery = internalQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      executionId: v.id('wfExecutions'),
      stepSlug: v.string(),
      componentWorkflowId: v.string(),
      shardIndex: v.optional(v.number()),
    }),
  ),
  handler: (ctx, args) =>
    collectTicketlessParkedExecutions(
      ctx,
      args.limit ?? MAX_RECOVERED_PARKS_PER_CALL,
    ),
});

/**
 * Cron backstop + liveness heartbeat for event-driven workflow tickets.
 *
 * Three jobs, all bounded:
 *  1. HEARTBEAT — the parked workflow no longer re-polls `pollAdmission`, so it
 *     no longer re-stamps `lastSeenAt`. This refreshes `lastSeenAt` for every
 *     WAITING workflow ticket whose execution is still running, keeping the
 *     existing staleness reaper valid (a genuinely dead/terminal/missing
 *     execution is left to age out and get reaped — we do NOT refresh it).
 *  2. RE-WAKE — for each (org, kind) with open slots, re-fire the FIFO-head
 *     wake. This is the safety net for the only failure mode of the event model:
 *     a wake that was never sent (release-path scheduler dropped, or the slot
 *     freed via a path that doesn't schedule a wake).
 *  3. RECOVERY — re-ticket parked executions whose ticket was lost entirely, by
 *     driving off the durable `awaitingCapacityStepSlug` marker (jobs 1-2 only
 *     see executions that still HAVE a ticket). Self-heals a lost-ticket
 *     backlog that would otherwise wedge the queue forever.
 */
export const reconcileAdmissionWakes = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    // Distinct (org, kind) pairs seen among live workflow waiters; wake their
    // heads once after the heartbeat pass.
    const groups = new Map<
      string,
      { organizationId: string; kind: AdmissionKind }
    >();

    let scanned = 0;
    for await (const ticket of ctx.db
      .query('sandboxAdmissionTickets')
      .withIndex('by_status_lastSeen', (q) => q.eq('status', 'waiting'))) {
      if (scanned >= RECONCILE_SCAN_LIMIT) break;
      scanned += 1;
      if (ticket.source !== 'workflow' || !ticket.wfExecutionId) continue;
      const execId = ctx.db.normalizeId('wfExecutions', ticket.wfExecutionId);
      if (!execId) continue;
      const execution = await ctx.db.get(execId);
      if (
        !execution ||
        execution.status === 'completed' ||
        execution.status === 'failed'
      ) {
        // Missing/terminal → let the staleness reaper cull it; do NOT refresh.
        continue;
      }
      // Running → refresh the heartbeat the per-poll workflow no longer writes.
      await ctx.db.patch(ticket._id, { lastSeenAt: now });
      const key = `${ticket.organizationId}\0${ticket.kind}`;
      if (!groups.has(key)) {
        groups.set(key, {
          organizationId: ticket.organizationId,
          kind: ticket.kind,
        });
      }
    }

    for (const { organizationId, kind } of groups.values()) {
      await wakeHeadsForOrgKind(ctx, organizationId, kind, MAX_WAKES_PER_CALL);
    }

    // RECOVERY: re-ticket parked executions whose ticket vanished entirely (the
    // passes above only see ticketed waiters). Drives off the durable marker —
    // send the wake directly; the re-entered step re-polls and re-creates its
    // ticket. Best-effort: a dead/cleaned workflow just logs.
    const recoveryTargets = await collectTicketlessParkedExecutions(
      ctx,
      MAX_RECOVERED_PARKS_PER_CALL,
    );
    for (const target of recoveryTargets) {
      try {
        await workflowManagers[safeShardIndex(target.shardIndex)].sendEvent(
          ctx,
          {
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- componentWorkflowId stored as string, WorkflowId is a branded type
            workflowId: target.componentWorkflowId as unknown as WorkflowId,
            name: sandboxCapacityWakeEventName(
              target.executionId,
              target.stepSlug,
            ),
          },
        );
      } catch (err) {
        console.warn(
          `[sandbox.wake] recovery sendEvent failed for execution ${target.executionId} step ${target.stepSlug}:`,
          err,
        );
      }
    }
    return null;
  },
});
