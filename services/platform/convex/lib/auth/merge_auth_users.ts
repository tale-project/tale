import { components } from '../../_generated/api';
import type { MutationCtx } from '../../_generated/server';
import {
  upsertMemberMirror,
  deleteMemberMirrorByMemberId,
  upsertTeamMemberMirror,
  deleteTeamMemberMirrorByTeamMemberId,
} from '../../members/mirror_sync';
import type {
  BetterAuthMember,
  BetterAuthFindManyResult,
} from '../../members/types';
import {
  findAuthUserById,
  type AuthReadCtx,
} from './find_user_by_normalized_email';
import {
  mergeCanonicalUserFields,
  pickHigherMemberRole,
} from './merge_auth_email_duplicates';
import { normalizeAuthEmail } from './normalize_auth_email';

type AdapterWhere = {
  field: string;
  value: string;
  operator: 'eq';
};

type BetterAuthTeamMemberRow = {
  _id: string;
  teamId: string;
  userId: string;
  createdAt?: number;
};

async function gatherByUserId<T extends { _id?: string }>(
  ctx: AuthReadCtx,
  model: 'member' | 'account' | 'teamMember' | 'session',
  userId: string,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (;;) {
    const res: BetterAuthFindManyResult<T> = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model,
        paginationOpts: { cursor, numItems: 200 },
        where: [{ field: 'userId', value: userId, operator: 'eq' }],
      },
    );
    rows.push(...(res.page ?? []));
    if (res.isDone || !res.continueCursor) break;
    cursor = res.continueCursor;
  }
  return rows;
}

async function updateAdapterRow(
  ctx: MutationCtx,
  model: 'member' | 'account' | 'teamMember' | 'session',
  where: AdapterWhere[],
  update: Record<string, unknown>,
): Promise<void> {
  await ctx.runMutation(components.betterAuth.adapter.updateMany, {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter where is model-specific
    input: { model, where: where as never, update },
    paginationOpts: { cursor: null, numItems: 1 },
  });
}

async function deleteAdapterRow(
  ctx: MutationCtx,
  model: 'member' | 'account' | 'teamMember' | 'session' | 'user',
  where: AdapterWhere[],
): Promise<void> {
  await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter where is model-specific
    input: { model, where: where as never },
  });
}

async function findMember(
  ctx: AuthReadCtx,
  organizationId: string,
  userId: string,
): Promise<BetterAuthMember | undefined> {
  const res: BetterAuthFindManyResult<BetterAuthMember> = await ctx.runQuery(
    components.betterAuth.adapter.findMany,
    {
      model: 'member',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [
        { field: 'organizationId', value: organizationId, operator: 'eq' },
        { field: 'userId', value: userId, operator: 'eq' },
      ],
    },
  );
  return res.page[0];
}

async function findTeamMember(
  ctx: AuthReadCtx,
  teamId: string,
  userId: string,
): Promise<BetterAuthTeamMemberRow | undefined> {
  const res: BetterAuthFindManyResult<BetterAuthTeamMemberRow> =
    await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'teamMember',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [
        { field: 'teamId', value: teamId, operator: 'eq' },
        { field: 'userId', value: userId, operator: 'eq' },
      ],
    });
  return res.page[0];
}

async function repointTeamMember(
  ctx: MutationCtx,
  duplicateTeamMember: {
    _id: string;
    teamId: string;
    userId: string;
    createdAt?: number;
  },
  canonicalUserId: string,
): Promise<void> {
  const teamId = duplicateTeamMember.teamId;
  const canonicalTeamMember = await findTeamMember(
    ctx,
    teamId,
    canonicalUserId,
  );
  const createdAt = duplicateTeamMember.createdAt ?? Date.now();

  if (!canonicalTeamMember) {
    await updateAdapterRow(
      ctx,
      'teamMember',
      [{ field: '_id', value: duplicateTeamMember._id, operator: 'eq' }],
      { userId: canonicalUserId },
    );
    await upsertTeamMemberMirror(ctx, {
      teamMemberId: duplicateTeamMember._id,
      userId: canonicalUserId,
      teamId,
      createdAt,
    });
    return;
  }

  await deleteAdapterRow(ctx, 'teamMember', [
    { field: '_id', value: duplicateTeamMember._id, operator: 'eq' },
  ]);
  await deleteTeamMemberMirrorByTeamMemberId(ctx, duplicateTeamMember._id);
}

async function repointMember(
  ctx: MutationCtx,
  duplicateMember: BetterAuthMember,
  canonicalUserId: string,
): Promise<void> {
  const orgId = duplicateMember.organizationId;
  const canonicalMember = await findMember(ctx, orgId, canonicalUserId);
  const dupRole = (duplicateMember.role ?? 'member').toLowerCase();
  const createdAt = duplicateMember.createdAt ?? Date.now();

  if (!canonicalMember) {
    await updateAdapterRow(
      ctx,
      'member',
      [{ field: '_id', value: duplicateMember._id, operator: 'eq' }],
      { userId: canonicalUserId },
    );
    await upsertMemberMirror(ctx, {
      memberId: duplicateMember._id,
      userId: canonicalUserId,
      organizationId: orgId,
      role: dupRole,
      createdAt,
    });
    return;
  }

  const mergedRole = pickHigherMemberRole(canonicalMember.role, dupRole);
  if (mergedRole !== (canonicalMember.role ?? '').toLowerCase()) {
    await updateAdapterRow(
      ctx,
      'member',
      [{ field: '_id', value: canonicalMember._id, operator: 'eq' }],
      { role: mergedRole },
    );
    await upsertMemberMirror(ctx, {
      memberId: canonicalMember._id,
      userId: canonicalUserId,
      organizationId: orgId,
      role: mergedRole,
      createdAt: canonicalMember.createdAt ?? createdAt,
    });
  }

  await deleteAdapterRow(ctx, 'member', [
    { field: '_id', value: duplicateMember._id, operator: 'eq' },
  ]);
  await deleteMemberMirrorByMemberId(ctx, duplicateMember._id);
}

async function repointSimpleUserIdRows(
  ctx: MutationCtx,
  model: 'account' | 'teamMember' | 'session',
  duplicateUserId: string,
  canonicalUserId: string,
): Promise<void> {
  const rows = await gatherByUserId<{ _id: string }>(
    ctx,
    model,
    duplicateUserId,
  );
  for (const row of rows) {
    if (!row?._id) continue;
    await updateAdapterRow(
      ctx,
      model,
      [{ field: '_id', value: row._id, operator: 'eq' }],
      {
        userId: canonicalUserId,
        ...(model === 'account' || model === 'session'
          ? { updatedAt: Date.now() }
          : {}),
      },
    );
  }
}

async function repointSsoProvisioningLinks(
  ctx: MutationCtx,
  duplicateUserId: string,
  canonicalUserId: string,
): Promise<void> {
  const links = await ctx.db
    .query('ssoProvisioningLinks')
    .filter((q) => q.eq(q.field('internalId'), duplicateUserId))
    .collect();
  for (const link of links) {
    const existing = await ctx.db
      .query('ssoProvisioningLinks')
      .withIndex('by_org_internal', (q) =>
        q
          .eq('organizationId', link.organizationId)
          .eq('internalId', canonicalUserId),
      )
      .first();
    if (existing) {
      await ctx.db.delete(link._id);
    } else {
      await ctx.db.patch(link._id, {
        internalId: canonicalUserId,
        updatedAt: Date.now(),
      });
    }
  }

  const mirrors = await ctx.db
    .query('memberMirror')
    .withIndex('by_userId', (q) => q.eq('userId', duplicateUserId))
    .collect();
  for (const mirror of mirrors) {
    await ctx.db.patch(mirror._id, {
      userId: canonicalUserId,
      updatedAt: Date.now(),
    });
  }

  const teamMirrors = await ctx.db
    .query('teamMemberMirror')
    .withIndex('by_userId', (q) => q.eq('userId', duplicateUserId))
    .collect();
  for (const mirror of teamMirrors) {
    await ctx.db.patch(mirror._id, {
      userId: canonicalUserId,
      updatedAt: Date.now(),
    });
  }
}

/**
 * Move every live auth edge from `duplicateUserId` onto `canonicalUserId`, then
 * delete the duplicate user row.
 */
export async function mergeDuplicateAuthUserIntoCanonical(
  ctx: MutationCtx,
  canonicalUserId: string,
  duplicateUserId: string,
): Promise<void> {
  if (canonicalUserId === duplicateUserId) return;

  const canonical = await findAuthUserById(ctx, canonicalUserId);
  const duplicate = await findAuthUserById(ctx, duplicateUserId);
  if (!canonical || !duplicate) return;

  const duplicateMembers = await gatherByUserId<BetterAuthMember>(
    ctx,
    'member',
    duplicateUserId,
  );
  for (const member of duplicateMembers) {
    if (!member?._id) continue;
    await repointMember(ctx, member, canonicalUserId);
  }

  await repointSimpleUserIdRows(
    ctx,
    'account',
    duplicateUserId,
    canonicalUserId,
  );
  const duplicateTeamMembers = await gatherByUserId<BetterAuthTeamMemberRow>(
    ctx,
    'teamMember',
    duplicateUserId,
  );
  for (const teamMember of duplicateTeamMembers) {
    if (!teamMember?._id || !teamMember.teamId) continue;
    await repointTeamMember(ctx, teamMember, canonicalUserId);
  }
  await repointSimpleUserIdRows(
    ctx,
    'session',
    duplicateUserId,
    canonicalUserId,
  );
  await repointSsoProvisioningLinks(ctx, duplicateUserId, canonicalUserId);

  const normalized = normalizeAuthEmail(canonical.email);
  const fields = mergeCanonicalUserFields(canonical, duplicate, normalized);
  await ctx.runMutation(components.betterAuth.adapter.updateMany, {
    input: {
      model: 'user',
      where: [{ field: '_id', value: canonicalUserId, operator: 'eq' }],
      update: { ...fields, updatedAt: Date.now() },
    },
    paginationOpts: { cursor: null, numItems: 1 },
  });

  await deleteAdapterRow(ctx, 'user', [
    { field: '_id', value: duplicateUserId, operator: 'eq' },
  ]);
}

export async function mergeAuthUsersManual(
  ctx: MutationCtx,
  canonicalUserId: string,
  duplicateUserId: string,
): Promise<{ merged: boolean }> {
  const canonical = await findAuthUserById(ctx, canonicalUserId);
  const duplicate = await findAuthUserById(ctx, duplicateUserId);
  if (!canonical || !duplicate) {
    return { merged: false };
  }
  if (
    normalizeAuthEmail(canonical.email) !== normalizeAuthEmail(duplicate.email)
  ) {
    throw new Error('Users do not share the same normalized email');
  }
  await mergeDuplicateAuthUserIntoCanonical(
    ctx,
    canonicalUserId,
    duplicateUserId,
  );
  return { merged: true };
}
