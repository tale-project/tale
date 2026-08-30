import type { MutationCtx } from '../_generated/server';

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
