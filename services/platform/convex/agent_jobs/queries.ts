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
  messageId: v.optional(v.string()),
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
 * Job cards for one chat thread. Auth mirrors `thread_todos/queries.get`:
 * thread owner, or org member on a shared thread, active org enforced. The
 * full spec/result stays server-side — the card shows name, progress, status,
 * and the narrowing report; the transcript renders from the job's own thread.
 */
export const listByThread = query({
  args: { threadId: v.string(), organizationId: v.string() },
  returns: v.array(jobCardValidator),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];

    const threadMetadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();
    if (!threadMetadata) return [];

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
      !isActiveOrg(organizationId, args.organizationId)
    ) {
      return [];
    }

    const jobs = await ctx.db
      .query('agentJobs')
      .withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
      .collect();

    return jobs
      .filter((job) => job.organizationId === organizationId)
      .map((job) => ({
        _id: job._id,
        _creationTime: job._creationTime,
        threadId: job.threadId,
        jobThreadId: job.jobThreadId,
        messageId: job.messageId,
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
      }));
  },
});
