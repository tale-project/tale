import { v } from 'convex/values';

import {
  SSO_CONFIG_DOMAIN,
  SSO_CONNECTION_KEY,
  ssoConnectionFileSchema,
} from '../../lib/shared/schemas/enterprise_sso';
import { internalQuery } from '../_generated/server';
import { platformRoleValidator } from '../enterprise_sso/validators';
import { readConfigCacheRow } from '../lib/config_cache/read';
import type { BetterAuthMember, BetterAuthUser } from '../members/types';
import {
  buildOrgUserMap,
  findMember,
  findTeamById,
  findTeamByName,
  findUserByEmail,
  findUserById,
  listOrgMembers,
  listOrgTeams,
  listTeamMembers,
  type BetterAuthTeam,
} from './data';
import { getLink } from './links';
import type { ScimGroupRecord, ScimUserRecord } from './types';

const userRecordValidator = v.object({
  userId: v.string(),
  email: v.string(),
  name: v.string(),
  active: v.boolean(),
  externalId: v.optional(v.string()),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
});

const groupRecordValidator = v.object({
  teamId: v.string(),
  displayName: v.string(),
  memberUserIds: v.array(v.string()),
  externalId: v.optional(v.string()),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
});

function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function buildUserRecord(
  user: BetterAuthUser,
  member: BetterAuthMember,
  externalId: string | undefined,
): ScimUserRecord {
  return {
    userId: user._id,
    email: user.email,
    name: user.name,
    active: (member.role ?? '').toLowerCase() !== 'disabled',
    externalId,
    createdAt: num(user.createdAt),
    updatedAt: num(user.updatedAt),
  };
}

function buildGroupRecord(
  team: BetterAuthTeam,
  memberUserIds: string[],
  externalId: string | undefined,
): ScimGroupRecord {
  return {
    teamId: team._id,
    displayName: team.name,
    memberUserIds,
    externalId,
    createdAt: num(team.createdAt),
    updatedAt: num(team.updatedAt),
  };
}

/**
 * Resolve the org + default role for an inbound SCIM token by its SHA-256 hash.
 * The matched `ssoConnections` row IS the tenant scope (token state); a disabled
 * connection stores an empty hash so no real token can match it. The default
 * role is part of the file-based provisioning policy, read from `configCache`.
 */
export const getConfigByTokenHash = internalQuery({
  args: { tokenHash: v.string() },
  returns: v.union(
    v.object({
      configId: v.id('ssoConnections'),
      organizationId: v.string(),
      defaultRole: platformRoleValidator,
      enabled: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    if (!args.tokenHash) return null;
    const row = await ctx.db
      .query('ssoConnections')
      .withIndex('by_scimTokenHash', (q) =>
        q.eq('scimTokenHash', args.tokenHash),
      )
      .first();
    if (!row) return null;
    const cacheRow = await readConfigCacheRow(
      ctx.db,
      row.organizationId,
      SSO_CONFIG_DOMAIN,
      SSO_CONNECTION_KEY,
    );
    const parsed = cacheRow
      ? ssoConnectionFileSchema.safeParse(cacheRow.config)
      : null;
    const defaultRole =
      parsed && parsed.success
        ? parsed.data.provisioning.defaultRole
        : 'member';
    return {
      configId: row._id,
      organizationId: row.organizationId,
      defaultRole,
      enabled: row.scimEnabled,
    };
  },
});

export const getUserRecord = internalQuery({
  args: { organizationId: v.string(), userId: v.string() },
  returns: v.union(userRecordValidator, v.null()),
  handler: async (ctx, args) => {
    const member = await findMember(ctx, args.organizationId, args.userId);
    if (!member) return null;
    const user = await findUserById(ctx, args.userId);
    if (!user) return null;
    const link = await getLink(ctx, args.organizationId, args.userId);
    return buildUserRecord(user, member, link?.externalId);
  },
});

export const findUserRecordByUserName = internalQuery({
  args: { organizationId: v.string(), userName: v.string() },
  returns: v.union(userRecordValidator, v.null()),
  handler: async (ctx, args) => {
    const user = await findUserByEmail(ctx, args.userName);
    if (!user) return null;
    const member = await findMember(ctx, args.organizationId, user._id);
    if (!member) return null;
    const link = await getLink(ctx, args.organizationId, user._id);
    return buildUserRecord(user, member, link?.externalId);
  },
});

export const listUserRecords = internalQuery({
  args: { organizationId: v.string() },
  returns: v.array(userRecordValidator),
  handler: async (ctx, args) => {
    const members = await listOrgMembers(ctx, args.organizationId);
    const userMap = await buildOrgUserMap(ctx);
    const records: ScimUserRecord[] = [];
    for (const member of members) {
      const user = userMap.get(member.userId);
      if (!user) continue;
      const link = await getLink(ctx, args.organizationId, member.userId);
      records.push(buildUserRecord(user, member, link?.externalId));
    }
    return records;
  },
});

export const getGroupRecord = internalQuery({
  args: { organizationId: v.string(), teamId: v.string() },
  returns: v.union(groupRecordValidator, v.null()),
  handler: async (ctx, args) => {
    const team = await findTeamById(ctx, args.teamId);
    if (!team || team.organizationId !== args.organizationId) return null;
    const members = await listTeamMembers(ctx, args.teamId);
    const link = await getLink(ctx, args.organizationId, args.teamId);
    return buildGroupRecord(
      team,
      members.map((m) => m.userId),
      link?.externalId,
    );
  },
});

export const findGroupRecordByDisplayName = internalQuery({
  args: { organizationId: v.string(), displayName: v.string() },
  returns: v.union(groupRecordValidator, v.null()),
  handler: async (ctx, args) => {
    const team = await findTeamByName(
      ctx,
      args.organizationId,
      args.displayName,
    );
    if (!team) return null;
    const members = await listTeamMembers(ctx, team._id);
    const link = await getLink(ctx, args.organizationId, team._id);
    return buildGroupRecord(
      team,
      members.map((m) => m.userId),
      link?.externalId,
    );
  },
});

export const listGroupRecords = internalQuery({
  args: { organizationId: v.string() },
  returns: v.array(groupRecordValidator),
  handler: async (ctx, args) => {
    const teams = await listOrgTeams(ctx, args.organizationId);
    const records: ScimGroupRecord[] = [];
    for (const team of teams) {
      const members = await listTeamMembers(ctx, team._id);
      const link = await getLink(ctx, args.organizationId, team._id);
      records.push(
        buildGroupRecord(
          team,
          members.map((m) => m.userId),
          link?.externalId,
        ),
      );
    }
    return records;
  },
});
