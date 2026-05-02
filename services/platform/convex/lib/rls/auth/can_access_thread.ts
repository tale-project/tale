import { ConvexError } from 'convex/values';

import type { Doc } from '../../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../_generated/server';
import type { AuthenticatedUser } from '../types';
import { isOrgMember } from './check_org_membership';

export type ThreadMetadata = Doc<'threadMetadata'>;

/**
 * Returns the thread's metadata if `authUser` is allowed to access it (owner,
 * or shared thread within an org the user is a member of). Returns `null`
 * when the thread does not exist or access is denied — callers can shape that
 * into an empty result for queries.
 */
export async function canAccessThread(
  ctx: QueryCtx | MutationCtx,
  threadId: string,
  authUser: AuthenticatedUser,
): Promise<ThreadMetadata | null> {
  const metadata = await ctx.db
    .query('threadMetadata')
    .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
    .first();
  if (!metadata) return null;

  if (metadata.userId === authUser.userId) return metadata;

  if (metadata.isShared && metadata.organizationId) {
    const member = await isOrgMember(
      ctx,
      authUser.userId,
      metadata.organizationId,
    );
    if (member) return metadata;
  }

  return null;
}

/**
 * Throws `ConvexError({ code: 'forbidden' })` when access is denied or the
 * thread is missing. Use from mutations and from queries that should hard-fail
 * rather than silently return empty.
 */
export async function assertThreadAccess(
  ctx: QueryCtx | MutationCtx,
  threadId: string,
  authUser: AuthenticatedUser,
): Promise<ThreadMetadata> {
  const metadata = await canAccessThread(ctx, threadId, authUser);
  if (!metadata) {
    throw new ConvexError({
      code: 'forbidden',
      message: 'Not authorized to access this thread.',
    });
  }
  return metadata;
}
