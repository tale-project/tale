/**
 * Chaos doors for liveness E2E — fault injection the recovery machinery is
 * tested against on a REAL backend (real scheduler, real bundles, real
 * actions), where convex-test can only simulate.
 *
 * `severRunWakes` replays the incident class exactly: it cancels every
 * pending scheduled function that references the run, which is what a lost
 * action IS from the row's point of view (the job consumed, nothing
 * happened). Optionally rewinds the run's `wakeAt` so a test need not wait
 * out the real grace window before invoking the sweep.
 *
 * Guarded twice: these are INTERNAL mutations (unreachable from any client;
 * only the deployment's admin key or backend code can invoke them), and the
 * handler refuses unless the deployment explicitly opts into chaos doors
 * (`TALE_E2E=1`, the E2E stack, or `TALE_CHAOS_DOORS=1`, a dev stack running
 * the liveness playbook). A production deployment sets neither.
 */

import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';

function assertChaosDoorsOpen(): void {
  if (process.env.TALE_E2E !== '1' && process.env.TALE_CHAOS_DOORS !== '1') {
    throw new Error(
      'chaos doors are closed — set TALE_E2E=1 (E2E stack) or TALE_CHAOS_DOORS=1 (dev stack) on the deployment to use them',
    );
  }
}

export const severRunWakes = internalMutation({
  args: {
    organizationId: v.string(),
    runId: v.id('automationRuns'),
    /** Also rewind the run's liveness promise this far into the past, so the
     * sweep sees it overdue immediately instead of after the grace window. */
    rewindWakeAtMs: v.optional(v.number()),
  },
  returns: v.object({ cancelled: v.number() }),
  handler: async (ctx, args) => {
    assertChaosDoorsOpen();
    const run = await ctx.db.get(args.runId);
    if (!run || run.organizationId !== args.organizationId) {
      throw new Error('no such run in this organization');
    }
    // Every pending job whose args reference this run — the poll chain, the
    // settle poke, a scheduled step: all of it, exactly what a bundle swap
    // or restart kills.
    let cancelled = 0;
    const runIdText = String(args.runId);
    for await (const job of ctx.db.system.query('_scheduled_functions')) {
      if (job.state.kind !== 'pending') continue;
      if (!JSON.stringify(job.args).includes(runIdText)) continue;
      await ctx.scheduler.cancel(job._id);
      cancelled++;
    }
    if (args.rewindWakeAtMs !== undefined) {
      await ctx.db.patch(args.runId, {
        wakeAt: Date.now() - args.rewindWakeAtMs,
      });
    }
    return { cancelled };
  },
});
