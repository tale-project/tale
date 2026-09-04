import { queryOptions } from '@tanstack/react-query';

import type { ItemOf, ReturnsOf } from '@/app/lib/backend/contract';

import type { WriteAdapter } from './adapters';
import { BackendApiError, backendFetch } from './api-client';
import { backendKey } from './query-keys';

/**
 * The session/org bootstrap reads off the 0.5 backend — everything the
 * shell needs to resolve "who am I, which orgs, which one is active, what
 * may I do here" before any feature surface renders. Shapes are the 0.4
 * queries' wire shapes verbatim, so every consumer keeps its contract.
 *
 * User-scoped reads key under the `me` scope; org-scoped reads key under
 * their organization id, so the org-switch cache sweep (and, later, the
 * `/events` hint lane) can address them by prefix.
 */

/** Retry transport-shaped failures only — a 4xx is a deterministic answer
 * (the account module's rule, shared here). */
function retryTransportOnly(failureCount: number, error: unknown): boolean {
  return (
    !(error instanceof BackendApiError && error.status < 500) &&
    failureCount < 3
  );
}

/** The 0.4 `members/queries:getUserOrganizationsWithDetails` row. */
export interface UserOrganizationRow {
  organizationId: string;
  role: string;
  name: string;
  slug?: string;
}

/** Every organization the caller belongs to (the picker's boot read). */
export function userOrganizationsQuery() {
  return queryOptions({
    queryKey: backendKey('me', 'organization', 'memberships'),
    queryFn: ({ signal }) =>
      backendFetch<{ organizations: UserOrganizationRow[] }>('/organizations', {
        signal,
      }).then((body) => body.organizations),
    retry: retryTransportOnly,
  });
}

/** The 0.4 `organizations/queries:getOrganization` shape. */
export interface OrganizationView {
  _id: string;
  _creationTime: number;
  name: string;
  slug?: string;
  logo?: string | null;
  createdAt: number;
  metadata?: unknown;
}

interface OrganizationWire {
  organization: {
    id: string;
    name: string;
    slug: string | null;
    logo: string | null;
    createdAt: string | null;
    metadata: unknown;
  } | null;
}

/** One organization, projected onto the 0.4 document shape consumers use. */
export function organizationQuery(organizationId: string) {
  return queryOptions({
    queryKey: backendKey(organizationId, 'organization', 'detail'),
    queryFn: ({ signal }) =>
      backendFetch<OrganizationWire>(`/organizations/${organizationId}`, {
        signal,
      }).then((body): OrganizationView | null => {
        const row = body.organization;
        if (row === null) return null;
        const createdAt =
          row.createdAt === null ? 0 : new Date(row.createdAt).getTime();
        return {
          _id: row.id,
          _creationTime: createdAt,
          name: row.name,
          ...(row.slug !== null ? { slug: row.slug } : {}),
          logo: row.logo,
          createdAt,
          ...(row.metadata !== null && row.metadata !== undefined
            ? { metadata: row.metadata }
            : {}),
        };
      }),
    retry: retryTransportOnly,
  });
}

/** The 0.4 `members/queries:getCurrentMemberContext` type, verbatim —
 * consumers compiled against it and it stays the one source of truth. */
export type MemberContextView =
  ReturnsOf<'members/queries:getCurrentMemberContext'>;

/** The caller's membership context for one organization. */
export function memberContextQuery(organizationId: string) {
  return queryOptions({
    queryKey: backendKey(organizationId, 'member', 'context'),
    queryFn: ({ signal }) =>
      backendFetch<Exclude<MemberContextView, null>>('/members/me', {
        signal,
        orgId: organizationId,
      }),
    retry: retryTransportOnly,
  });
}

/** The 0.4 `members/queries:getMyTeams` row, verbatim. */
export type MyTeamRow = ItemOf<'members/queries:getMyTeams'>;

/** The caller's teams in one organization (the team filter's boot read). */
export function myTeamsQuery(organizationId: string) {
  return queryOptions({
    queryKey: backendKey(organizationId, 'team', 'mine'),
    queryFn: ({ signal }) =>
      backendFetch<{ teams: MyTeamRow[] }>('/teams/mine', {
        signal,
        orgId: organizationId,
      }).then((body) => body.teams),
    retry: retryTransportOnly,
  });
}

/** The persistent last-active organization pointer. */
export function lastActiveOrgQuery() {
  return queryOptions({
    queryKey: backendKey('me', 'organization', 'last-active'),
    queryFn: ({ signal }) =>
      backendFetch<{ organizationId: string | null }>(
        '/users/last-active-org',
        { signal },
      ).then((body) => body.organizationId),
    retry: retryTransportOnly,
  });
}

/** Stamp the last-active pointer (the 0.4 `recordOrgSwitch` mutation). */
export function recordOrgSwitch(organizationId: string): Promise<void> {
  return backendFetch(
    `/organizations/${encodeURIComponent(organizationId)}/record-switch`,
    { method: 'POST', body: {} },
  );
}

/** The 0.4 `enterprise_sso/queries:isConfigured` shape (public). */
export interface SsoConfiguredView {
  enabled: boolean;
  providerType?: string;
  seamlessSsoEnabled?: boolean;
  multiple?: boolean;
}

export function ssoConfiguredQuery() {
  return queryOptions({
    queryKey: backendKey('me', 'sso', 'configured'),
    queryFn: ({ signal }) =>
      backendFetch<SsoConfiguredView>('/sso/discovery/configured', { signal }),
    retry: retryTransportOnly,
  });
}

/** The 0.4 `enterprise_sso/queries:listSelectable` row (public). */
export interface SsoSelectableRow {
  organizationId: string;
  displayName: string;
  protocol: string;
}

export function ssoSelectableQuery() {
  return queryOptions({
    queryKey: backendKey('me', 'sso', 'selectable'),
    queryFn: ({ signal }) =>
      backendFetch<{ connections: SsoSelectableRow[] }>(
        '/sso/discovery/selectable',
        { signal },
      ).then((body) => body.connections),
    retry: retryTransportOnly,
  });
}

/**
 * Org-scoped writes that belong to no feature module. `deleteOrganization`
 * is the whole teardown in one server transaction (Better Auth's own delete
 * endpoint is disabled) — it runs on the session alone (the caller is about
 * to lose the org, so an org-scoped gate would be circular).
 */
export const orgWriteAdapters: Record<string, WriteAdapter> = {
  'organizations/delete:deleteOrganization': {
    run: (args) => {
      const organizationId = args.organizationId;
      if (typeof organizationId !== 'string' || organizationId === '') {
        throw new Error('deleteOrganization needs an organization');
      }
      return backendFetch<unknown>(
        `/organizations/${encodeURIComponent(organizationId)}/delete`,
        { body: {} },
      );
    },
  },
};
