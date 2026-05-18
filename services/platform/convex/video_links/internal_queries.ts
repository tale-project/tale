import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';

/**
 * Internal read of a videoLinkJobs row by id. Used by the orchestrator
 * action at every phase boundary to detect cancellation
 * (`status === 'skipped'`) and pick up fresh field values written by
 * `updateJob` between phases.
 */
export const getJobById = internalQuery({
  args: { jobId: v.id('videoLinkJobs') },
  async handler(ctx, args) {
    return await ctx.db.get(args.jobId);
  },
});
