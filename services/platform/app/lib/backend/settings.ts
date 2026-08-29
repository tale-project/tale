/**
 * Settings vertical over the 0.5 backend — part 1: the ORGANIZATION + TEAMS
 * pages (member administration, team membership, member 2FA/passkey admin).
 * Response types are DERIVED from the 0.4 function signatures; the member
 * directory row itself lives in `documents.ts` (the record-review picker
 * landed it first) — this file carries the rest of the family.
 */

import type { FunctionReturnType } from 'convex/server';

import type { api } from '@/convex/_generated/api';

import { backendFetch } from './api-client';
import type {
  AdapterContext,
  ReadAdapter,
  WriteAdapter,
} from './convex-adapters';
import { backendEntityPrefix, backendKey } from './query-keys';

type OrgTeamItem = FunctionReturnType<
  typeof api.members.queries.listOrgTeams
>[number];
type TeamMemberItem = FunctionReturnType<
  typeof api.team_members.queries.listByTeam
>[number];
type MemberPasskeyItem = FunctionReturnType<
  typeof api.two_factor.queries.listPasskeysForMember
>[number];
type CreateMemberResult = FunctionReturnType<
  typeof api.users.mutations.createMember
>;
type MyPreferencesResult = FunctionReturnType<
  typeof api.user_preferences.queries.getMyPreferences
>;
type NotificationPrefsResult = FunctionReturnType<
  typeof api.collab.preferences.getNotificationPreferences
>;
type MyEnvItem = FunctionReturnType<
  typeof api.sandbox.user_env.listMyEnv
>[number];
type AppPasswordItem = FunctionReturnType<
  typeof api.webdav.app_password_queries.listAppPasswords
>[number];
type CreateAppPasswordResult = FunctionReturnType<
  typeof api.webdav.app_password_mutations.createAppPassword
>;

function orgOf(
  args: Record<string, unknown>,
  ctx: AdapterContext,
): string | undefined {
  const fromArgs = args.organizationId;
  if (typeof fromArgs === 'string' && fromArgs.length > 0) return fromArgs;
  return ctx.organizationId;
}

function requireOrg(
  args: Record<string, unknown>,
  ctx: AdapterContext,
): string {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) {
    throw new Error('No active organization for adapted write');
  }
  return orgId;
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing ${key} for adapted write`);
  }
  return value;
}

/** Like `stringArg` but an empty string is a legal value (clearing a field). */
function stringArgOrEmpty(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value : '';
}

/** One team-member row as the pg backend returns it. */
interface TeamMemberWire {
  id: string;
  teamId: string;
  userId: string;
  role: string;
  joinedAt: number;
  displayName?: string;
  email?: string;
}

export const settingsReadAdapters: Record<string, ReadAdapter> = {
  'members/queries:listOrgTeams': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'team', 'org-list'),
      queryFn: () =>
        backendFetch<{ teams: OrgTeamItem[] }>('/teams', { orgId }).then(
          (body) => body.teams,
        ),
    };
  },
  'members/queries:approxCountMyTeams': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'team', 'count-mine'),
      queryFn: () =>
        backendFetch<{ count: number }>('/teams/count/mine', { orgId }).then(
          (body) => body.count,
        ),
    };
  },
  'members/queries:getUserIdByEmail': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const email = args.email;
    if (orgId === undefined || typeof email !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'member', 'user-id-by-email', email),
      queryFn: () =>
        backendFetch<{ userId: string | null }>(
          `/members/user-id-by-email?email=${encodeURIComponent(email)}`,
          { orgId },
        ).then((body) => body.userId),
    };
  },
  'team_members/queries:listByTeam': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const teamId = args.teamId;
    if (orgId === undefined || typeof teamId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'team', 'members', teamId),
      queryFn: () =>
        backendFetch<{ members: TeamMemberWire[] }>(
          `/teams/${encodeURIComponent(teamId)}/members`,
          { orgId },
        ).then((body) =>
          body.members.map((row): TeamMemberItem => ({
            _id: row.id,
            teamId: row.teamId,
            userId: row.userId,
            role: row.role,
            joinedAt: row.joinedAt,
            ...(row.displayName !== undefined
              ? { displayName: row.displayName }
              : {}),
            ...(row.email !== undefined ? { email: row.email } : {}),
          })),
        ),
    };
  },
  'user_preferences/queries:getMyPreferences': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'user_preference', 'mine'),
      queryFn: () =>
        backendFetch<{ preferences: MyPreferencesResult }>(
          '/user-preferences',
          { orgId },
        ).then((body) => body.preferences),
    };
  },
  'collab/preferences:getNotificationPreferences': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'notification_preference', 'mine'),
      queryFn: () =>
        backendFetch<NotificationPrefsResult>('/collab/preferences', {
          orgId,
        }),
    };
  },
  'sandbox/user_env:listMyEnv': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'sandbox_user_env', 'mine'),
      queryFn: () =>
        backendFetch<{ env: MyEnvItem[] }>('/sandbox/user-env', {
          orgId,
        }).then((body) => body.env),
    };
  },
  'webdav/app_password_queries:listAppPasswords': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'webdav_app_password', 'mine'),
      queryFn: () =>
        backendFetch<{ appPasswords: AppPasswordItem[] }>(
          '/webdav/app-passwords',
          { orgId },
        ).then((body) => body.appPasswords),
    };
  },
  'two_factor/queries:listPasskeysForMember': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const memberId = args.memberId;
    if (orgId === undefined || typeof memberId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'member', 'passkeys', memberId),
      queryFn: () =>
        backendFetch<{ passkeys: MemberPasskeyItem[] }>(
          `/members/${encodeURIComponent(memberId)}/passkeys`,
          { orgId },
        ).then((body) => body.passkeys),
    };
  },
};

function invalidateMembers(
  client: Parameters<NonNullable<WriteAdapter['invalidate']>>[0],
  args: Record<string, unknown>,
  ctx: AdapterContext,
): void {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) return;
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'member'),
  });
}

function invalidateUserPrefs(
  client: Parameters<NonNullable<WriteAdapter['invalidate']>>[0],
  args: Record<string, unknown>,
  ctx: AdapterContext,
): void {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) return;
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'user_preference'),
  });
}

function invalidateUserEnv(
  client: Parameters<NonNullable<WriteAdapter['invalidate']>>[0],
  args: Record<string, unknown>,
  ctx: AdapterContext,
): void {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) return;
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'sandbox_user_env'),
  });
}

function invalidateWebdav(
  client: Parameters<NonNullable<WriteAdapter['invalidate']>>[0],
  args: Record<string, unknown>,
  ctx: AdapterContext,
): void {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) return;
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'webdav_app_password'),
  });
}

function invalidateTeams(
  client: Parameters<NonNullable<WriteAdapter['invalidate']>>[0],
  args: Record<string, unknown>,
  ctx: AdapterContext,
): void {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) return;
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'team'),
  });
}

export const settingsWriteAdapters: Record<string, WriteAdapter> = {
  'members/mutations:updateMemberRole': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/members/${encodeURIComponent(stringArg(args, 'memberId'))}/role`,
        {
          orgId: requireOrg(args, ctx),
          body: { role: stringArg(args, 'role') },
        },
      ).then(() => null),
    invalidate: invalidateMembers,
  },
  'members/mutations:updateMemberDisplayName': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/members/${encodeURIComponent(stringArg(args, 'memberId'))}/display-name`,
        {
          orgId: requireOrg(args, ctx),
          body: { displayName: stringArg(args, 'displayName') },
        },
      ).then(() => null),
    invalidate: invalidateMembers,
  },
  'members/mutations:transferOwnership': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/members/${encodeURIComponent(stringArg(args, 'targetMemberId'))}/transfer-ownership`,
        { orgId: requireOrg(args, ctx), body: {} },
      ).then(() => null),
    invalidate: invalidateMembers,
  },
  'members/mutations:removeMember': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/members/${encodeURIComponent(stringArg(args, 'memberId'))}`,
        { orgId: requireOrg(args, ctx), method: 'DELETE' },
      ).then(() => null),
    invalidate: invalidateMembers,
  },
  'users/mutations:createMember': {
    run: (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      return backendFetch<CreateMemberResult>('/users/members', {
        orgId,
        body: {
          organizationId: orgId,
          email: stringArg(args, 'email'),
          ...(typeof args.password === 'string'
            ? { password: args.password }
            : {}),
          ...(typeof args.displayName === 'string'
            ? { displayName: args.displayName }
            : {}),
          ...(typeof args.role === 'string' ? { role: args.role } : {}),
        },
      });
    },
    invalidate: invalidateMembers,
  },
  'users/mutations:setMemberPassword': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/users/members/${encodeURIComponent(stringArg(args, 'memberId'))}/password`,
        {
          orgId: requireOrg(args, ctx),
          body: { newPassword: stringArg(args, 'newPassword') },
        },
      ).then(() => null),
    invalidate: invalidateMembers,
  },
  'two_factor/mutations:revokePasskeyForMember': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/members/${encodeURIComponent(stringArg(args, 'memberId'))}/passkeys/${encodeURIComponent(stringArg(args, 'passkeyId'))}/revoke`,
        { orgId: requireOrg(args, ctx), body: {} },
      ).then(() => null),
    invalidate: invalidateMembers,
  },
  'two_factor/mutations:resetForUser': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/members/${encodeURIComponent(stringArg(args, 'memberId'))}/two-factor/reset`,
        { orgId: requireOrg(args, ctx), body: {} },
      ).then(() => null),
    invalidate: invalidateMembers,
  },
  'team_members/mutations:addMember': {
    run: (args, ctx) =>
      backendFetch<{ teamMemberId?: string }>(
        `/teams/${encodeURIComponent(stringArg(args, 'teamId'))}/members`,
        {
          orgId: requireOrg(args, ctx),
          body: { userId: stringArg(args, 'userId') },
        },
      ).then(() => null),
    invalidate: invalidateTeams,
  },
  'user_preferences/mutations:upsertMyPreferences': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>('/user-preferences/custom-instructions', {
        orgId: requireOrg(args, ctx),
        body: {
          customInstructions: stringArgOrEmpty(args, 'customInstructions'),
        },
      }).then(() => null),
    invalidate: invalidateUserPrefs,
  },
  'user_preferences/mutations:setMemoriesEnabled': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>('/user-preferences/memories-enabled', {
        orgId: requireOrg(args, ctx),
        body: { enabled: args.enabled === true },
      }).then(() => null),
    invalidate: invalidateUserPrefs,
  },
  'user_preferences/mutations:setCustomInstructionsEnabled': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        '/user-preferences/custom-instructions-enabled',
        {
          orgId: requireOrg(args, ctx),
          body: { enabled: args.enabled === true },
        },
      ).then(() => null),
    invalidate: invalidateUserPrefs,
  },
  'collab/preferences:setNotificationPreferences': {
    run: (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const { organizationId: _organizationId, ...prefs } = args;
      return backendFetch<{ ok: boolean }>('/collab/preferences', {
        orgId,
        body: prefs,
      }).then(() => null);
    },
    invalidate: (client, args, ctx) => {
      const orgId = orgOf(args, ctx);
      if (orgId === undefined) return;
      void client.invalidateQueries({
        queryKey: backendEntityPrefix(orgId, 'notification_preference'),
      });
    },
  },
  'users/mutations:updateUserName': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>('/users/update-name', {
        orgId: requireOrg(args, ctx),
        body: { name: stringArg(args, 'name') },
      }).then(() => null),
  },
  'users/mutations:updateUserPassword': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>('/users/update-password', {
        orgId: requireOrg(args, ctx),
        body: {
          ...(typeof args.currentPassword === 'string'
            ? { currentPassword: args.currentPassword }
            : {}),
          newPassword: stringArg(args, 'newPassword'),
        },
      }).then(() => null),
  },
  'sandbox/user_env_actions:upsertMyEnvVar': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>('/sandbox/user-env', {
        orgId: requireOrg(args, ctx),
        body: {
          key: stringArg(args, 'key'),
          value: typeof args.value === 'string' ? args.value : '',
          isSecret: args.isSecret === true,
        },
      }).then(() => null),
    invalidate: invalidateUserEnv,
  },
  'sandbox/user_env:deleteMyEnvVar': {
    run: (args, ctx) =>
      backendFetch<{ deleted: boolean }>(
        `/sandbox/user-env/${encodeURIComponent(stringArg(args, 'key'))}`,
        { orgId: requireOrg(args, ctx), method: 'DELETE' },
      ).then(() => null),
    invalidate: invalidateUserEnv,
  },
  'webdav/app_password_mutations:createAppPassword': {
    run: (args, ctx) =>
      backendFetch<CreateAppPasswordResult>('/webdav/app-passwords', {
        orgId: requireOrg(args, ctx),
        body: { label: stringArg(args, 'label') },
      }),
    invalidate: invalidateWebdav,
  },
  'webdav/app_password_mutations:revokeAppPassword': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/webdav/app-passwords/${encodeURIComponent(stringArg(args, 'id'))}/revoke`,
        { orgId: requireOrg(args, ctx), body: {} },
      ).then(() => null),
    invalidate: invalidateWebdav,
  },
  'team_members/mutations:removeMember': {
    run: (args, ctx) =>
      backendFetch<{ removed: boolean }>(
        `/teams/members/by-id/${encodeURIComponent(stringArg(args, 'teamMemberId'))}`,
        { orgId: requireOrg(args, ctx), method: 'DELETE' },
      ).then(() => null),
    invalidate: invalidateTeams,
  },
};
