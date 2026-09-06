/**
 * Settings vertical over the 0.5 backend — part 1: the ORGANIZATION + TEAMS
 * pages (member administration, team membership, member 2FA/passkey admin).
 * Response types are DERIVED from the 0.4 function signatures; the member
 * directory row itself lives in `documents.ts` (the record-review picker
 * landed it first) — this file carries the rest of the family.
 */

import type { ItemOf, ReturnsOf } from '@/app/lib/backend/contract';

import type {
  ActionQueryAdapter,
  AdapterContext,
  PaginatedAdapter,
  ReadAdapter,
  WriteAdapter,
} from './adapters';
import { backendFetch } from './api-client';
import { backendEntityPrefix, backendKey } from './query-keys';

type OrgTeamItem = ItemOf<'members/queries:listOrgTeams'>;
type TeamMemberItem = ItemOf<'team_members/queries:listByTeam'>;
type MemberPasskeyItem = ItemOf<'two_factor/queries:listPasskeysForMember'>;
type CreateMemberResult = ReturnsOf<'users/mutations:createMember'>;
type MyPreferencesResult =
  ReturnsOf<'user_preferences/queries:getMyPreferences'>;
type NotificationPrefsResult =
  ReturnsOf<'collab/preferences:getNotificationPreferences'>;
type AppPasswordItem = ItemOf<'webdav/app_password_queries:listAppPasswords'>;
type CreateAppPasswordResult =
  ReturnsOf<'webdav/app_password_mutations:createAppPassword'>;
type ProviderCatalogItem =
  ItemOf<'lib/providers/catalog_actions:listProviderCatalogs'>;
type RefreshCatalogsResult =
  ReturnsOf<'lib/providers/catalog_actions:refreshProviderCatalogs'>;
type HarnessStatusItem =
  ItemOf<'lib/providers/harness_status:listHarnessStatus'>;
type VisionModelPickResult =
  ReturnsOf<'lib/providers/vision_actions:getResolvedVisionModel'>;
type ConnectorSummaryItem =
  ItemOf<'connector_credentials/connector_catalog:listConnectors'>;
type ConnectorOauthAppItem = ItemOf<'connector_oauth_apps/queries:list'>;
type HarnessHealthResult =
  ReturnsOf<'sandbox/session_queries_public:getHarnessHealth'>;
type QuotaUsageResult =
  ReturnsOf<'sandbox/session_queries_public:getSandboxQuotaUsage'>;
type SandboxListResult =
  ReturnsOf<'sandbox/session_queries_public:listSandboxesForOrg'>;
type ProviderCredentialItem =
  ItemOf<'provider_credentials/queries:listCredentials'>;
type ConnectorCredentialItem =
  ItemOf<'connector_credentials/queries:listCredentials'>;
type CreateProviderCredentialResult =
  ReturnsOf<'provider_credentials/actions:createCredential'>;
type CreateConnectorCredentialResult =
  ReturnsOf<'connector_credentials/actions:createCredential'>;
type GovernancePolicyResult = ReturnsOf<'governance/queries:getPolicy'>;
type MyFeatureFlagsResult = ReturnsOf<'governance/queries:getMyFeatureFlags'>;
type MyBudgetStatusResult = ReturnsOf<'governance/queries:getMyBudgetStatus'>;
type TrashListResult = ReturnsOf<'governance/queries:listTrashedRows'>;
type LegalHoldItem = ItemOf<'governance/legal_hold_queries:listLegalHolds'>;
type LegalMatterItem = ItemOf<'governance/legal_hold_queries:listLegalMatters'>;
type ReleaseRequestItem =
  ItemOf<'governance/legal_hold_queries:listLegalHoldReleaseRequests'>;
type HeldByTargetResult =
  ReturnsOf<'governance/legal_hold_queries:getLegalHoldByTarget'>;
type ActiveHoldTargetsResult =
  ReturnsOf<'governance/legal_hold_queries:listActiveHoldTargetIds'>;
type MemberPickerItem =
  ItemOf<'governance/legal_hold_queries:listOrgMembersForPicker'>;
type ErasureDetailResult =
  ReturnsOf<'governance/erasure_queries:getErasureRequest'>;
type DsarPolicyUiResult =
  ReturnsOf<'governance/dsar_policy:getDsarPolicyForUi'>;
type PendingRetentionChangeResult =
  ReturnsOf<'governance/queries:getPendingRetentionChange'>;
type RetentionBoundsCatalogResult =
  ReturnsOf<'governance/retention_actions:getRetentionBoundsAction'>;
type PendingBoundsProposalResult =
  ReturnsOf<'governance/retention_bounds_proposal:getPendingBoundsProposal'>;
type ChatFilterEventItem = ItemOf<'chat_filter_events/queries:listRecent'>;
type RequestErasureResult = ReturnsOf<'governance/erasure:requestErasure'>;
type ExtendErasureResult =
  ReturnsOf<'governance/erasure:extendErasureDeadline'>;
type CloseMatterResult = ReturnsOf<'governance/legal_hold:closeLegalMatter'>;
type ProposeDsarResult = ReturnsOf<'governance/dsar_policy:proposeDsarPolicy'>;

/** GET /members row (the directory projection the pickers reuse). */
interface MemberDirectoryWire {
  userId: string;
  role: string;
  displayName: string | null;
  email: string | null;
}

/** The pg keyset page envelope for the governance history walks. */
interface KeysetPage<Row> {
  requests: Row[];
  nextCursor: { ts: number; id: string } | null;
}

function keysetQs(cursor: string | null): string {
  if (cursor === null) return '';
  const [ts, id] = cursor.split('|');
  if (ts === undefined || id === undefined || id === '') return '';
  return `&cursorTs=${encodeURIComponent(ts)}&cursorId=${encodeURIComponent(id)}`;
}

function keysetEnvelope<Row>(body: KeysetPage<Row>): {
  page: Row[];
  isDone: boolean;
  continueCursor: string;
} {
  return {
    page: body.requests,
    isDone: body.nextCursor === null,
    continueCursor:
      body.nextCursor === null
        ? ''
        : `${body.nextCursor.ts}|${body.nextCursor.id}`,
  };
}

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
  'connector_oauth_apps/queries:list': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'connector_oauth_app', 'list'),
      queryFn: () =>
        backendFetch<{ apps: ConnectorOauthAppItem[] }>(
          '/connector-oauth-apps',
          { orgId },
        ).then((body) => body.apps),
    };
  },
  'connector_oauth_apps/queries:entraSsoSource': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'connector_oauth_app', 'entra-sso-source'),
      queryFn: () =>
        backendFetch<ReturnsOf<'connector_oauth_apps/queries:entraSsoSource'>>(
          '/connector-oauth-apps/entra-sso-source',
          { orgId },
        ),
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
  'governance/legal_hold_queries:listLegalHolds': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const status = typeof args.status === 'string' ? args.status : 'active';
    const targetType =
      typeof args.targetType === 'string' ? args.targetType : '';
    const qs =
      `?status=${encodeURIComponent(status)}` +
      (targetType !== ''
        ? `&targetType=${encodeURIComponent(targetType)}`
        : '');
    return {
      queryKey: backendKey(orgId, 'legal_hold', 'list', status, targetType),
      queryFn: () =>
        backendFetch<{ holds: LegalHoldItem[] }>(`/legal-holds${qs}`, {
          orgId,
        }).then((body) => body.holds),
    };
  },
  'governance/legal_hold_queries:listLegalMatters': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const status = typeof args.status === 'string' ? args.status : 'all';
    return {
      queryKey: backendKey(orgId, 'legal_hold', 'matters', status),
      queryFn: () =>
        backendFetch<{ matters: LegalMatterItem[] }>(
          `/legal-holds/matters?status=${encodeURIComponent(status)}`,
          { orgId },
        ).then((body) => body.matters),
    };
  },
  'governance/legal_hold_queries:listLegalHoldReleaseRequests': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const status = args.status;
    if (orgId === undefined || typeof status !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'legal_hold', 'release-requests', status),
      queryFn: () =>
        backendFetch<{ requests: ReleaseRequestItem[] }>(
          `/legal-holds/release-requests?status=${encodeURIComponent(status)}&limit=200`,
          { orgId },
        ).then((body) => body.requests),
    };
  },
  'governance/legal_hold_queries:getLegalHoldByTarget': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const targetType = args.targetType;
    const targetId = args.targetId;
    if (
      orgId === undefined ||
      typeof targetType !== 'string' ||
      typeof targetId !== 'string'
    ) {
      return null;
    }
    return {
      queryKey: backendKey(
        orgId,
        'legal_hold',
        'by-target',
        targetType,
        targetId,
      ),
      queryFn: () =>
        backendFetch<{ hold: HeldByTargetResult }>(
          `/legal-holds/by-target?targetType=${encodeURIComponent(targetType)}&targetId=${encodeURIComponent(targetId)}`,
          { orgId },
        ).then((body) => body.hold),
    };
  },
  'governance/legal_hold_queries:listActiveHoldTargetIds': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const targetType = args.targetType;
    if (orgId === undefined || typeof targetType !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'legal_hold', 'targets', targetType),
      queryFn: () =>
        backendFetch<ActiveHoldTargetsResult>(
          `/legal-holds/targets?targetType=${encodeURIComponent(targetType)}`,
          { orgId },
        ),
    };
  },
  'governance/legal_hold_queries:listOrgMembersForPicker': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'member', 'picker'),
      queryFn: () =>
        backendFetch<{ members: MemberDirectoryWire[] }>('/members', {
          orgId,
        }).then((body) =>
          body.members
            .filter((row) => row.role.toLowerCase() !== 'disabled')
            .map((row): MemberPickerItem => ({
              userId: row.userId,
              email: row.email ?? '',
              displayName: row.displayName ?? row.email ?? row.userId,
              role: row.role,
            })),
        ),
    };
  },
  'governance/erasure_queries:getErasureRequest': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const requestId = args.requestId;
    if (orgId === undefined || typeof requestId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'gdpr_erasure', 'detail', requestId),
      queryFn: () =>
        backendFetch<ErasureDetailResult>(
          `/erasure/${encodeURIComponent(requestId)}`,
          { orgId },
        ),
    };
  },
  'governance/dsar_policy:getDsarPolicyForUi': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'governance_policy', 'dsar-ui'),
      queryFn: () =>
        backendFetch<DsarPolicyUiResult>('/governance/dsar/policy', { orgId }),
    };
  },
  'governance/queries:getPendingRetentionChange': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'governance_policy', 'retention-pending'),
      queryFn: () =>
        backendFetch<{
          pending: (Record<string, unknown> & { id: string }) | null;
        }>('/retention/pending-change', { orgId }).then((body) =>
          body.pending === null
            ? null
            : // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- pg ids stand in for Convex ids on the 0.4 wire shape
              ({
                ...body.pending,
                _id: body.pending.id,
              } as unknown as PendingRetentionChangeResult),
        ),
    };
  },
  'chat_filter_events/queries:listRecent': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const limit = typeof args.limit === 'number' ? args.limit : 50;
    const filterName =
      typeof args.filterName === 'string' ? args.filterName : '';
    const kind = typeof args.kind === 'string' ? args.kind : '';
    const qs =
      `?limit=${encodeURIComponent(String(limit))}` +
      (filterName !== ''
        ? `&filterName=${encodeURIComponent(filterName)}`
        : '') +
      (kind !== '' ? `&kind=${encodeURIComponent(kind)}` : '');
    return {
      queryKey: backendKey(
        orgId,
        'chat_filter_event',
        'recent',
        String(limit),
        filterName,
        kind,
      ),
      queryFn: () =>
        backendFetch<{ events: ChatFilterEventItem[] }>(
          `/governance/chat-filter-events${qs}`,
          { orgId },
        ).then((body) => body.events),
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
  'governance/moderation_provider/secrets:hasModerationSecret': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return () =>
      backendFetch<{ masked: string | null }>(
        '/governance/moderation/secret/status',
        { orgId },
      ).then((body) => body.masked);
  },
  'governance/retention_actions:getRetentionBoundsAction': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return () =>
      backendFetch<RetentionBoundsCatalogResult>('/retention/bounds/catalog', {
        orgId,
      });
  },
  'governance/retention_bounds_proposal:getPendingBoundsProposal': (
    args,
    ctx,
  ) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return () =>
      backendFetch<{ proposal: PendingBoundsProposalResult }>(
        '/retention/bounds/proposal',
        { orgId },
      ).then((body) => body.proposal);
  },
};

/** Governance history walks on the adapted infinite lane. */
export const settingsPaginatedAdapters: Record<string, PaginatedAdapter> = {
  'governance/legal_hold_queries:listLegalHoldReleaseRequestsPaginated': (
    args,
    ctx,
  ) => {
    const orgId = orgOf(args, ctx);
    const status = args.status;
    if (orgId === undefined || typeof status !== 'string') return null;
    return {
      queryKey: backendKey(
        orgId,
        'legal_hold',
        'release-requests-page',
        status,
      ),
      fetchPage: (cursor, numItems) =>
        backendFetch<KeysetPage<ReleaseRequestItem>>(
          `/legal-holds/release-requests?status=${encodeURIComponent(status)}&limit=${numItems}${keysetQs(cursor)}`,
          { orgId },
        ).then(keysetEnvelope),
    };
  },
  'governance/erasure_queries:listErasureRequests': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const statuses = Array.isArray(args.statuses)
      ? args.statuses.filter(
          (value): value is string => typeof value === 'string',
        )
      : [];
    const qsStatuses =
      statuses.length > 0
        ? `&statuses=${encodeURIComponent(statuses.join(','))}`
        : '';
    return {
      queryKey: backendKey(orgId, 'gdpr_erasure', 'page', statuses.join(',')),
      fetchPage: (cursor, numItems) =>
        backendFetch<KeysetPage<unknown>>(
          `/erasure?limit=${numItems}${qsStatuses}${keysetQs(cursor)}`,
          { orgId },
        ).then(keysetEnvelope),
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

function invalidateChatMemories(
  client: Parameters<NonNullable<WriteAdapter['invalidate']>>[0],
  args: Record<string, unknown>,
  ctx: AdapterContext,
): void {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) return;
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'chat_memory'),
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

function invalidateConnectorOauthApps(
  client: Parameters<NonNullable<WriteAdapter['invalidate']>>[0],
  args: Record<string, unknown>,
  ctx: AdapterContext,
): void {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) return;
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'connector_oauth_app'),
  });
  // The connector catalog rides an action query under its own key and
  // carries the per-connector `oauthApp` state — refresh it too.
  void client.invalidateQueries({
    queryKey: ['connectors', 'connectors', orgId],
  });
  // The documents connect dialogs read the cloud-import status probe.
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'cloud_oauth_app'),
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
  'user_preferences/mutations:setOnboardingCompleted': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>('/user-preferences/onboarding-completed', {
        orgId: requireOrg(args, ctx),
        body: { completed: args.completed !== false },
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
  // The memories the preferences page reviews: the model proposes, the
  // person settles — save (approve) or discard (reject) a suggestion, and
  // delete a saved memory. Both refresh the page's memory lists.
  'chat/memories:reviewMemory': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/chat/memories/${encodeURIComponent(String(args.memoryId))}/review`,
        {
          orgId: requireOrg(args, ctx),
          body: { decision: args.decision },
        },
      ).then((body) => body.ok),
    invalidate: invalidateChatMemories,
  },
  'chat/memories:deleteMemory': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/chat/memories/${encodeURIComponent(String(args.memoryId))}`,
        { method: 'DELETE', orgId: requireOrg(args, ctx) },
      ).then((body) => body.ok),
    invalidate: invalidateChatMemories,
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
    // User-scoped: the forced-change page sits outside `/dashboard/$id` and
    // clears the active-org store on unmount, so requireOrg would throw.
    // `trigger` must ride the body — without it the backend defaults to
    // voluntary and 400s a rotation that has no currentPassword.
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>('/users/update-password', {
        ...(orgOf(args, ctx) !== undefined ? { orgId: orgOf(args, ctx) } : {}),
        body: {
          ...(typeof args.currentPassword === 'string'
            ? { currentPassword: args.currentPassword }
            : {}),
          newPassword: stringArg(args, 'newPassword'),
          ...(args.trigger === 'forced' || args.trigger === 'voluntary'
            ? { trigger: args.trigger }
            : {}),
        },
      }).then(() => null),
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
          // Mirrors the create row field for field: everything the edit and
          // replace dialogs can submit must reach the wire, or a save reads
          // as success while nothing changed (the broker Replace-configuration
          // and the Azure endpoint edit were exactly that).
          body: {
            ...(typeof args.name === 'string' ? { name: args.name } : {}),
            ...(typeof args.status === 'string' ? { status: args.status } : {}),
            ...(typeof args.isDefault === 'boolean'
              ? { isDefault: args.isDefault }
              : {}),
            ...(args.modelAllowlist !== undefined
              ? { modelAllowlist: args.modelAllowlist }
              : {}),
            ...(typeof args.endpointUrl === 'string'
              ? { endpointUrl: args.endpointUrl }
              : {}),
            ...(typeof args.envName === 'string'
              ? { envName: args.envName }
              : {}),
            ...(typeof args.secret === 'string' ? { secret: args.secret } : {}),
            ...(args.broker !== undefined
              ? { secret: JSON.stringify(args.broker) }
              : {}),
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
  'connector_oauth_apps/actions:upsert': {
    run: (args, ctx) =>
      backendFetch<ReturnsOf<'connector_oauth_apps/actions:upsert'>>(
        `/connector-oauth-apps/${encodeURIComponent(stringArg(args, 'slug'))}`,
        {
          orgId: requireOrg(args, ctx),
          method: 'PUT',
          body: {
            clientId: stringArg(args, 'clientId'),
            ...(typeof args.clientSecret === 'string' &&
            args.clientSecret.length > 0
              ? { clientSecret: args.clientSecret }
              : {}),
            ...(typeof args.tenantId === 'string' && args.tenantId.length > 0
              ? { tenantId: args.tenantId }
              : {}),
          },
        },
      ),
    invalidate: invalidateConnectorOauthApps,
  },
  'connector_oauth_apps/mutations:remove': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/connector-oauth-apps/${encodeURIComponent(stringArg(args, 'slug'))}`,
        { orgId: requireOrg(args, ctx), method: 'DELETE' },
      ).then(() => null),
    invalidate: invalidateConnectorOauthApps,
  },
  'connector_oauth_apps/actions:reuseSso': {
    run: (args, ctx) =>
      backendFetch<ReturnsOf<'connector_oauth_apps/actions:reuseSso'>>(
        `/connector-oauth-apps/${encodeURIComponent(stringArg(args, 'slug'))}/reuse-sso`,
        { orgId: requireOrg(args, ctx), body: {} },
      ),
    invalidate: invalidateConnectorOauthApps,
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
  'governance/legal_hold:placeLegalHold': {
    run: (args, ctx) =>
      backendFetch<{ holdId: string }>('/legal-holds', {
        orgId: requireOrg(args, ctx),
        body: {
          targetType: stringArg(args, 'targetType'),
          targetId: stringArg(args, 'targetId'),
          reason: stringArg(args, 'reason'),
          ...(typeof args.matterRef === 'string' && args.matterRef !== ''
            ? { matterRef: args.matterRef }
            : {}),
        },
      }).then((body) => body.holdId),
    invalidate: invalidateLegalHolds,
  },
  'governance/legal_hold:requestLegalHoldRelease': {
    run: (args, ctx) =>
      backendFetch<{ requestId: string }>(
        `/legal-holds/${encodeURIComponent(stringArg(args, 'holdId'))}/release-requests`,
        {
          orgId: requireOrg(args, ctx),
          body: { reason: stringArg(args, 'reason') },
        },
      ).then((body) => body.requestId),
    invalidate: invalidateLegalHolds,
  },
  'governance/legal_hold:approveLegalHoldRelease': {
    run: (args, ctx) =>
      backendFetch<{ effectiveAt: number }>(
        `/legal-holds/release-requests/${encodeURIComponent(stringArg(args, 'requestId'))}/approve`,
        { orgId: requireOrg(args, ctx), body: {} },
      ).then(() => null),
    invalidate: invalidateLegalHolds,
  },
  'governance/legal_hold:rejectLegalHoldRelease': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/legal-holds/release-requests/${encodeURIComponent(stringArg(args, 'requestId'))}/reject`,
        {
          orgId: requireOrg(args, ctx),
          body:
            typeof args.reason === 'string' && args.reason !== ''
              ? { reason: args.reason }
              : {},
        },
      ).then(() => null),
    invalidate: invalidateLegalHolds,
  },
  'governance/legal_hold:upsertLegalMatter': {
    run: (args, ctx) =>
      backendFetch<{ matterId: string }>('/legal-holds/matters', {
        orgId: requireOrg(args, ctx),
        body: {
          ...(typeof args.matterId === 'string'
            ? { matterId: args.matterId }
            : {}),
          name: stringArg(args, 'name'),
          ...(typeof args.caseNumber === 'string'
            ? { caseNumber: args.caseNumber }
            : {}),
          ...(typeof args.description === 'string'
            ? { description: args.description }
            : {}),
        },
      }).then((body) => body.matterId),
    invalidate: invalidateLegalHolds,
  },
  'governance/legal_hold:closeLegalMatter': {
    run: (args, ctx) =>
      backendFetch<CloseMatterResult>(
        `/legal-holds/matters/${encodeURIComponent(stringArg(args, 'matterId'))}/close`,
        {
          orgId: requireOrg(args, ctx),
          body:
            typeof args.releaseReason === 'string' && args.releaseReason !== ''
              ? { releaseReason: args.releaseReason }
              : {},
        },
      ),
    invalidate: invalidateLegalHolds,
  },
  'governance/erasure:requestErasure': {
    run: (args, ctx) =>
      backendFetch<RequestErasureResult>('/erasure', {
        orgId: requireOrg(args, ctx),
        body: {
          targetUserId: stringArg(args, 'userId'),
          reason: stringArg(args, 'reason'),
          reasonCode: stringArg(args, 'reasonCode'),
        },
      }),
    invalidate: invalidateErasure,
  },
  'governance/erasure:cancelErasureRequest': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/erasure/${encodeURIComponent(stringArg(args, 'requestId'))}/cancel`,
        {
          orgId: requireOrg(args, ctx),
          body: { reason: stringArg(args, 'cancellationReason') },
        },
      ).then(() => null),
    invalidate: invalidateErasure,
  },
  'governance/erasure:retryErasureRequest': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/erasure/${encodeURIComponent(stringArg(args, 'requestId'))}/retry`,
        { orgId: requireOrg(args, ctx), body: {} },
      ).then(() => null),
    invalidate: invalidateErasure,
  },
  'governance/erasure:extendErasureDeadline': {
    run: (args, ctx) =>
      backendFetch<ExtendErasureResult>(
        `/erasure/${encodeURIComponent(stringArg(args, 'requestId'))}/extend`,
        {
          orgId: requireOrg(args, ctx),
          body: {
            extraDays: args.extraDays,
            extensionReason: stringArg(args, 'extensionReason'),
          },
        },
      ),
    invalidate: invalidateErasure,
  },
  'governance/dsar_policy:proposeDsarPolicy': {
    run: (args, ctx) =>
      backendFetch<{ staged: boolean; effectiveAt?: number }>(
        '/governance/dsar/policy',
        { orgId: requireOrg(args, ctx), body: { config: args.config } },
      ).then((body): ProposeDsarResult => ({
        applied: !body.staged,
        ...(body.effectiveAt !== undefined
          ? { effectiveAt: body.effectiveAt }
          : {}),
      })),
    invalidate: invalidateGovernancePolicies,
  },
  'governance/dsar_policy:cancelPendingDsarPolicyChange': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>('/governance/dsar/policy/cancel-pending', {
        orgId: requireOrg(args, ctx),
        body: {},
      }).then(() => null),
    invalidate: invalidateGovernancePolicies,
  },
  'governance/retention_actions:upsertRetentionPolicyAction': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>('/retention/policy', {
        orgId: requireOrg(args, ctx),
        body: { config: args.config },
      }).then(() => null),
    invalidate: invalidateGovernancePolicies,
  },
  'governance/retention_actions:cancelPendingRetentionChange': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>('/retention/pending-change/cancel', {
        orgId: requireOrg(args, ctx),
        body: {},
      }).then(() => null),
    invalidate: invalidateGovernancePolicies,
  },
  'governance/retention_bounds_proposal:applyBoundsProposal': {
    run: (args, ctx) =>
      backendFetch<{ bounds: unknown }>('/retention/bounds/apply', {
        orgId: requireOrg(args, ctx),
        body: { proposedHash: stringArg(args, 'proposedHash') },
      }).then(() => null),
    invalidate: invalidateGovernancePolicies,
  },
  'governance/retention_bounds_proposal:rejectBoundsProposal': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>('/retention/bounds/reject', {
        orgId: requireOrg(args, ctx),
        body: { proposedHash: stringArg(args, 'proposedHash') },
      }).then(() => null),
    invalidate: invalidateGovernancePolicies,
  },
  'governance/moderation_provider/secrets:saveModerationSecret': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>('/governance/moderation/secret', {
        orgId: requireOrg(args, ctx),
        body: { authHeader: stringArg(args, 'authHeader') },
      }).then(() => null),
  },
  'governance/moderation_provider/test_action:testModerationProvider': {
    run: (args, ctx) =>
      backendFetch<Record<string, unknown>>('/governance/moderation/test', {
        orgId: requireOrg(args, ctx),
        body: {
          text: stringArg(args, 'text'),
          ...(typeof args.direction === 'string'
            ? { direction: args.direction }
            : {}),
        },
      }),
  },
};

function invalidateLegalHolds(
  client: Parameters<NonNullable<WriteAdapter['invalidate']>>[0],
  args: Record<string, unknown>,
  ctx: AdapterContext,
): void {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) return;
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'legal_hold'),
  });
}

function invalidateErasure(
  client: Parameters<NonNullable<WriteAdapter['invalidate']>>[0],
  args: Record<string, unknown>,
  ctx: AdapterContext,
): void {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) return;
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'gdpr_erasure'),
  });
}

function invalidateGovernancePolicies(
  client: Parameters<NonNullable<WriteAdapter['invalidate']>>[0],
  args: Record<string, unknown>,
  ctx: AdapterContext,
): void {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) return;
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'governance_policy'),
  });
}
