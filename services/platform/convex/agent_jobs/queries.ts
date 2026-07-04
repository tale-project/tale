import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { query, type QueryCtx } from '../_generated/server';
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
  toolCallId: v.optional(v.string()),
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
 * PARENT-thread access check, mirroring `thread_todos/queries.get`: thread
 * owner, or org member on a shared thread, active org enforced. Returns the
 * thread's organizationId when access holds, null otherwise.
 */
async function authorizedThreadOrg(
  ctx: QueryCtx,
  threadId: string,
  activeOrganizationId: string,
): Promise<string | null> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) return null;

  const threadMetadata = await ctx.db
    .query('threadMetadata')
    .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
    .first();
  if (!threadMetadata) return null;

  const isOwner = threadMetadata.userId === authUser.userId;
  let hasAccess = isOwner;
  if (!hasAccess && threadMetadata.isShared && threadMetadata.organizationId) {
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
    !isActiveOrg(organizationId, activeOrganizationId)
  ) {
    return null;
  }
  return organizationId;
}

/** The card projection — the full spec/result stays server-side. */
function toJobCard(job: Doc<'agentJobs'>) {
  return {
    _id: job._id,
    _creationTime: job._creationTime,
    threadId: job.threadId,
    jobThreadId: job.jobThreadId,
    toolCallId: job.toolCallId,
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
}

/**
 * One job card, rendered inline under its `spawn_agent` tool row (the row's
 * persisted result carries the jobId). The card shows name, progress, status,
 * and the narrowing report; the transcript renders from the job's own thread.
 */
export const get = query({
  args: { jobId: v.id('agentJobs'), organizationId: v.string() },
  returns: v.union(jobCardValidator, v.null()),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;

    const organizationId = await authorizedThreadOrg(
      ctx,
      job.threadId,
      args.organizationId,
    );
    if (!organizationId || job.organizationId !== organizationId) return null;

    return toJobCard(job);
  },
});

/** Bounded read: a turn spawns at most a handful of jobs; GC trims the rest. */
const MAX_THREAD_JOBS = 32;

/**
 * The newest jobs spawned FROM a chat thread, keyed by `toolCallId` on the
 * client. This is the LIVE anchor for the in-flight case: while `spawn_agent`
 * is still executing its tool result (which carries the jobId) does not exist
 * yet, but the streamed tool part's id and the job row's `toolCallId` are the
 * same AI-SDK id — so the card can mount the moment the job starts. Same auth
 * as `get`, against the parent thread.
 */
export const listForThread = query({
  args: { threadId: v.string(), organizationId: v.string() },
  returns: v.array(jobCardValidator),
  handler: async (ctx, args) => {
    const organizationId = await authorizedThreadOrg(
      ctx,
      args.threadId,
      args.organizationId,
    );
    if (!organizationId) return [];

    const jobs = await ctx.db
      .query('agentJobs')
      .withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
      .order('desc')
      .take(MAX_THREAD_JOBS);

    return jobs
      .filter((job) => job.organizationId === organizationId)
      .map(toJobCard);
  },
});
