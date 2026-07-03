import { v } from 'convex/values';

import { query } from '../_generated/server';
import { isOrgMember } from '../lib/rls/auth/check_org_membership';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { isActiveOrg } from '../lib/rls/organization/assert_active_org';
import {
  agentJobFailureReasonValidator,
  agentJobProgressItemValidator,
  agentJobStatusValidator,
} from './schema';

const jobCardValidator = v.object({
  _id: v.id('agentJobs'),
  _creationTime: v.number(),
  threadId: v.string(),
  jobThreadId: v.string(),
  parentAgentSlug: v.string(),
  name: v.string(),
  description: v.string(),
  status: agentJobStatusValidator,
  failureReason: v.optional(agentJobFailureReasonValidator),
  progress: v.array(agentJobProgressItemValidator),
  activeProgressId: v.optional(v.string()),
  narrowed: v.object({
    tools: v.array(v.string()),
    skills: v.array(v.string()),
    integrations: v.array(v.string()),
    methodology: v.optional(v.string()),
  }),
  startedAt: v.number(),
  completedAt: v.optional(v.number()),
  durationMs: v.optional(v.number()),
});

/**
 * One job card, rendered inline under its `spawn_agent` tool row (the row's
 * persisted result carries the jobId). Auth mirrors `thread_todos/queries.get`
 * against the job's PARENT thread: thread owner, or org member on a shared
 * thread, active org enforced. The full spec/result stays server-side — the
 * card shows name, progress, status, and the narrowing report; the transcript
 * renders from the job's own thread.
 */
export const get = query({
  args: { jobId: v.id('agentJobs'), organizationId: v.string() },
  returns: v.union(jobCardValidator, v.null()),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;

    const job = await ctx.db.get(args.jobId);
    if (!job) return null;

    const threadMetadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', job.threadId))
      .first();
    if (!threadMetadata) return null;

    const isOwner = threadMetadata.userId === authUser.userId;
    let hasAccess = isOwner;
    if (
      !hasAccess &&
      threadMetadata.isShared &&
      threadMetadata.organizationId
    ) {
      hasAccess = await isOrgMember(
        ctx,
        authUser.userId,
        threadMetadata.organizationId,
      );
    }
    const organizationId = threadMetadata.organizationId;
    if (
      !hasAccess ||
      !organizationId ||
      job.organizationId !== organizationId ||
      !isActiveOrg(organizationId, args.organizationId)
    ) {
      return null;
    }

    return {
      _id: job._id,
      _creationTime: job._creationTime,
      threadId: job.threadId,
      jobThreadId: job.jobThreadId,
      parentAgentSlug: job.parentAgentSlug,
      name: job.name,
      description: job.description,
      status: job.status,
      failureReason: job.failureReason,
      progress: job.progress,
      activeProgressId: job.activeProgressId,
      narrowed: job.spec.narrowed,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      durationMs: job.durationMs,
    };
  },
});
