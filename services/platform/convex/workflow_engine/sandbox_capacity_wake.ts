// Event-driven "capacity wake" for parked workflow sandbox steps.
//
// A workflow sandbox step that can't get a capacity slot returns
// `awaiting_capacity`; the durable handler then BLOCKS on
// `step.awaitEvent({ name: sandboxCapacityWakeEventName(...) })` instead of
// re-running the whole executeStep action on a backoff timer. `wakeHeadWaiters`
// sends that wake event so a parked step resumes the instant a slot frees.
//
// Because that awaitEvent has NO timeout, a parked step's liveness rests
// entirely on this wake being sent — so it is scheduled (best-effort,
// `runAfter(0, ...)`) on EVERY edge that can make a slot serviceable, not just
// one:
//   1. slot RELEASE — session destroy/expire/stop, one-shot finalize, watchdog
//      reap (sandbox/* mutations);
//   2. fresh waiter ARRIVAL — `pollAdmission` parks with a slot still open
//      (an earlier head's release wake was lost, or its head is wedged);
//   3. ticket REAPER backstop — `recoverStuckAdmissionTickets` nudges any org
//      with a live parked workflow waiter, and wakes after culling a dead head.
// Relying on (1) alone is what deadlocked: a slot held open by a long-lived idle
// session is never "released", so no release edge ever fires. (2) and (3) are
// the lightweight, cron-free recovery (the reaper rides its EXISTING cron). A
// parked-but-running step keeps its admission ticket without any periodic
// refresh — the reaper culls a workflow ticket only once its EXECUTION is
// terminal/missing — so this ticket-driven wake always finds the live waiter.
//
// It lives under workflow_engine/ (NOT sandbox/) on purpose: it imports the
// workflow component `workflowManagers` by value, and sandbox/* must not import
// workflow_engine/engine by value (that would create an import cycle). The
// slot-release mutations in sandbox/* reach this module only via the scheduler
// (`internal.workflow_engine.sandbox_capacity_wake.wakeHeadWaiters`), never by
// value.

import type { WorkflowId } from '@convex-dev/workflow';
import { v } from 'convex/values';

import { internalMutation, type MutationCtx } from '../_generated/server';
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
 * queue) can't turn one slot release into an unbounded sendEvent fan-out. A
 * spurious extra wake is cheap (one reserve attempt that re-parks), so this only
 * needs to be "sane", not exact. */
const MAX_WAKES_PER_CALL = 16;

/**
 * Wake up to `count` FIFO-head WAITING workflow tickets for one (org, kind), but
 * never more than the slots currently open (no point waking a waiter that would
 * just re-park) and never more than `MAX_WAKES_PER_CALL`. Each `sendEvent` is
 * best-effort: a failure is logged and skipped so one dead workflow can't abort
 * the rest of the queue. Returns the number actually woken. The waiter's ticket
 * persists for as long as its execution runs (the reaper is execution-state
 * driven, not staleness driven), so this ticket scan always sees a live parked
 * step. Called by `wakeHeadWaiters` — NOT an exported mutation.
 */
async function wakeHeadsForOrgKind(
  ctx: MutationCtx,
  organizationId: string,
  kind: AdmissionKind,
  count: number,
): Promise<number> {
  if (count <= 0) return 0;
  // Un-budgeted slot count (total org sessions vs the user cap): the wake only
  // needs to be "sane", not exact — a waiter woken while ITS budget is full just
  // re-parks (assertFifoEligible rechecks the owner's budget at reserve time).
  const cap = await admissionCap(ctx, organizationId);
  const inFlight = await admissionInFlight(ctx, organizationId);
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
      // Missing/terminal execution → no live awaitEvent to resume; the reaper
      // culls the ticket on this same terminal signal. Don't count it against
      // `toWake`, and skip (not break) so a live waiter behind it still wakes.
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
      // next slot-release re-wakes this org's heads.
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
 * resumes a parked step immediately. Caps wakes at the open slots so a wake never
 * outruns capacity. Returns the number actually woken.
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
