/**
 * The reads the dashboard shell fires on boot, as `app/routes/dashboard*.tsx`
 * and the providers mounted there issue them:
 *
 * - `/dashboard` loader: 2FA status and password expiry (account gates),
 *   plus the current user the layout checks;
 * - `/dashboard` index: the organization picker's memberships and the
 *   last-active pointer;
 * - `/dashboard/$id` loader: the member context and the caller's teams;
 * - Home and the composer: preferences, the model catalog, the inbox gate's
 *   automation listing and API sources.
 *
 * Organization-scoped reads take the org as `?orgId=`.
 */

import {
  type ApiClient,
  type ApiResult,
  asRecord,
  asString,
  mapResult,
  orgQuery,
  rowsOf,
} from './client.ts';

/** `GET /api/app/two-factor/status`. */
export function twoFactorStatus(api: ApiClient): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'GET',
    path: '/api/app/two-factor/status',
    name: 'GET /api/app/two-factor/status',
  });
}

/** `GET /api/app/users/password-expiry`. */
export function passwordExpiry(api: ApiClient): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'GET',
    path: '/api/app/users/password-expiry',
    name: 'GET /api/app/users/password-expiry',
  });
}

/** `GET /api/app/users/me` → the user's id and display name. */
export async function currentUser(
  api: ApiClient,
): Promise<ApiResult<{ userId: string; name: string | undefined }>> {
  const result = await api.call<unknown>({
    method: 'GET',
    path: '/api/app/users/me',
    name: 'GET /api/app/users/me',
  });
  return mapResult(result, (body) => {
    const user = asRecord(asRecord(body)?.user);
    const userId = asString(user?.userId);
    return userId === undefined
      ? undefined
      : { userId, name: asString(user?.name) };
  });
}

export interface MembershipRow {
  organizationId: string;
  role: string | undefined;
  slug: string | undefined;
}

/** `GET /api/app/organizations` — every organization the caller is in. */
export async function myOrganizations(
  api: ApiClient,
): Promise<ApiResult<MembershipRow[]>> {
  const result = await api.call<unknown>({
    method: 'GET',
    path: '/api/app/organizations',
    name: 'GET /api/app/organizations',
  });
  return mapResult(result, (body) =>
    rowsOf(body, 'organizations').flatMap((row) => {
      const organizationId = asString(row.organizationId);
      return organizationId === undefined
        ? []
        : [
            {
              organizationId,
              role: asString(row.role),
              slug: asString(row.slug),
            },
          ];
    }),
  );
}

/** `GET /api/app/users/last-active-org`. */
export async function lastActiveOrganization(
  api: ApiClient,
): Promise<ApiResult<string | null>> {
  const result = await api.call<unknown>({
    method: 'GET',
    path: '/api/app/users/last-active-org',
    name: 'GET /api/app/users/last-active-org',
  });
  return mapResult(
    result,
    (body) => asString(asRecord(body)?.organizationId) ?? null,
  );
}

/** `GET /api/app/members/me?orgId=` → the caller's role in the org. */
export async function memberContext(
  api: ApiClient,
  orgId: string,
): Promise<ApiResult<{ role: string | undefined; status: string }>> {
  const result = await api.call<unknown>({
    method: 'GET',
    path: '/api/app/members/me',
    query: orgQuery(orgId),
    name: 'GET /api/app/members/me',
    refusals: [403, 404],
  });
  return mapResult(result, (body) => {
    const record = asRecord(body);
    return {
      role: asString(record?.role),
      status: asString(record?.status) ?? 'unknown',
    };
  });
}

/** `GET /api/app/teams/mine?orgId=`. */
export function myTeams(
  api: ApiClient,
  orgId: string,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'GET',
    path: '/api/app/teams/mine',
    query: orgQuery(orgId),
    name: 'GET /api/app/teams/mine',
  });
}

/** `GET /api/app/user-preferences?orgId=`. */
export function userPreferences(
  api: ApiClient,
  orgId: string,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'GET',
    path: '/api/app/user-preferences',
    query: orgQuery(orgId),
    name: 'GET /api/app/user-preferences',
  });
}

export interface ComposerModel {
  id: string;
  providerSlug: string;
  /** The model takes a reasoning-effort knob. */
  reasoning: boolean;
}

/** `GET /api/app/chat/composer/models?orgId=` — the model picker. */
export async function composerModels(
  api: ApiClient,
  orgId: string,
): Promise<ApiResult<ComposerModel[]>> {
  const result = await api.call<unknown>({
    method: 'GET',
    path: '/api/app/chat/composer/models',
    query: orgQuery(orgId),
    name: 'GET /api/app/chat/composer/models',
  });
  return mapResult(result, (body) =>
    rowsOf(body, 'models').flatMap((row) => {
      const id = asString(row.id);
      const providerSlug = asString(row.providerSlug);
      return id === undefined || providerSlug === undefined
        ? []
        : [
            {
              id,
              providerSlug,
              reasoning: asRecord(row.reasoning) !== undefined,
            },
          ];
    }),
  );
}

/** `GET /api/app/automations/listing?includeProjectBound=true&orgId=` — the
 * Home inbox gate's read. */
export function automationsListing(
  api: ApiClient,
  orgId: string,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'GET',
    path: '/api/app/automations/listing',
    query: orgQuery(orgId, { includeProjectBound: 'true' }),
    name: 'GET /api/app/automations/listing',
  });
}

/** `GET /api/app/conversations/api-sources?orgId=` — the other half of it. */
export function conversationApiSources(
  api: ApiClient,
  orgId: string,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'GET',
    path: '/api/app/conversations/api-sources',
    query: orgQuery(orgId),
    name: 'GET /api/app/conversations/api-sources',
  });
}

/**
 * `GET /` and the dashboard document on the web tier: what a browser fetches
 * before any API call. Only issued when the run names a web tier, through a
 * requester bound to it.
 */
export function spaShell(
  web: ApiClient,
  path: string,
): Promise<ApiResult<unknown>> {
  return web.call({
    method: 'GET',
    path,
    name: path === '/' ? 'GET /' : 'GET /dashboard/:id',
    headers: { accept: 'text/html' },
  });
}
