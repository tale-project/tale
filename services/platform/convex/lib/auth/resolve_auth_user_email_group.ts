import { getString, isRecord } from '../../../lib/utils/type-utils';
import { components } from '../../_generated/api';
import type { MutationCtx } from '../../_generated/server';
import type {
  BetterAuthMember,
  BetterAuthFindManyResult,
  BetterAuthUser,
} from '../../members/types';
import { snapshotBetterAuthRow } from '../../migrations/framework/snapshot_helpers';
import {
  findAuthUserById,
  findUsersByNormalizedEmail,
} from './find_user_by_normalized_email';
import {
  assessAuthUserMergeSafety,
  resolveEmailGroupAction,
  selectCanonicalAuthUser,
} from './merge_auth_email_duplicates';
import { mergeCanonicalUserFields } from './merge_auth_email_duplicates';
import type { MergeSkipReason } from './merge_auth_email_duplicates';
import { mergeDuplicateAuthUserIntoCanonical } from './merge_auth_users';
import { normalizeAuthEmail } from './normalize_auth_email';

export type EmailNormalizationStats = {
  renamed: number;
  merged: number;
  skipped: number;
  noop: number;
};

function emptyStats(): EmailNormalizationStats {
  return { renamed: 0, merged: 0, skipped: 0, noop: 0 };
}

async function listMembersForUser(
  ctx: MutationCtx,
  userId: string,
): Promise<BetterAuthMember[]> {
  const res: BetterAuthFindManyResult<BetterAuthMember> = await ctx.runQuery(
    components.betterAuth.adapter.findMany,
    {
      model: 'member',
      paginationOpts: { cursor: null, numItems: 500 },
      where: [{ field: 'userId', value: userId, operator: 'eq' }],
    },
  );
  return res.page ?? [];
}

async function buildMembershipMap(
  ctx: MutationCtx,
  userIds: readonly string[],
): Promise<Map<string, BetterAuthMember[]>> {
  const map = new Map<string, BetterAuthMember[]>();
  for (const userId of userIds) {
    map.set(userId, await listMembersForUser(ctx, userId));
  }
  return map;
}

async function renameUserEmail(
  ctx: MutationCtx,
  userId: string,
  email: string,
): Promise<void> {
  await ctx.runMutation(components.betterAuth.adapter.updateMany, {
    input: {
      model: 'user',
      where: [{ field: '_id', value: userId, operator: 'eq' }],
      update: { email, updatedAt: Date.now() },
    },
    paginationOpts: { cursor: null, numItems: 1 },
  });
}

export async function resolveAuthUserEmailGroup(
  ctx: MutationCtx,
  userId: string,
  migrationId?: string,
): Promise<{
  action: 'renamed' | 'merged' | 'skipped' | 'noop';
  reason?: MergeSkipReason;
}> {
  const user = await findAuthUserById(ctx, userId);
  if (!user) return { action: 'noop' };

  const group = await findUsersByNormalizedEmail(ctx, user.email);
  const normalized = normalizeAuthEmail(user.email);
  const membershipMap = await buildMembershipMap(
    ctx,
    group.map((u) => u._id),
  );
  const safety = assessAuthUserMergeSafety(
    membershipMap,
    group.map((u) => u._id),
  );
  const planned = resolveEmailGroupAction(group, safety);

  if (planned === 'noop') return { action: 'noop' };
  if (planned === 'rename') {
    await renameUserEmail(ctx, user._id, normalized);
    return { action: 'renamed' };
  }
  if (planned === 'skip') {
    return {
      action: 'skipped',
      reason: safety.safe ? undefined : safety.reason,
    };
  }

  const canonical = selectCanonicalAuthUser(group);
  if (!canonical) return { action: 'noop' };

  for (const duplicate of group) {
    if (duplicate._id === canonical._id) continue;
    const stillThere = await findAuthUserById(ctx, duplicate._id);
    if (!stillThere) continue;
    if (migrationId) {
      await snapshotBetterAuthRow(ctx, migrationId, 'user', {
        ...stillThere,
      });
    }
    await mergeDuplicateAuthUserIntoCanonical(
      ctx,
      canonical._id,
      duplicate._id,
    );
  }

  const refreshed = await findAuthUserById(ctx, canonical._id);
  if (refreshed) {
    const lastDup = group.find((u) => u._id !== canonical._id);
    const fields = mergeCanonicalUserFields(
      refreshed,
      lastDup ?? refreshed,
      normalized,
    );
    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'user',
        where: [{ field: '_id', value: canonical._id, operator: 'eq' }],
        update: { ...fields, updatedAt: Date.now() },
      },
      paginationOpts: { cursor: null, numItems: 1 },
    });
  }

  return { action: 'merged' };
}

export async function applyAuthEmailNormalizationBatch(
  ctx: MutationCtx,
  cursor: string | null,
  batchSize: number,
  migrationId?: string,
): Promise<{
  isDone: boolean;
  continueCursor: string | null;
  processed: number;
  stats: EmailNormalizationStats;
}> {
  const res: BetterAuthFindManyResult<BetterAuthUser> = await ctx.runQuery(
    components.betterAuth.adapter.findMany,
    {
      model: 'user',
      paginationOpts: { cursor, numItems: batchSize },
      where: [],
    },
  );

  const stats = emptyStats();
  for (const raw of res.page ?? []) {
    if (!isRecord(raw)) continue;
    const userId = getString(raw, '_id');
    if (!userId) continue;
    const result = await resolveAuthUserEmailGroup(ctx, userId, migrationId);
    if (result.action === 'renamed') stats.renamed++;
    else if (result.action === 'merged') stats.merged++;
    else if (result.action === 'skipped') stats.skipped++;
    else stats.noop++;
  }

  return {
    isDone: Boolean(res.isDone),
    continueCursor: res.isDone ? null : (res.continueCursor ?? null),
    processed: res.page?.length ?? 0,
    stats,
  };
}
