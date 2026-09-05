import type { PlatformRole } from '../enterprise_sso/types';
import { normalizeAuthEmail } from '../lib/auth/normalize_auth_email';
import type { ActionCtx } from '../lib/ctx';
import { internal } from '../lib/handler_names';
import { getPublicHttpApiUrl } from '../lib/helpers/public_storage_url';
import { extractPathParts, parseIntParam } from '../lib/rest/helpers';
/** The records the internal queries return — shaped by what the SCIM mappers
 *  read, so the two cannot drift apart. */
type ScimUserRecord = Parameters<typeof toScimUser>[0];
type ScimGroupRecord = Parameters<typeof toScimGroup>[0];
/** One SQL-paged listing: the page's records plus the collection total. */
interface ScimListPage<T> {
  records: T[];
  total: number;
}
import {
  parseEqFilter,
  parseGroupPatch,
  parseGroupResource,
  parseUserPatch,
  parseUserResource,
  resolvePatchedName,
  toScimGroup,
  toScimUser,
} from './mappers';
import {
  scimError,
  scimJson,
  scimListResponse,
  scimNoContent,
} from './responses';

const USERS_PREFIX = '/scim/v2/Users/';
const GROUPS_PREFIX = '/scim/v2/Groups/';

export interface ScimRc {
  ctx: ActionCtx;
  organizationId: string;
  defaultRole: PlatformRole;
}

/** Public SCIM base URL for `meta.location`, or undefined if SITE_URL unset. */
function scimBaseUrl(): string | undefined {
  try {
    return `${getPublicHttpApiUrl()}/scim/v2`;
  } catch {
    return undefined;
  }
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
} // ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

async function listUsers(rc: ScimRc, url: URL): Promise<Response> {
  const baseUrl = scimBaseUrl();
  const filter = url.searchParams.get('filter') ?? undefined;
  if (filter) {
    const userName = parseEqFilter(filter, 'userName');
    if (userName == null) {
      console.warn(`[scim] unsupported user filter: ${filter}`);
      return scimListResponse([], 0, 1, 0);
    }
    const rec = await rc.ctx.runQuery(
      internal.scim.internal_queries.findUserRecordByUserName,
      {
        organizationId: rc.organizationId,
        userName: normalizeAuthEmail(userName),
      },
    );
    const resources = rec ? [toScimUser(rec, baseUrl)] : [];
    return scimListResponse(resources, resources.length, 1, resources.length);
  }
  const startIndex = Math.max(1, parseIntParam(url, 'startIndex', 1));
  const count = Math.min(200, Math.max(0, parseIntParam(url, 'count', 100)));
  // Paged in SQL (ordered by user id): the query answers one page and the
  // collection total, so a poll never scans the whole org per page.
  const page: ScimListPage<ScimUserRecord> = await rc.ctx.runQuery(
    internal.scim.internal_queries.listUserRecords,
    { organizationId: rc.organizationId, offset: startIndex - 1, limit: count },
  );
  return scimListResponse(
    page.records.map((r) => toScimUser(r, baseUrl)),
    page.total,
    startIndex,
    page.records.length,
  );
}

async function createUser(rc: ScimRc, req: Request): Promise<Response> {
  const body = await readJson(req);
  if (body == null) return scimError(400, 'Invalid JSON body', 'invalidSyntax');
  const input = parseUserResource(body);
  if (!input) return scimError(400, 'userName is required', 'invalidValue');
  const existing = await rc.ctx.runQuery(
    internal.scim.internal_queries.findUserRecordByUserName,
    { organizationId: rc.organizationId, userName: input.email },
  );
  if (existing) {
    return scimError(409, `User ${input.email} already exists`, 'uniqueness');
  }
  const rec = await rc.ctx.runMutation(
    internal.scim.internal_mutations.provisionUser,
    {
      organizationId: rc.organizationId,
      defaultRole: rc.defaultRole,
      email: input.email,
      name: input.name,
      externalId: input.externalId,
      active: input.active,
    },
  );
  const full = await rc.ctx.runQuery(
    internal.scim.internal_queries.getUserRecord,
    { organizationId: rc.organizationId, userId: rec.userId },
  );
  return scimJson(toScimUser(full ?? rec, scimBaseUrl()), 201);
}

async function getUser(rc: ScimRc, userId: string): Promise<Response> {
  const rec = await rc.ctx.runQuery(
    internal.scim.internal_queries.getUserRecord,
    { organizationId: rc.organizationId, userId },
  );
  if (!rec) return scimError(404, `User ${userId} not found`);
  return scimJson(toScimUser(rec, scimBaseUrl()));
}

async function replaceUser(
  rc: ScimRc,
  req: Request,
  userId: string,
): Promise<Response> {
  const existing = await rc.ctx.runQuery(
    internal.scim.internal_queries.getUserRecord,
    { organizationId: rc.organizationId, userId },
  );
  if (!existing) return scimError(404, `User ${userId} not found`);
  const body = await readJson(req);
  if (body == null) return scimError(400, 'Invalid JSON body', 'invalidSyntax');
  const input = parseUserResource(body);
  if (!input) return scimError(400, 'userName is required', 'invalidValue');
  await rc.ctx.runMutation(internal.scim.internal_mutations.patchUser, {
    organizationId: rc.organizationId,
    userId,
    defaultRole: rc.defaultRole,
    active: input.active,
    name: input.name,
    email: input.email,
    externalId: input.externalId,
  });
  const full = await rc.ctx.runQuery(
    internal.scim.internal_queries.getUserRecord,
    { organizationId: rc.organizationId, userId },
  );
  return scimJson(toScimUser(full ?? existing, scimBaseUrl()));
}

async function patchUserResource(
  rc: ScimRc,
  req: Request,
  userId: string,
): Promise<Response> {
  const existing = await rc.ctx.runQuery(
    internal.scim.internal_queries.getUserRecord,
    { organizationId: rc.organizationId, userId },
  );
  if (!existing) return scimError(404, `User ${userId} not found`);
  const body = await readJson(req);
  if (body == null) return scimError(400, 'Invalid JSON body', 'invalidSyntax');
  const patch = parseUserPatch(body);
  const name = resolvePatchedName(existing.name, patch);
  await rc.ctx.runMutation(internal.scim.internal_mutations.patchUser, {
    organizationId: rc.organizationId,
    userId,
    defaultRole: rc.defaultRole,
    active: patch.active,
    name,
    email: patch.email,
  });
  const full = await rc.ctx.runQuery(
    internal.scim.internal_queries.getUserRecord,
    { organizationId: rc.organizationId, userId },
  );
  return scimJson(toScimUser(full ?? existing, scimBaseUrl()));
}

async function deleteUser(rc: ScimRc, userId: string): Promise<Response> {
  // A SCIM DELETE removes the resource: the user is de-provisioned from this
  // org so a later GET returns 404 (RFC 7644 §3.6). A plain disable is the
  // separate `PATCH active:false` path (soft-deactivate, restorable).
  const result = await rc.ctx.runMutation(
    internal.scim.internal_mutations.deprovisionUser,
    { organizationId: rc.organizationId, userId },
  );
  if (result === 'not-found') return scimError(404, `User ${userId} not found`);
  if (result === 'owner-protected') {
    return scimError(
      403,
      'Cannot de-provision the organization owner',
      'mutability',
    );
  }
  return scimNoContent();
}

/** The Users collection dispatcher body — exported for the 0.5 runtime,
 * which authenticates with its own token store and calls in with a shimmed
 * ctx. */
export async function scimUsersImpl(
  rc: ScimRc,
  req: Request,
): Promise<Response> {
  if (req.method === 'GET') return listUsers(rc, new URL(req.url));
  if (req.method === 'POST') return createUser(rc, req);
  return scimError(405, 'Method not allowed');
}
/** One-User dispatcher body — exported for the 0.5 runtime. */
export async function scimUserResourceImpl(
  rc: ScimRc,
  req: Request,
): Promise<Response> {
  const { id } = extractPathParts(new URL(req.url), USERS_PREFIX);
  if (!id) return scimError(400, 'Missing user id');
  if (req.method === 'GET') return getUser(rc, id);
  if (req.method === 'PUT') return replaceUser(rc, req, id);
  if (req.method === 'PATCH') return patchUserResource(rc, req, id);
  if (req.method === 'DELETE') return deleteUser(rc, id);
  return scimError(405, 'Method not allowed');
}
// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

async function listGroups(rc: ScimRc, url: URL): Promise<Response> {
  const baseUrl = scimBaseUrl();
  const filter = url.searchParams.get('filter') ?? undefined;
  if (filter) {
    const displayName = parseEqFilter(filter, 'displayName');
    if (displayName == null) {
      console.warn(`[scim] unsupported group filter: ${filter}`);
      return scimListResponse([], 0, 1, 0);
    }
    const rec = await rc.ctx.runQuery(
      internal.scim.internal_queries.findGroupRecordByDisplayName,
      { organizationId: rc.organizationId, displayName },
    );
    const resources = rec ? [toScimGroup(rec, baseUrl)] : [];
    return scimListResponse(resources, resources.length, 1, resources.length);
  }
  const startIndex = Math.max(1, parseIntParam(url, 'startIndex', 1));
  const count = Math.min(200, Math.max(0, parseIntParam(url, 'count', 100)));
  const page: ScimListPage<ScimGroupRecord> = await rc.ctx.runQuery(
    internal.scim.internal_queries.listGroupRecords,
    { organizationId: rc.organizationId, offset: startIndex - 1, limit: count },
  );
  return scimListResponse(
    page.records.map((r) => toScimGroup(r, baseUrl)),
    page.total,
    startIndex,
    page.records.length,
  );
}

async function createGroup(rc: ScimRc, req: Request): Promise<Response> {
  const body = await readJson(req);
  if (body == null) return scimError(400, 'Invalid JSON body', 'invalidSyntax');
  const input = parseGroupResource(body);
  if (!input) return scimError(400, 'displayName is required', 'invalidValue');
  const existing = await rc.ctx.runQuery(
    internal.scim.internal_queries.findGroupRecordByDisplayName,
    { organizationId: rc.organizationId, displayName: input.displayName },
  );
  if (existing) {
    return scimError(
      409,
      `Group ${input.displayName} already exists`,
      'uniqueness',
    );
  }
  const rec = await rc.ctx.runMutation(
    internal.scim.internal_mutations.provisionGroup,
    {
      organizationId: rc.organizationId,
      displayName: input.displayName,
      externalId: input.externalId,
      memberIds: input.memberIds,
    },
  );
  const full = await rc.ctx.runQuery(
    internal.scim.internal_queries.getGroupRecord,
    { organizationId: rc.organizationId, teamId: rec.teamId },
  );
  return scimJson(toScimGroup(full ?? rec, scimBaseUrl()), 201);
}

async function getGroup(rc: ScimRc, teamId: string): Promise<Response> {
  const rec = await rc.ctx.runQuery(
    internal.scim.internal_queries.getGroupRecord,
    { organizationId: rc.organizationId, teamId },
  );
  if (!rec) return scimError(404, `Group ${teamId} not found`);
  return scimJson(toScimGroup(rec, scimBaseUrl()));
}

async function replaceGroup(
  rc: ScimRc,
  req: Request,
  teamId: string,
): Promise<Response> {
  const existing = await rc.ctx.runQuery(
    internal.scim.internal_queries.getGroupRecord,
    { organizationId: rc.organizationId, teamId },
  );
  if (!existing) return scimError(404, `Group ${teamId} not found`);
  const body = await readJson(req);
  if (body == null) return scimError(400, 'Invalid JSON body', 'invalidSyntax');
  const input = parseGroupResource(body);
  if (!input) return scimError(400, 'displayName is required', 'invalidValue');
  await rc.ctx.runMutation(internal.scim.internal_mutations.replaceGroup, {
    organizationId: rc.organizationId,
    teamId,
    displayName: input.displayName,
    memberIds: input.memberIds,
    externalId: input.externalId,
  });
  const full = await rc.ctx.runQuery(
    internal.scim.internal_queries.getGroupRecord,
    { organizationId: rc.organizationId, teamId },
  );
  return scimJson(toScimGroup(full ?? existing, scimBaseUrl()));
}

async function patchGroupResource(
  rc: ScimRc,
  req: Request,
  teamId: string,
): Promise<Response> {
  const existing = await rc.ctx.runQuery(
    internal.scim.internal_queries.getGroupRecord,
    { organizationId: rc.organizationId, teamId },
  );
  if (!existing) return scimError(404, `Group ${teamId} not found`);
  const body = await readJson(req);
  if (body == null) return scimError(400, 'Invalid JSON body', 'invalidSyntax');
  const patch = parseGroupPatch(body);
  await rc.ctx.runMutation(internal.scim.internal_mutations.patchGroup, {
    organizationId: rc.organizationId,
    teamId,
    displayName: patch.displayName,
    addMembers: patch.addMembers,
    removeMembers: patch.removeMembers,
    replaceMembers: patch.replaceMembers,
  });
  const full = await rc.ctx.runQuery(
    internal.scim.internal_queries.getGroupRecord,
    { organizationId: rc.organizationId, teamId },
  );
  return scimJson(toScimGroup(full ?? existing, scimBaseUrl()));
}

async function deleteGroupResource(
  rc: ScimRc,
  teamId: string,
): Promise<Response> {
  const deleted = await rc.ctx.runMutation(
    internal.scim.internal_mutations.deleteGroup,
    { organizationId: rc.organizationId, teamId },
  );
  if (!deleted) return scimError(404, `Group ${teamId} not found`);
  return scimNoContent();
}

/** The Groups collection dispatcher body — exported for the 0.5 runtime. */
export async function scimGroupsImpl(
  rc: ScimRc,
  req: Request,
): Promise<Response> {
  if (req.method === 'GET') return listGroups(rc, new URL(req.url));
  if (req.method === 'POST') return createGroup(rc, req);
  return scimError(405, 'Method not allowed');
}
/** One-Group dispatcher body — exported for the 0.5 runtime. */
export async function scimGroupResourceImpl(
  rc: ScimRc,
  req: Request,
): Promise<Response> {
  const { id } = extractPathParts(new URL(req.url), GROUPS_PREFIX);
  if (!id) return scimError(400, 'Missing group id');
  if (req.method === 'GET') return getGroup(rc, id);
  if (req.method === 'PUT') return replaceGroup(rc, req, id);
  if (req.method === 'PATCH') return patchGroupResource(rc, req, id);
  if (req.method === 'DELETE') return deleteGroupResource(rc, id);
  return scimError(405, 'Method not allowed');
}
