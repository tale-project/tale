/**
 * Projects, notifications, contacts, members, teams, audit logs and the
 * user's own settings — the smaller app surfaces a person touches between
 * chats and tasks. Paths and bodies follow `backend/domains/<domain>/routes.ts`
 * and the SPA's `app/lib/backend/*.ts`.
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

const enc = encodeURIComponent;

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface ProjectRow {
  id: string;
  name: string | undefined;
}

function projectRows(body: unknown): ProjectRow[] {
  return rowsOf(body, 'projects').flatMap((row) => {
    const id = asString(row.id);
    return id === undefined ? [] : [{ id, name: asString(row.name) }];
  });
}

/** `GET /api/app/projects?includeArchived=false&summary=true&orgId=`. */
export async function listProjects(
  api: ApiClient,
  orgId: string,
): Promise<ApiResult<ProjectRow[]>> {
  const result = await api.call<unknown>({
    method: 'GET',
    path: '/api/app/projects',
    query: orgQuery(orgId, { includeArchived: 'false', summary: 'true' }),
    name: 'GET /api/app/projects',
  });
  return mapResult(result, projectRows);
}

/** `GET /api/app/projects/overview?…` — the projects page. */
export async function projectsOverview(
  api: ApiClient,
  orgId: string,
): Promise<ApiResult<ProjectRow[]>> {
  const result = await api.call<unknown>({
    method: 'GET',
    path: '/api/app/projects/overview',
    query: orgQuery(orgId, { includeArchived: 'false', summary: 'true' }),
    name: 'GET /api/app/projects/overview',
  });
  return mapResult(result, projectRows);
}

/** `GET /api/app/projects/search?q=&orgId=`. */
export function searchProjects(
  api: ApiClient,
  orgId: string,
  query: string,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'GET',
    path: '/api/app/projects/search',
    query: orgQuery(orgId, { q: query }),
    name: 'GET /api/app/projects/search',
  });
}

/**
 * `POST /api/app/projects` → the new project's id. Editors and up only
 * (`RBAC_FORBIDDEN` 403), and rate limited to 30 a minute per user.
 */
export async function createProject(
  api: ApiClient,
  orgId: string,
  args: { name: string; description?: string },
): Promise<ApiResult<string>> {
  const result = await api.call<unknown>({
    method: 'POST',
    path: '/api/app/projects',
    query: orgQuery(orgId),
    json: args,
    name: 'POST /api/app/projects',
    refusals: [403],
  });
  return mapResult(result, (body) => asString(asRecord(body)?.projectId));
}

// ---------------------------------------------------------------------------
// Notifications: the org bell (admin/security rows) and the per-user
// collaboration bell (mentions, assignments, comments).
// ---------------------------------------------------------------------------

/** `GET /api/app/notifications/unread-count?orgId=`. */
export function orgUnreadCount(
  api: ApiClient,
  orgId: string,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'GET',
    path: '/api/app/notifications/unread-count',
    query: orgQuery(orgId),
    name: 'GET /api/app/notifications/unread-count',
  });
}

/** `GET /api/app/collab/notifications/unread-count?orgId=`. */
export function myUnreadCount(
  api: ApiClient,
  orgId: string,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'GET',
    path: '/api/app/collab/notifications/unread-count',
    query: orgQuery(orgId),
    name: 'GET /api/app/collab/notifications/unread-count',
  });
}

export interface NotificationRow {
  id: string;
  read: boolean;
}

/** `GET /api/app/collab/notifications?limit=&orgId=` → the page's rows. */
export async function listMyNotifications(
  api: ApiClient,
  orgId: string,
  limit = 20,
): Promise<ApiResult<NotificationRow[]>> {
  const result = await api.call<unknown>({
    method: 'GET',
    path: '/api/app/collab/notifications',
    query: orgQuery(orgId, { limit }),
    name: 'GET /api/app/collab/notifications',
  });
  return mapResult(result, (body) =>
    rowsOf(body, 'rows').flatMap((row) => {
      const id = asString(row.id);
      return id === undefined ? [] : [{ id, read: row.read === true }];
    }),
  );
}

/** `GET /api/app/notifications?limit=&orgId=` → the org bell's items. */
export async function listOrgNotifications(
  api: ApiClient,
  orgId: string,
  limit = 20,
): Promise<ApiResult<NotificationRow[]>> {
  const result = await api.call<unknown>({
    method: 'GET',
    path: '/api/app/notifications',
    query: orgQuery(orgId, { limit }),
    name: 'GET /api/app/notifications',
  });
  return mapResult(result, (body) =>
    rowsOf(body, 'items').flatMap((row) => {
      const id = asString(row.id);
      return id === undefined ? [] : [{ id, read: row.read === true }];
    }),
  );
}

/** `POST /api/app/collab/notifications/:id/read`. */
export function markMyNotificationRead(
  api: ApiClient,
  orgId: string,
  notificationId: string,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'POST',
    path: `/api/app/collab/notifications/${enc(notificationId)}/read`,
    query: orgQuery(orgId),
    json: {},
    name: 'POST /api/app/collab/notifications/:id/read',
  });
}

/** `POST /api/app/collab/notifications/read-all`. */
export function markAllMyNotificationsRead(
  api: ApiClient,
  orgId: string,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'POST',
    path: '/api/app/collab/notifications/read-all',
    query: orgQuery(orgId),
    json: {},
    name: 'POST /api/app/collab/notifications/read-all',
  });
}

/** `POST /api/app/notifications/:id/read`. */
export function markOrgNotificationRead(
  api: ApiClient,
  orgId: string,
  notificationId: string,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'POST',
    path: `/api/app/notifications/${enc(notificationId)}/read`,
    query: orgQuery(orgId),
    json: {},
    name: 'POST /api/app/notifications/:id/read',
  });
}

/** `POST /api/app/notifications/read-all`. */
export function markAllOrgNotificationsRead(
  api: ApiClient,
  orgId: string,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'POST',
    path: '/api/app/notifications/read-all',
    query: orgQuery(orgId),
    json: {},
    name: 'POST /api/app/notifications/read-all',
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** `POST /api/app/users/update-name` (account-level, no org). */
export function updateName(
  api: ApiClient,
  name: string,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'POST',
    path: '/api/app/users/update-name',
    json: { name },
    name: 'POST /api/app/users/update-name',
  });
}

/** `POST /api/app/user-preferences/chat-model?orgId=` — the default model. */
export function setChatModelPreference(
  api: ApiClient,
  orgId: string,
  modelId: string,
  providerSlug: string,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'POST',
    path: '/api/app/user-preferences/chat-model',
    query: orgQuery(orgId),
    json: { modelId, providerSlug },
    name: 'POST /api/app/user-preferences/chat-model',
  });
}

/** `POST /api/app/user-preferences/custom-instructions?orgId=`. */
export function setCustomInstructions(
  api: ApiClient,
  orgId: string,
  customInstructions: string,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'POST',
    path: '/api/app/user-preferences/custom-instructions',
    query: orgQuery(orgId),
    json: { customInstructions },
    name: 'POST /api/app/user-preferences/custom-instructions',
  });
}

// ---------------------------------------------------------------------------
// Contacts: every member reads; editors and up write.
// ---------------------------------------------------------------------------

export interface ContactInput {
  name: string;
  email?: string;
  phone?: string;
  locale?: string;
  tags?: string[];
  notes?: string;
  address?: Record<string, string>;
  source: 'manual_import';
}

/** `POST /api/app/contacts?orgId=` → the contact id (`RBAC_FORBIDDEN` 403
 * for a plain member; 409 for a duplicate e-mail). */
export async function createContact(
  api: ApiClient,
  orgId: string,
  contact: ContactInput,
): Promise<ApiResult<string>> {
  const result = await api.call<unknown>({
    method: 'POST',
    path: '/api/app/contacts',
    query: orgQuery(orgId),
    json: contact,
    name: 'POST /api/app/contacts',
    refusals: [403, 409],
  });
  return mapResult(result, (body) => asString(asRecord(body)?.contactId));
}

/** `GET /api/app/contacts?limit=&search=&orgId=`. */
export function listContacts(
  api: ApiClient,
  orgId: string,
  options: { limit?: number; search?: string } = {},
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'GET',
    path: '/api/app/contacts',
    query: orgQuery(orgId, {
      limit: options.limit ?? 50,
      search: options.search,
    }),
    name: 'GET /api/app/contacts',
  });
}

/** `GET /api/app/contacts/search?q=&orgId=`. */
export function searchContacts(
  api: ApiClient,
  orgId: string,
  query: string,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'GET',
    path: '/api/app/contacts/search',
    query: orgQuery(orgId, { q: query }),
    name: 'GET /api/app/contacts/search',
  });
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

/** `GET /api/app/members?orgId=` → the member ids. */
export async function listMembers(
  api: ApiClient,
  orgId: string,
): Promise<ApiResult<string[]>> {
  const result = await api.call<unknown>({
    method: 'GET',
    path: '/api/app/members',
    query: orgQuery(orgId),
    name: 'GET /api/app/members',
  });
  return mapResult(result, (body) =>
    rowsOf(body, 'members').flatMap((row) => {
      const id = asString(row.userId) ?? asString(row.id);
      return id === undefined ? [] : [id];
    }),
  );
}

/** `GET /api/app/teams?orgId=` → the team ids. */
export async function listTeams(
  api: ApiClient,
  orgId: string,
): Promise<ApiResult<string[]>> {
  const result = await api.call<unknown>({
    method: 'GET',
    path: '/api/app/teams',
    query: orgQuery(orgId),
    name: 'GET /api/app/teams',
    refusals: [403],
  });
  return mapResult(result, (body) =>
    rowsOf(body, 'teams').flatMap((row) => {
      const id = asString(row.id) ?? asString(row._id);
      return id === undefined ? [] : [id];
    }),
  );
}

/** `GET /api/app/teams/directory?orgId=`. */
export function teamDirectory(
  api: ApiClient,
  orgId: string,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'GET',
    path: '/api/app/teams/directory',
    query: orgQuery(orgId),
    name: 'GET /api/app/teams/directory',
  });
}

/** `GET /api/app/teams/:teamId/members?orgId=`. */
export function teamMembers(
  api: ApiClient,
  orgId: string,
  teamId: string,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'GET',
    path: `/api/app/teams/${enc(teamId)}/members`,
    query: orgQuery(orgId),
    name: 'GET /api/app/teams/:teamId/members',
    refusals: [403, 404],
  });
}

/** `GET /api/app/audit-logs?limit=&orgId=` (owners and admins read). */
export function listAuditLogs(
  api: ApiClient,
  orgId: string,
  limit = 50,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'GET',
    path: '/api/app/audit-logs',
    query: orgQuery(orgId, { limit }),
    name: 'GET /api/app/audit-logs',
    refusals: [403],
  });
}

/** `GET /api/app/audit-logs/summary?periodDays=&orgId=`. */
export function auditLogSummary(
  api: ApiClient,
  orgId: string,
  periodDays = 30,
): Promise<ApiResult<unknown>> {
  return api.call({
    method: 'GET',
    path: '/api/app/audit-logs/summary',
    query: orgQuery(orgId, { periodDays }),
    name: 'GET /api/app/audit-logs/summary',
    refusals: [403],
  });
}
