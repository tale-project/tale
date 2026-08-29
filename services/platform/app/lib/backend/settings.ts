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
  ActionQueryAdapter,
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
type ProviderCatalogItem = FunctionReturnType<
  typeof api.lib.providers.catalog_actions.listProviderCatalogs
>[number];
type RefreshCatalogsResult = FunctionReturnType<
  typeof api.lib.providers.catalog_actions.refreshProviderCatalogs
>;
type HarnessStatusItem = FunctionReturnType<
  typeof api.lib.providers.harness_status.listHarnessStatus
>[number];
type VisionModelPickResult = FunctionReturnType<
  typeof api.lib.providers.vision_actions.getResolvedVisionModel
>;
type ConnectorSummaryItem = FunctionReturnType<
  typeof api.connector_credentials.connector_catalog.listConnectors
>[number];
type HarnessHealthResult = FunctionReturnType<
  typeof api.sandbox.session_queries_public.getHarnessHealth
>;
type QuotaUsageResult = FunctionReturnType<
  typeof api.sandbox.session_queries_public.getSandboxQuotaUsage
>;
type SandboxListResult = FunctionReturnType<
  typeof api.sandbox.session_queries_public.listSandboxesForOrg
>;
type ProviderCredentialItem = FunctionReturnType<
  typeof api.provider_credentials.queries.listCredentials
>[number];
type ConnectorCredentialItem = FunctionReturnType<
  typeof api.connector_credentials.queries.listCredentials
>[number];
type CreateProviderCredentialResult = FunctionReturnType<
  typeof api.provider_credentials.actions.createCredential
>;
type CreateConnectorCredentialResult = FunctionReturnType<
  typeof api.connector_credentials.actions.createCredential
>;
type GovernancePolicyResult = FunctionReturnType<
  typeof api.governance.queries.getPolicy
>;
type MyFeatureFlagsResult = FunctionReturnType<
  typeof api.governance.queries.getMyFeatureFlags
>;
type MyBudgetStatusResult = FunctionReturnType<
  typeof api.governance.queries.getMyBudgetStatus
>;
type TrashListResult = FunctionReturnType<
  typeof api.governance.queries.listTrashedRows
>;

const CONNECTOR_SECRET_KEYS = [
  'token',
  'username',
  'password',
  'smtpUsername',
  'smtpPassword',
  'accessToken',
  'refreshToken',
  'expiresAt',
  'scopes',
] as const;

/** The 0.4 connector actions carry secret fields FLAT; the pg routes take a
 * nested `secret` object — restructure without ever logging values. */
function connectorSecretOf(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const secret: Record<string, unknown> = {};
  for (const key of CONNECTOR_SECRET_KEYS) {
    if (args[key] !== undefined) secret[key] = args[key];
  }
  return secret;
}

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
  'governance/queries:getPolicy': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const policyType = args.policyType;
    if (orgId === undefined || typeof policyType !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'governance_policy', policyType),
      queryFn: () =>
        backendFetch<{ policy: GovernancePolicyResult }>(
          `/governance/policies/${encodeURIComponent(policyType)}`,
          { orgId },
        ).then((body) => body.policy),
    };
  },
  'governance/queries:getMyFeatureFlags': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'governance_policy', 'my-flags'),
      queryFn: () =>
        backendFetch<{ flags: MyFeatureFlagsResult }>(
          '/governance/my/feature-flags',
          { orgId },
        ).then((body) => body.flags),
    };
  },
  'governance/queries:getMyBudgetStatus': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const selectedTeamId =
      typeof args.selectedTeamId === 'string' ? args.selectedTeamId : null;
    return {
      queryKey: backendKey(orgId, 'usage', 'my-budget-status', selectedTeamId),
      queryFn: () =>
        backendFetch<{ status: MyBudgetStatusResult }>(
          selectedTeamId === null
            ? '/governance/my/budget-status'
            : `/governance/my/budget-status?selectedTeamId=${encodeURIComponent(selectedTeamId)}`,
          { orgId },
        ).then((body) => body.status),
    };
  },
  'governance/queries:getAccessibleModelsForUser': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined || !Array.isArray(args.modelIds)) return null;
    const modelIds = args.modelIds.filter(
      (id): id is string => typeof id === 'string',
    );
    return {
      queryKey: backendKey(
        orgId,
        'governance_policy',
        'accessible-models',
        modelIds.join('|'),
      ),
      queryFn: () =>
        backendFetch<{ models: string[] }>('/governance/models/accessible', {
          orgId,
          body: { modelIds },
        }).then((body) => body.models),
    };
  },
  'governance/queries:listTrashedRows': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    // The 0.4 cursor is {ts,id}; the pg walk needs the resource type too, so
    // the composite rides INSIDE the id ("type|rowId") — opaque round-trip.
    const cursor = args.cursor;
    let cursorParam: string | undefined;
    if (
      cursor !== null &&
      cursor !== undefined &&
      typeof cursor === 'object' &&
      'ts' in cursor &&
      'id' in cursor &&
      typeof cursor.ts === 'number' &&
      typeof cursor.id === 'string'
    ) {
      const splitAt = cursor.id.indexOf('|');
      if (splitAt > 0) {
        cursorParam = btoa(
          JSON.stringify({
            resourceType: cursor.id.slice(0, splitAt),
            statusChangedAt: cursor.ts,
            id: cursor.id.slice(splitAt + 1),
          }),
        )
          .replaceAll('+', '-')
          .replaceAll('/', '_')
          .replaceAll('=', '');
      }
    }
    const resourceTypes = Array.isArray(args.resourceTypes)
      ? args.resourceTypes.filter(
          (type): type is string => typeof type === 'string',
        )
      : undefined;
    const query = new URLSearchParams();
    if (cursorParam !== undefined) query.set('cursor', cursorParam);
    if (resourceTypes !== undefined && resourceTypes.length > 0) {
      query.set('resourceTypes', resourceTypes.join(','));
    }
    if (typeof args.limit === 'number') {
      query.set('limit', String(args.limit));
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return {
      queryKey: backendKey(
        orgId,
        'governance_trash',
        resourceTypes?.join(',') ?? null,
        cursorParam ?? null,
        typeof args.limit === 'number' ? args.limit : null,
      ),
      queryFn: () =>
        backendFetch<{ rows: unknown[]; nextCursor: string | null }>(
          `/governance/trash${suffix}`,
          { orgId },
        ).then((body): TrashListResult => {
          let nextCursor: TrashListResult['nextCursor'] = null;
          if (body.nextCursor !== null) {
            try {
              const restored: unknown = JSON.parse(
                atob(body.nextCursor.replaceAll('-', '+').replaceAll('_', '/')),
              );
              if (
                restored !== null &&
                typeof restored === 'object' &&
                'resourceType' in restored &&
                'statusChangedAt' in restored &&
                'id' in restored &&
                typeof restored.resourceType === 'string' &&
                typeof restored.statusChangedAt === 'number' &&
                typeof restored.id === 'string'
              ) {
                nextCursor = {
                  ts: restored.statusChangedAt,
                  id: `${restored.resourceType}|${restored.id}`,
                };
              }
            } catch (error) {
              console.warn('bad trash cursor from backend', error);
            }
          }
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the pg rows carry the 0.4 trash-row wire shape
          return { rows: body.rows, nextCursor } as TrashListResult;
        }),
    };
  },
  'provider_credentials/queries:listCredentials': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'provider_credential', 'list'),
      queryFn: () =>
        backendFetch<{ credentials: ProviderCredentialItem[] }>(
          '/provider-credentials',
          { orgId },
        ).then((body) => body.credentials),
    };
  },
  'connector_credentials/queries:listCredentials': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const connectorSlug =
      typeof args.connectorSlug === 'string' ? args.connectorSlug : undefined;
    return {
      queryKey: backendKey(
        orgId,
        'connector_credential',
        'list',
        connectorSlug ?? null,
      ),
      queryFn: () =>
        backendFetch<{ credentials: ConnectorCredentialItem[] }>(
          connectorSlug === undefined
            ? '/connector-credentials'
            : `/connector-credentials?connector=${encodeURIComponent(connectorSlug)}`,
          { orgId },
        ).then((body) => body.credentials),
    };
  },
  'sandbox/session_queries_public:getHarnessHealth': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'sandbox_session', 'harness-health'),
      queryFn: () =>
        backendFetch<{ health: HarnessHealthResult }>(
          '/sandbox/harness-health',
          { orgId },
        ).then((body) => body.health),
    };
  },
  'sandbox/session_queries_public:getSandboxQuotaUsage': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'sandbox_session', 'quota-usage'),
      queryFn: () =>
        backendFetch<{ usage: QuotaUsageResult }>('/sandbox/quota-usage', {
          orgId,
        }).then(
          (body) => body.usage,
          () => null,
        ),
    };
  },
  'sandbox/session_queries_public:listSandboxesForOrg': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'sandbox_session', 'list'),
      queryFn: () =>
        backendFetch<{ sessions: SandboxListResult }>(
          '/sandbox/sessions/view',
          {
            orgId,
          },
        ).then((body) => body.sessions),
      refetchInterval: 15_000,
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

export const settingsActionQueryAdapters: Record<string, ActionQueryAdapter> = {
  'lib/providers/catalog_actions:listProviderCatalogs': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return () =>
      backendFetch<{ catalogs: ProviderCatalogItem[] }>('/providers/catalogs', {
        orgId,
      }).then((body) => body.catalogs);
  },
  'lib/providers/harness_status:listHarnessStatus': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return () =>
      backendFetch<{ statuses: HarnessStatusItem[] }>(
        '/providers/harness-status',
        { orgId },
      ).then((body) => body.statuses);
  },
  'lib/providers/vision_actions:getResolvedVisionModel': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return () =>
      backendFetch<{ pick: VisionModelPickResult }>('/providers/vision-model', {
        orgId,
      }).then((body) => body.pick);
  },
  'connector_credentials/connector_catalog:listConnectors': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return () =>
      backendFetch<{ connectors: ConnectorSummaryItem[] }>(
        '/connector-credentials/catalog',
        { orgId },
      ).then((body) => body.connectors);
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

function invalidateProviderCredentials(
  client: Parameters<NonNullable<WriteAdapter['invalidate']>>[0],
  args: Record<string, unknown>,
  ctx: AdapterContext,
): void {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) return;
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'provider_credential'),
  });
}

function invalidateConnectorCredentials(
  client: Parameters<NonNullable<WriteAdapter['invalidate']>>[0],
  args: Record<string, unknown>,
  ctx: AdapterContext,
): void {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) return;
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'connector_credential'),
  });
}

function invalidateSandboxSessions(
  client: Parameters<NonNullable<WriteAdapter['invalidate']>>[0],
  args: Record<string, unknown>,
  ctx: AdapterContext,
): void {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) return;
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'sandbox_session'),
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
  'provider_credentials/actions:createCredential': {
    run: (args, ctx) =>
      backendFetch<CreateProviderCredentialResult>('/provider-credentials', {
        orgId: requireOrg(args, ctx),
        body: {
          providerSlug: stringArg(args, 'providerSlug'),
          authMethod: stringArg(args, 'authMethod'),
          name: stringArg(args, 'name'),
          ...(typeof args.secret === 'string' ? { secret: args.secret } : {}),
          ...(args.broker !== undefined
            ? { secret: JSON.stringify(args.broker) }
            : {}),
          ...(typeof args.envName === 'string'
            ? { envName: args.envName }
            : {}),
          ...(typeof args.endpointUrl === 'string'
            ? { endpointUrl: args.endpointUrl }
            : {}),
          ...(Array.isArray(args.modelAllowlist)
            ? { modelAllowlist: args.modelAllowlist }
            : {}),
        },
      }),
    invalidate: invalidateProviderCredentials,
  },
  'provider_credentials/actions:updateCredential': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/provider-credentials/${encodeURIComponent(stringArg(args, 'credentialId'))}`,
        {
          orgId: requireOrg(args, ctx),
          body: {
            ...(typeof args.name === 'string' ? { name: args.name } : {}),
            ...(typeof args.status === 'string' ? { status: args.status } : {}),
            ...(args.modelAllowlist !== undefined
              ? { modelAllowlist: args.modelAllowlist }
              : {}),
            ...(typeof args.secret === 'string' ? { secret: args.secret } : {}),
          },
        },
      ).then(() => null),
    invalidate: invalidateProviderCredentials,
  },
  'provider_credentials/mutations:deleteCredential': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/provider-credentials/${encodeURIComponent(stringArg(args, 'credentialId'))}`,
        { orgId: requireOrg(args, ctx), method: 'DELETE' },
      ).then(() => null),
    invalidate: invalidateProviderCredentials,
  },
  'provider_credentials/mutations:setDefaultCredential': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/provider-credentials/${encodeURIComponent(stringArg(args, 'credentialId'))}`,
        { orgId: requireOrg(args, ctx), body: { isDefault: true } },
      ).then(() => null),
    invalidate: invalidateProviderCredentials,
  },
  'connector_credentials/actions:createCredential': {
    run: (args, ctx) =>
      backendFetch<CreateConnectorCredentialResult>('/connector-credentials', {
        orgId: requireOrg(args, ctx),
        body: {
          connectorSlug: stringArg(args, 'connectorSlug'),
          authMethod: stringArg(args, 'authMethod'),
          name: stringArg(args, 'name'),
          secret: connectorSecretOf(args),
          ...(typeof args.endpointUrl === 'string'
            ? { endpointUrl: args.endpointUrl }
            : {}),
          ...(args.config !== undefined ? { config: args.config } : {}),
          ...(args.isDefault === true ? { isDefault: true } : {}),
        },
      }),
    invalidate: invalidateConnectorCredentials,
  },
  'connector_credentials/actions:updateCredential': {
    run: (args, ctx) => {
      const secret = connectorSecretOf(args);
      return backendFetch<{ ok: boolean }>(
        `/connector-credentials/${encodeURIComponent(stringArg(args, 'credentialId'))}`,
        {
          orgId: requireOrg(args, ctx),
          method: 'PATCH',
          body: {
            ...(typeof args.name === 'string' ? { name: args.name } : {}),
            ...(Object.keys(secret).length > 0 ? { secret } : {}),
            ...(typeof args.endpointUrl === 'string'
              ? { endpointUrl: args.endpointUrl }
              : {}),
            ...(args.config !== undefined ? { config: args.config } : {}),
            ...(typeof args.status === 'string' ? { status: args.status } : {}),
          },
        },
      ).then(() => null);
    },
    invalidate: invalidateConnectorCredentials,
  },
  'connector_credentials/mutations:deleteCredential': {
    run: (args, ctx) =>
      backendFetch<undefined>(
        `/connector-credentials/${encodeURIComponent(stringArg(args, 'credentialId'))}`,
        { orgId: requireOrg(args, ctx), method: 'DELETE' },
      ).then(() => null),
    invalidate: invalidateConnectorCredentials,
  },
  'connector_credentials/mutations:setDefaultCredential': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/connector-credentials/${encodeURIComponent(stringArg(args, 'credentialId'))}/set-default`,
        { orgId: requireOrg(args, ctx), body: {} },
      ).then(() => null),
    invalidate: invalidateConnectorCredentials,
  },
  'governance/file_actions:saveGovernancePolicy': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/governance/policies/${encodeURIComponent(stringArg(args, 'policyType'))}`,
        { orgId: requireOrg(args, ctx), body: { config: args.config } },
      ).then(() => null),
    invalidate: (client, args, ctx) => {
      const orgId = orgOf(args, ctx);
      if (orgId === undefined) return;
      void client.invalidateQueries({
        queryKey: backendEntityPrefix(orgId, 'governance_policy'),
      });
    },
  },
  'governance/restore:restoreSoftDeletedRow': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>('/governance/trash/restore', {
        orgId: requireOrg(args, ctx),
        body: {
          resourceType: stringArg(args, 'resourceType'),
          id: stringArg(args, 'id'),
        },
      }).then(() => null),
    invalidate: (client, args, ctx) => {
      const orgId = orgOf(args, ctx);
      if (orgId === undefined) return;
      void client.invalidateQueries({
        queryKey: backendEntityPrefix(orgId, 'governance_trash'),
      });
    },
  },
  'lib/providers/catalog_actions:refreshProviderCatalogs': {
    run: (args, ctx) =>
      backendFetch<{ results: RefreshCatalogsResult }>(
        '/providers/catalogs/refresh',
        { orgId: requireOrg(args, ctx), body: {} },
      ).then((body) => body.results),
  },
  'node_only/sandbox/session_admin_actions:stopSandboxTask': {
    run: (args, ctx) =>
      backendFetch<{ cancelled: number }>(
        `/sandbox/sessions/${encodeURIComponent(stringArg(args, 'sessionId'))}/stop-task`,
        { orgId: requireOrg(args, ctx), body: {} },
      ),
    invalidate: invalidateSandboxSessions,
  },
  'node_only/sandbox/session_admin_actions:destroySandbox': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/sandbox/sessions/${encodeURIComponent(stringArg(args, 'sessionId'))}/destroy`,
        { orgId: requireOrg(args, ctx), body: {} },
      ).then(() => null),
    invalidate: invalidateSandboxSessions,
  },
  'node_only/sandbox/session_admin_actions:setSandboxPinned': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/sandbox/sessions/${encodeURIComponent(stringArg(args, 'sessionId'))}/pin`,
        {
          orgId: requireOrg(args, ctx),
          body: { pinned: args.pinned === true },
        },
      ).then(() => null),
    invalidate: invalidateSandboxSessions,
  },
  'node_only/sandbox/session_admin_actions:reconcileOrgSessions': {
    run: (args, ctx) =>
      backendFetch<{ healed: number }>('/sandbox/reconcile', {
        orgId: requireOrg(args, ctx),
        body: {},
      }),
    invalidate: invalidateSandboxSessions,
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
