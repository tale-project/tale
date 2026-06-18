/**
 * Member-mirror synchronization.
 *
 * Keeps the `memberMirror` table (a local read cache of Better Auth's `member`
 * rows) in step with every member write path:
 *
 * - Custom Convex mutations (members/mutations.ts, users/*, sso/*, trusted
 *   headers) already hold the authoritative member data after their adapter
 *   write, so they call the INLINE helpers (`upsertMemberMirror` /
 *   `deleteMemberMirrorByMemberId`) directly on `ctx.db` — same transaction,
 *   no extra cross-component read.
 * - Better Auth plugin endpoints / org hooks (which write the member row
 *   inside the component, out of our mutation's reach) trigger the INTERNAL
 *   mutations (`resyncOrgMemberMirror` / `cascadeDeleteOrgMembersMirror`),
 *   which re-derive the mirror from Better Auth (the source of truth) and are
 *   therefore idempotent.
 *
 * The mirror is a performance cache, never the authoritative RLS gate — see
 * `members/schema.ts` and `lib/rls/MEMBERSHIP_MIRROR_DESIGN.md`.
 */

import { v } from 'convex/values';

import { isRecord, getString, getNumber } from '../../lib/utils/type-utils';
import { components } from '../_generated/api';
import type { MutationCtx } from '../_generated/server';
import { internalMutation } from '../_generated/server';

export interface MirrorMemberInput {
  memberId: string;
  userId: string;
  organizationId: string;
  role: string;
  createdAt: number;
}

/**
 * Upsert one mirror row, keyed on the Better Auth `memberId`. Role is stored
 * lowercase to match the reader's normalization. Idempotent.
 */
export async function upsertMemberMirror(
  ctx: MutationCtx,
  input: MirrorMemberInput,
): Promise<void> {
  const role = input.role.toLowerCase();
  const existing = await ctx.db
    .query('memberMirror')
    .withIndex('by_memberId', (q) => q.eq('memberId', input.memberId))
    .first();
  if (existing) {
    if (
      existing.userId === input.userId &&
      existing.organizationId === input.organizationId &&
      existing.role === role
    ) {
      return; // already in sync — no write
    }
    await ctx.db.patch(existing._id, {
      userId: input.userId,
      organizationId: input.organizationId,
      role,
      updatedAt: Date.now(),
    });
    return;
  }
  await ctx.db.insert('memberMirror', {
    memberId: input.memberId,
    userId: input.userId,
    organizationId: input.organizationId,
    role,
    createdAt: input.createdAt,
    updatedAt: Date.now(),
  });
}

/** Delete the mirror row for a Better Auth `memberId` (no-op if absent). */
export async function deleteMemberMirrorByMemberId(
  ctx: MutationCtx,
  memberId: string,
): Promise<void> {
  const existing = await ctx.db
    .query('memberMirror')
    .withIndex('by_memberId', (q) => q.eq('memberId', memberId))
    .first();
  if (existing) {
    await ctx.db.delete(existing._id);
  }
}

/** Delete every mirror row for an `(organizationId, userId)` pair. */
async function deleteMemberMirrorByOrgUser(
  ctx: MutationCtx,
  organizationId: string,
  userId: string,
): Promise<number> {
  let deleted = 0;
  for await (const row of ctx.db
    .query('memberMirror')
    .withIndex('by_org_user', (q) =>
      q.eq('organizationId', organizationId).eq('userId', userId),
    )) {
    await ctx.db.delete(row._id);
    deleted += 1;
  }
  return deleted;
}

/**
 * Read the authoritative Better Auth member row for `(organizationId, userId)`,
 * if any. Used by the resync mutations to re-derive the mirror from source.
 */
async function readBetterAuthMember(
  ctx: MutationCtx,
  organizationId: string,
  userId: string,
): Promise<MirrorMemberInput | null> {
  const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'member',
    paginationOpts: { cursor: null, numItems: 1 },
    where: [
      { field: 'organizationId', value: organizationId, operator: 'eq' },
      { field: 'userId', value: userId, operator: 'eq' },
    ],
  });
  const raw = result?.page?.[0];
  if (!isRecord(raw)) return null;
  const memberId = getString(raw, '_id');
  if (!memberId) return null;
  return {
    memberId,
    userId,
    organizationId,
    role: getString(raw, 'role') ?? 'member',
    createdAt: getNumber(raw, 'createdAt') ?? Date.now(),
  };
}

/**
 * Re-derive the mirror for one `(organizationId, userId)` from Better Auth.
 * Used by the org-create / accept-invitation hooks and the after-middleware
 * catch-all (leave / remove-member / update-member-role). If the source row
 * exists → upsert; if it is gone → delete the stale mirror row(s). Idempotent.
 */
export const resyncOrgMemberMirror = internalMutation({
  args: { organizationId: v.string(), userId: v.string() },
  returns: v.object({ action: v.string() }),
  handler: async (ctx, args) => {
    const source = await readBetterAuthMember(
      ctx,
      args.organizationId,
      args.userId,
    );
    if (source) {
      await upsertMemberMirror(ctx, source);
      return { action: 'upserted' };
    }
    const deleted = await deleteMemberMirrorByOrgUser(
      ctx,
      args.organizationId,
      args.userId,
    );
    return { action: deleted > 0 ? 'deleted' : 'noop' };
  },
});

/** Cascade-delete every mirror row for an org (org deletion). */
export const cascadeDeleteOrgMembersMirror = internalMutation({
  args: { organizationId: v.string() },
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, args) => {
    let deleted = 0;
    for await (const row of ctx.db
      .query('memberMirror')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      await ctx.db.delete(row._id);
      deleted += 1;
    }
    return { deleted };
  },
});

// ---------------------------------------------------------------------------
// teamMember mirror — same machinery for Better Auth's `teamMember` table,
// feeding getUserTeamIds.
// ---------------------------------------------------------------------------

export interface MirrorTeamMemberInput {
  teamMemberId: string;
  userId: string;
  teamId: string;
  createdAt: number;
}

/** Upsert one teamMember mirror row, keyed on `teamMemberId`. Idempotent. */
export async function upsertTeamMemberMirror(
  ctx: MutationCtx,
  input: MirrorTeamMemberInput,
): Promise<void> {
  const existing = await ctx.db
    .query('teamMemberMirror')
    .withIndex('by_teamMemberId', (q) =>
      q.eq('teamMemberId', input.teamMemberId),
    )
    .first();
  if (existing) {
    if (existing.userId === input.userId && existing.teamId === input.teamId) {
      return; // already in sync — no write
    }
    await ctx.db.patch(existing._id, {
      userId: input.userId,
      teamId: input.teamId,
      updatedAt: Date.now(),
    });
    return;
  }
  await ctx.db.insert('teamMemberMirror', {
    teamMemberId: input.teamMemberId,
    userId: input.userId,
    teamId: input.teamId,
    createdAt: input.createdAt,
    updatedAt: Date.now(),
  });
}

/** Delete the teamMember mirror row for a Better Auth `teamMemberId`. */
export async function deleteTeamMemberMirrorByTeamMemberId(
  ctx: MutationCtx,
  teamMemberId: string,
): Promise<void> {
  const existing = await ctx.db
    .query('teamMemberMirror')
    .withIndex('by_teamMemberId', (q) => q.eq('teamMemberId', teamMemberId))
    .first();
  if (existing) {
    await ctx.db.delete(existing._id);
  }
}

/** Delete every teamMember mirror row for a `(teamId, userId)` pair. */
async function deleteTeamMemberMirrorByTeamUser(
  ctx: MutationCtx,
  teamId: string,
  userId: string,
): Promise<number> {
  let deleted = 0;
  for await (const row of ctx.db
    .query('teamMemberMirror')
    .withIndex('by_team_user', (q) =>
      q.eq('teamId', teamId).eq('userId', userId),
    )) {
    await ctx.db.delete(row._id);
    deleted += 1;
  }
  return deleted;
}

/**
 * Read the authoritative Better Auth teamMember row for `(teamId, userId)`,
 * if any. Used by the resync mutation to re-derive the mirror from source.
 */
async function readBetterAuthTeamMember(
  ctx: MutationCtx,
  teamId: string,
  userId: string,
): Promise<MirrorTeamMemberInput | null> {
  const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'teamMember',
    paginationOpts: { cursor: null, numItems: 1 },
    where: [
      { field: 'teamId', value: teamId, operator: 'eq' },
      { field: 'userId', value: userId, operator: 'eq' },
    ],
  });
  const raw = result?.page?.[0];
  if (!isRecord(raw)) return null;
  const teamMemberId = getString(raw, '_id');
  if (!teamMemberId) return null;
  return {
    teamMemberId,
    userId,
    teamId,
    createdAt: getNumber(raw, 'createdAt') ?? Date.now(),
  };
}

/**
 * Re-derive the teamMember mirror for one `(teamId, userId)` from Better Auth.
 * Used by the team-member org hooks (client-direct endpoint calls). Source row
 * exists → upsert; gone → delete the stale mirror row(s). Idempotent.
 */
export const resyncTeamMemberMirror = internalMutation({
  args: { teamId: v.string(), userId: v.string() },
  returns: v.object({ action: v.string() }),
  handler: async (ctx, args) => {
    const source = await readBetterAuthTeamMember(
      ctx,
      args.teamId,
      args.userId,
    );
    if (source) {
      await upsertTeamMemberMirror(ctx, source);
      return { action: 'upserted' };
    }
    const deleted = await deleteTeamMemberMirrorByTeamUser(
      ctx,
      args.teamId,
      args.userId,
    );
    return { action: deleted > 0 ? 'deleted' : 'noop' };
  },
});

/** Delete every teamMember mirror row for a team (inline helper). */
export async function deleteTeamMemberMirrorByTeamId(
  ctx: MutationCtx,
  teamId: string,
): Promise<number> {
  let deleted = 0;
  for await (const row of ctx.db
    .query('teamMemberMirror')
    .withIndex('by_teamId', (q) => q.eq('teamId', teamId))) {
    await ctx.db.delete(row._id);
    deleted += 1;
  }
  return deleted;
}

/** Cascade-delete every teamMember mirror row for a team (team deletion). */
export const cascadeDeleteTeamMembersMirror = internalMutation({
  args: { teamId: v.string() },
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, args) => {
    const deleted = await deleteTeamMemberMirrorByTeamId(ctx, args.teamId);
    return { deleted };
  },
});
