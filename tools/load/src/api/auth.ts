/**
 * Better Auth's doors as the SPA calls them (`/api/auth/*`), plus the app's
 * organization-switch audit stamp. Every write carries `Origin` (the HTTP
 * client sets it on non-GET requests): Better Auth refuses a cross-site
 * write without it.
 */

import {
  type ApiClient,
  type ApiResult,
  asRecord,
  asString,
  mapResult,
  rowsOf,
} from './client.ts';

export interface SignedIn {
  userId: string | undefined;
  /** Better Auth asked for a second factor instead of opening a session. */
  twoFactorRedirect: boolean;
}

/** `POST /api/auth/sign-in/email`. 401 is a wrong password (a seeding fault). */
export async function signInEmail(
  api: ApiClient,
  email: string,
  password: string,
): Promise<ApiResult<SignedIn>> {
  const result = await api.call<unknown>({
    method: 'POST',
    path: '/api/auth/sign-in/email',
    json: { email, password, rememberMe: true },
    name: 'POST /api/auth/sign-in/email',
  });
  return mapResult(result, (body) => {
    const record = asRecord(body);
    return {
      userId: asString(asRecord(record?.user)?.id),
      twoFactorRedirect: record?.twoFactorRedirect === true,
    };
  });
}

export interface SessionView {
  userId: string;
  activeOrganizationId: string | undefined;
}

/**
 * `GET /api/auth/get-session`: the SPA's session probe. A missing session
 * answers 200 with `null`, which maps to an `ok` result with no body.
 */
export async function getSession(
  api: ApiClient,
): Promise<ApiResult<SessionView>> {
  const result = await api.call<unknown>({
    method: 'GET',
    path: '/api/auth/get-session',
    name: 'GET /api/auth/get-session',
  });
  return mapResult(result, (body) => {
    const record = asRecord(body);
    const userId = asString(asRecord(record?.user)?.id);
    if (userId === undefined) return undefined;
    return {
      userId,
      activeOrganizationId: asString(
        asRecord(record?.session)?.activeOrganizationId,
      ),
    };
  });
}

/** `POST /api/auth/organization/set-active`. */
export function setActiveOrganization(
  api: ApiClient,
  organizationId: string,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'POST',
    path: '/api/auth/organization/set-active',
    json: { organizationId },
    name: 'POST /api/auth/organization/set-active',
  });
}

/** `POST /api/auth/sign-out`. */
export function signOut(api: ApiClient): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'POST',
    path: '/api/auth/sign-out',
    json: {},
    name: 'POST /api/auth/sign-out',
  });
}

/**
 * `POST /api/app/organizations/:id/record-switch` — the last-active pointer
 * and audit row the dashboard stamps after a switch.
 */
export function recordOrganizationSwitch(
  api: ApiClient,
  organizationId: string,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'POST',
    path: `/api/app/organizations/${encodeURIComponent(organizationId)}/record-switch`,
    json: {},
    name: 'POST /api/app/organizations/:id/record-switch',
  });
}

export interface CreatedApiKey {
  id: string;
  key: string;
}

/**
 * `POST /api/auth/api-key/create`. 403 `API_KEY_CREATE_FORBIDDEN` is the
 * platform's role gate (owner, admin or developer somewhere).
 */
export async function createApiKey(
  api: ApiClient,
  name: string,
): Promise<ApiResult<CreatedApiKey>> {
  const result = await api.call<unknown>({
    method: 'POST',
    path: '/api/auth/api-key/create',
    json: { name },
    name: 'POST /api/auth/api-key/create',
    refusals: [403],
  });
  return mapResult(result, (body) => {
    const record = asRecord(body);
    const id = asString(record?.id);
    const key = asString(record?.key);
    return id !== undefined && key !== undefined ? { id, key } : undefined;
  });
}

export interface ApiKeyRow {
  id: string;
  name: string | undefined;
}

/** `GET /api/auth/api-key/list` — the caller's own keys. */
export async function listApiKeys(
  api: ApiClient,
): Promise<ApiResult<ApiKeyRow[]>> {
  const result = await api.call<unknown>({
    method: 'GET',
    path: '/api/auth/api-key/list',
    name: 'GET /api/auth/api-key/list',
  });
  return mapResult(result, (body) =>
    rowsOf(body, 'apiKeys').flatMap((row) => {
      const id = asString(row.id);
      return id === undefined ? [] : [{ id, name: asString(row.name) }];
    }),
  );
}

/** `POST /api/auth/api-key/delete` — revoke one of the caller's keys. */
export function deleteApiKey(
  api: ApiClient,
  keyId: string,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'POST',
    path: '/api/auth/api-key/delete',
    json: { keyId },
    name: 'POST /api/auth/api-key/delete',
    refusals: [404],
  });
}
