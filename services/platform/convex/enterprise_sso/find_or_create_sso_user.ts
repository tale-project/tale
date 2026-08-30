import { isRecord, getString } from '../../lib/utils/type-utils';
import { normalizeAuthEmail } from '../lib/auth/normalize_auth_email';
import type { MutationCtx } from '../lib/ctx';
import { components } from '../lib/handler_names';
import { upsertMemberMirror } from '../members/mirror_sync';
import type { PlatformRole } from './types';

function extractMemberId(created: unknown): string | undefined {
  if (!isRecord(created)) return undefined;
  return getString(created, '_id') ?? getString(created, 'id');
}

type FindOrCreateSsoUserArgs = {
  email: string;
  name: string;
  externalId: string;
  providerId: string;
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number;
  /** Space-separated scopes granted with the access token (when the IdP
   *  reports them) — lets Graph-backed features check for a specific grant. */
  scope?: string;
  organizationId: string;
  role: PlatformRole;
  /**
   * Re-apply `role` to an existing membership on every login (set when the org
   * enables "auto-assign roles from the IdP"), so an IdP promotion/demotion
   * propagates instead of sticking at the role from the user's first login.
   */
  syncRole?: boolean;
};

function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/**
 * Whether to overwrite an existing membership's role with the IdP-mapped role on
 * login. Only when "auto-assign roles from the IdP" is on (`syncRole`), never
 * for an `owner` (that would orphan the org), and not for a no-op.
 */
export function shouldSyncMemberRole(
  syncRole: boolean | undefined,
  currentRole: string | undefined,
  newRole: string,
): boolean {
  return (
    Boolean(syncRole) && currentRole !== 'owner' && currentRole !== newRole
  );
}

type FindOrCreateSsoUserResult = {
  userId: string | null;
  isNewUser: boolean;
};

export async function findOrCreateSsoUser(
  ctx: MutationCtx,
  args: FindOrCreateSsoUserArgs,
): Promise<FindOrCreateSsoUserResult> {
  const email = normalizeAuthEmail(args.email);
  const existingUserRes = await ctx.runQuery(
    components.betterAuth.adapter.findMany,
    {
      model: 'user',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [{ field: 'email', value: email, operator: 'eq' }],
    },
  );

  const existingUserRaw = existingUserRes?.page?.[0];
  const existingUserRec = isRecord(existingUserRaw)
    ? existingUserRaw
    : undefined;
  const existingUserId = existingUserRec
    ? (getString(existingUserRec, '_id') ?? getString(existingUserRec, 'id'))
    : undefined;

  if (existingUserId) {
    const existingAccountRes = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'account',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [
          { field: 'userId', value: existingUserId, operator: 'eq' },
          { field: 'providerId', value: args.providerId, operator: 'eq' },
        ],
      },
    );

    const existingAccountRaw = existingAccountRes?.page?.[0];
    const existingAccount = isRecord(existingAccountRaw)
      ? existingAccountRaw
      : undefined;

    if (!existingAccount) {
      const now = Date.now();
      await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: 'account',
          data: {
            userId: existingUserId,
            providerId: args.providerId,
            accountId: args.externalId,
            accessToken: args.accessToken,
            refreshToken: args.refreshToken ?? null,
            accessTokenExpiresAt: args.accessTokenExpiresAt ?? null,
            scope: args.scope ?? null,
            createdAt: now,
            updatedAt: now,
          },
        },
      });
    } else {
      const accountId = getString(existingAccount, '_id');
      if (!accountId) throw new Error('Account missing _id');
      await ctx.runMutation(components.betterAuth.adapter.updateMany, {
        input: {
          model: 'account' as const,
          where: [{ field: '_id', value: accountId, operator: 'eq' }],
          update: {
            accessToken: args.accessToken,
            refreshToken: args.refreshToken ?? null,
            accessTokenExpiresAt: args.accessTokenExpiresAt ?? null,
            scope: args.scope ?? null,
            updatedAt: Date.now(),
          },
        },
        paginationOpts: { cursor: null, numItems: 1 },
      });
    }

    const membershipRes = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [
          { field: 'userId', value: existingUserId, operator: 'eq' },
          {
            field: 'organizationId',
            value: args.organizationId,
            operator: 'eq',
          },
        ],
      },
    );

    const existingMembershipRaw = membershipRes?.page?.[0];
    const existingMembership = isRecord(existingMembershipRaw)
      ? existingMembershipRaw
      : undefined;

    if (!existingMembership) {
      const memberCreatedAt = Date.now();
      const createdMember = await ctx.runMutation(
        components.betterAuth.adapter.create,
        {
          input: {
            model: 'member',
            data: {
              organizationId: args.organizationId,
              userId: existingUserId,
              role: args.role,
              createdAt: memberCreatedAt,
            },
          },
        },
      );
      const memberId = extractMemberId(createdMember);
      if (memberId) {
        await upsertMemberMirror(ctx, {
          memberId,
          userId: existingUserId,
          organizationId: args.organizationId,
          role: args.role,
          createdAt: memberCreatedAt,
        });
      }
    } else if (args.syncRole) {
      // "Auto-assign roles from the IdP" is authoritative: re-apply the mapped
      // role to the existing membership so an IdP promotion/demotion takes
      // effect on the next login. Never touch an `owner` (that would orphan the
      // org), and skip a no-op write.
      const memberId = extractMemberId(existingMembership);
      const currentRole = getString(existingMembership, 'role');
      if (
        memberId &&
        shouldSyncMemberRole(args.syncRole, currentRole, args.role)
      ) {
        await ctx.runMutation(components.betterAuth.adapter.updateMany, {
          input: {
            model: 'member' as const,
            where: [{ field: '_id', value: memberId, operator: 'eq' }],
            update: { role: args.role },
          },
          paginationOpts: { cursor: null, numItems: 1 },
        });
        await upsertMemberMirror(ctx, {
          memberId,
          userId: existingUserId,
          organizationId: args.organizationId,
          role: args.role,
          createdAt: num(existingMembership.createdAt) ?? Date.now(),
        });
      }
    }

    return { userId: existingUserId, isNewUser: false };
  }

  const now = Date.now();
  const createResult = await ctx.runMutation(
    components.betterAuth.adapter.create,
    {
      input: {
        model: 'user',
        data: {
          email,
          name: args.name,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      },
    },
  );

  const createResultRec = isRecord(createResult) ? createResult : undefined;
  const userId =
    (createResultRec ? getString(createResultRec, '_id') : undefined) ??
    (createResultRec ? getString(createResultRec, 'id') : undefined);
  if (!userId) {
    throw new Error('Failed to extract userId from user creation result');
  }

  await ctx.runMutation(components.betterAuth.adapter.create, {
    input: {
      model: 'account',
      data: {
        userId,
        providerId: args.providerId,
        accountId: args.externalId,
        accessToken: args.accessToken,
        refreshToken: args.refreshToken ?? null,
        accessTokenExpiresAt: args.accessTokenExpiresAt ?? null,
        scope: args.scope ?? null,
        createdAt: now,
        updatedAt: now,
      },
    },
  });

  const createdMember = await ctx.runMutation(
    components.betterAuth.adapter.create,
    {
      input: {
        model: 'member',
        data: {
          organizationId: args.organizationId,
          userId,
          role: args.role,
          createdAt: now,
        },
      },
    },
  );
  const memberId = extractMemberId(createdMember);
  if (memberId) {
    await upsertMemberMirror(ctx, {
      memberId,
      userId,
      organizationId: args.organizationId,
      role: args.role,
      createdAt: now,
    });
  }

  return { userId, isNewUser: true };
}
