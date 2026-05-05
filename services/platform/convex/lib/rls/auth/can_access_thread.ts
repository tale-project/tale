import { ConvexError } from 'convex/values';

import type { Doc } from '../../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../_generated/server';
import type { AuthenticatedUser } from '../types';
import { isOrgMember } from './check_org_membership';

export type ThreadMetadata = Doc<'threadMetadata'>;

/**
 * Returns the thread's metadata if `authUser` is allowed to access it
 * (current member of the thread's org — including the owner — or non-owner
 * with the thread shared into an org they belong to). Returns `null` when
 * the thread does not exist or access is denied; callers shape that into an
 * empty result for queries.
 *
 * Owner-branch membership check: threads are an org-scoped resource, so
 * once the user leaves (or the org is deleted) the thread is no longer
 * accessible to them — even though the metadata row itself persists today
 * (no cascade delete on org deletion). Without this, a removed-member owner
 * could still load their old thread by URL.
 *
 * `expectedOrgId` is an optional hint, typically the URL's `organizationId`.
 * When supplied, the membership lookup runs in parallel with the metadata
 * read via `Promise.all`; the fast path costs `max(metadata_read, isOrgMember)`
 * instead of `metadata_read + isOrgMember`. When the hint matches the thread's
 * actual org (the common case), the parallel result is reused; when it does
 * not, we fall through to a sequential lookup against the actual org.
 */
export async function canAccessThread(
  ctx: QueryCtx | MutationCtx,
  threadId: string,
  authUser: AuthenticatedUser,
  expectedOrgId?: string,
): Promise<ThreadMetadata | null> {
  const [metadata, expectedMembership] = await Promise.all([
    ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
      .first(),
    expectedOrgId
      ? isOrgMember(ctx, authUser.userId, expectedOrgId)
      : Promise.resolve(null),
  ]);
  if (!metadata) return null;

  // Owner branch
  if (metadata.userId === authUser.userId) {
    if (!metadata.organizationId) return metadata; // legacy: no org to check
    if (expectedOrgId === metadata.organizationId) {
      return expectedMembership ? metadata : null;
    }
    const isMember = await isOrgMember(
      ctx,
      authUser.userId,
      metadata.organizationId,
    );
    return isMember ? metadata : null;
  }

  // Shared branch
  if (metadata.isShared && metadata.organizationId) {
    if (expectedOrgId === metadata.organizationId) {
      return expectedMembership ? metadata : null;
    }
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
  expectedOrgId?: string,
): Promise<ThreadMetadata> {
  const metadata = await canAccessThread(
    ctx,
    threadId,
    authUser,
    expectedOrgId,
  );
  if (!metadata) {
    throw new ConvexError({
      code: 'forbidden',
      message: 'Not authorized to access this thread.',
    });
  }
  return metadata;
}
