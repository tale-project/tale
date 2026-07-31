/**
 * Wake a parked automation run because something it waits on just happened —
 * today, a human resolving the approval its current node parked behind.
 *
 * Without this, a decided approval sat until the run's own 30-second poll got
 * around to noticing — and a poll chain severed by a lost scheduled action
 * never noticed at all (the liveness sweep would eventually, at sweep
 * latency). The poke makes the decision the event it should be: due-now
 * promise, immediate step.
 *
 * A plain function importable from the approvals domain without creating a
 * module cycle: it touches only the runs table and generated function refs.
 */

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

/**
 * Poke the run if — and only if — it is parked. A `running` walker is already
 * awake and will read the decision itself; terminal runs are left alone. The
 * caller passes the run id as the string the approval row's metadata carries;
 * anything that does not resolve to this organization's parked run is a
 * silent no-op, because a stale approval must not throw the resolution.
 */
export async function pokeParkedRun(
  ctx: MutationCtx,
  args: { organizationId: string; runId: string },
): Promise<boolean> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the id string comes from the approval row's own metadata; a foreign or deleted id fails the guards below
  const runId = args.runId as Id<'automationRuns'>;
  const row = await ctx.db.get(runId).catch(() => null);
  if (
    !row ||
    row.organizationId !== args.organizationId ||
    row.status !== 'waiting'
  ) {
    return false;
  }
  await ctx.db.patch(runId, { wakeAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.automations.stepper.stepRun, {
    organizationId: args.organizationId,
    runId,
  });
  return true;
}
