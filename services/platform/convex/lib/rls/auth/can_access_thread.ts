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
 * `expectedOrgId` is the caller's ACTIVE org, typically the URL's
 * `organizationId`. When supplied it is ENFORCED: the thread must belong to
 * that org or access is denied. This is the active-org coherence boundary —
 * without it a member of both org A and org B who has switched to B can still
 * load org-A's thread by id (a carried-over URL, a warm cache, or a deep link),
 * because owning the thread + remaining an org-A member is enough to pass. The
 * membership lookup runs in parallel with the metadata read via `Promise.all`,
 * so the check costs `max(metadata_read, isOrgMember)` not the sum. Omit the
 * hint ONLY from internal/system callers that have no active-org context; those
 * fall back to authorizing against the thread's own org.
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
    // Active-org coherence: an explicit `expectedOrgId` means the caller knows
    // which org it is acting in, so the thread MUST belong to THAT org — not
    // merely an org the owner still belongs to. Denying on mismatch is what
    // stops org-A's thread from rendering while the user is switched to org B.
    if (expectedOrgId !== undefined) {
      return expectedOrgId === metadata.organizationId && expectedMembership
        ? metadata
        : null;
    }
    // No active-org context (internal/system caller): authorize against the
    // thread's own org.
    const isMember = await isOrgMember(
      ctx,
      authUser.userId,
      metadata.organizationId,
    );
    return isMember ? metadata : null;
  }

  // Non-owner access rules below grant access to a current member of the
  // thread's org. Same active-org coherence rule as the owner branch: an
  // explicit hint is enforced (deny when it doesn't match the thread's org);
  // only a missing hint falls back to a lookup against the thread's own org. A
  // `false` result falls THROUGH to the next rule (a thread can be both shared
  // and a discussion), unlike the owner branch which denies outright.
  const grantedToOrgMember = async (): Promise<boolean> => {
    if (!metadata.organizationId) return false;
    if (expectedOrgId !== undefined) {
      return expectedOrgId === metadata.organizationId && !!expectedMembership;
    }
    return isOrgMember(ctx, authUser.userId, metadata.organizationId);
  };

  // Shared branch
  if (metadata.isShared && metadata.organizationId) {
    if (await grantedToOrgMember()) return metadata;
  }

  // Discussion branch: task-comment and automation threads are a shared
  // surface — any member of the thread's org may read/reply (the owner branch
  // above already covered the author). This is what lets a non-owner teammate
  // participate, unlike a private `chat` thread. An `automation_discussion`
  // (the AgentChat block's shared per-subject thread) may carry no
  // `projectId` at all — org membership alone is the gate.
  if (
    (metadata.kind === 'task_discussion' ||
      metadata.kind === 'automation_discussion') &&
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
 * Boolean access check spanning BOTH thread models: the legacy
 * `threadMetadata` world this module was written for, and the direct-chat
 * `threads` table the rewrite introduced. A direct-chat thread is
 * user-private — owner in the expected org, not soft-deleted — so the v4
 * branch is strictly owner-only (project sharing grants read elsewhere,
 * never ingest rights). Use where a feature serves both worlds (the
 * video-link chips ride the direct chat today, the legacy metadata model
 * elsewhere).
 */
export async function canAccessThreadAnyModel(
  ctx: QueryCtx | MutationCtx,
  threadId: string,
  authUser: AuthenticatedUser,
  expectedOrgId?: string,
): Promise<boolean> {
  const normalized = ctx.db.normalizeId('threads', threadId);
  if (normalized !== null) {
    const thread = await ctx.db.get(normalized);
    if (
      thread !== null &&
      thread.userId === authUser.userId &&
      thread.lifecycleStatus === undefined &&
      (expectedOrgId === undefined || thread.organizationId === expectedOrgId)
    ) {
      return true;
    }
  }
  const metadata = await canAccessThread(
    ctx,
    threadId,
    authUser,
    expectedOrgId,
  );
  return metadata !== null;
}

/** `canAccessThreadAnyModel`, throwing the same forbidden error the
 * metadata-model assert uses. */
export async function assertThreadAccessAnyModel(
  ctx: QueryCtx | MutationCtx,
  threadId: string,
  authUser: AuthenticatedUser,
  expectedOrgId?: string,
): Promise<void> {
  if (
    !(await canAccessThreadAnyModel(ctx, threadId, authUser, expectedOrgId))
  ) {
    throw new ConvexError({
      code: 'forbidden',
      message: 'Not authorized to access this thread.',
    });
  }
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
