import { ConvexError } from 'convex/values';

import { isRecord } from '../../../../lib/utils/type-utils';
import { components } from '../../../_generated/api';
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

  // Trashed/expired/deleted threads are NOT accessible via this RLS path.
  // Admin Trash management uses a separate query that bypasses this check.
  // Without this gate, a holder of a thread URL could keep reading/writing
  // a soft-deleted thread until retention Pass B physically removes it.
  if (
    metadata.status === 'trashed' ||
    metadata.status === 'expired' ||
    metadata.status === 'deleted'
  ) {
    return null;
  }

  // Owner branch
  if (metadata.userId === authUser.userId) {
    if (!metadata.organizationId) return metadata; // org-less thread: owner access, no org to check
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

  // Non-owner access rules below grant access to any current member of the
  // thread's org. They reuse the already-resolved `expectedMembership` when the
  // hint matched, else fall back to a lookup against the actual org. A `false`
  // result falls THROUGH to the next rule (a thread can be both shared and a
  // discussion), unlike the owner branch which denies outright.
  const grantedToOrgMember = async (): Promise<boolean> => {
    if (!metadata.organizationId) return false;
    if (expectedOrgId === metadata.organizationId) return !!expectedMembership;
    return isOrgMember(ctx, authUser.userId, metadata.organizationId);
  };

  // Shared branch
  if (metadata.isShared && metadata.organizationId) {
    if (await grantedToOrgMember()) return metadata;
  }

  // Discussion branch: project/task discussions are a shared surface — any
  // member of the thread's org may read/reply (the owner branch above already
  // covered the author). This is what lets a non-owner teammate participate in
  // a discussion, unlike a private `chat` thread.
  if (
    (metadata.kind === 'project_discussion' ||
      metadata.kind === 'task_discussion') &&
    metadata.organizationId
  ) {
    if (await grantedToOrgMember()) return metadata;
  }

  return null;
}

/**
 * Max parent hops walked when authorizing a delegated sub-thread. Delegation is
 * one level in practice (chat thread → sub-agent thread); the small bound just
 * defends against an unexpected cycle or deep nesting walking forever.
 */
const MAX_SUB_THREAD_PARENT_HOPS = 4;

/**
 * Like {@link canAccessThread}, but also authorizes delegated sub-threads.
 *
 * Sub-agent threads (e.g. the researcher's per-delegation thread) are created
 * through the Agent SDK component and have NO `threadMetadata` row of their own
 * (see `get_or_create_sub_thread.ts`), so `canAccessThread` always denies them.
 * The chat UI nevertheless subscribes to a sub-thread's live stream to render
 * the nested delegation timeline — without this, that subscription returns the
 * forbidden fallback on every tick.
 *
 * A sub-thread is visible to whoever can see the PARENT thread it was spawned
 * from. We read the component thread's `summary.parentThreadId` and authorize
 * against the parent (returning the PARENT's metadata, which callers use only
 * as a truthy access gate). Bounded by {@link MAX_SUB_THREAD_PARENT_HOPS}.
 *
 * Use this ONLY on read paths that legitimately stream sub-threads (the
 * streaming-messages query). Keep ordinary thread access on `canAccessThread`.
 */
export async function canAccessThreadOrSubThread(
  ctx: QueryCtx | MutationCtx,
  threadId: string,
  authUser: AuthenticatedUser,
  expectedOrgId?: string,
): Promise<ThreadMetadata | null> {
  const direct = await canAccessThread(ctx, threadId, authUser, expectedOrgId);
  if (direct) return direct;

  let currentThreadId = threadId;
  for (let hop = 0; hop < MAX_SUB_THREAD_PARENT_HOPS; hop++) {
    const parentThreadId = await readSubThreadParentId(ctx, currentThreadId);
    if (!parentThreadId) return null;

    const parentAccess = await canAccessThread(
      ctx,
      parentThreadId,
      authUser,
      expectedOrgId,
    );
    if (parentAccess) return parentAccess;

    // Parent itself may be another sub-thread (nested delegation) — keep
    // walking up until we hit a thread with metadata the user can access.
    currentThreadId = parentThreadId;
  }
  return null;
}

/** Read a delegated sub-thread's `parentThreadId` from its component-thread
 *  summary. Returns `undefined` when the thread is missing, has no summary, or
 *  the summary isn't a sub-thread record. */
async function readSubThreadParentId(
  ctx: QueryCtx | MutationCtx,
  threadId: string,
): Promise<string | undefined> {
  const thread = await ctx.runQuery(components.agent.threads.getThread, {
    threadId,
  });
  if (!thread?.summary) return undefined;
  try {
    const summary: unknown = JSON.parse(thread.summary);
    if (isRecord(summary) && typeof summary.parentThreadId === 'string') {
      return summary.parentThreadId;
    }
  } catch (err) {
    console.warn(
      `[canAccessThreadOrSubThread] unparseable summary for thread ${threadId}:`,
      err instanceof Error ? err.message : err,
    );
  }
  return undefined;
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
