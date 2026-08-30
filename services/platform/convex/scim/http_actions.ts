/**
 * SCIM 2.0 service-provider HTTP handlers (RFC 7644). The IdP is the client; it
 * pushes Users/Groups here over bearer-token auth. The matched token row IS the
 * tenant scope — org is NEVER read from the body or path.
 *
 * Supported: Users + Groups full CRUD, PATCH (active toggle, name, group
 * membership add/remove/replace), `attr eq "value"` filtering, startIndex/count
 * pagination, and the discovery endpoints. Arbitrary filter expressions beyond
 * `userName eq` / `displayName eq` / `members[value eq "…"]` are not supported.
 */

import { AppError } from '../../lib/shared/errors/app-error';
import { isRecord } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import { type ActionCtx, httpAction } from '../_generated/server';
import type { PlatformRole } from '../enterprise_sso/types';
import { normalizeAuthEmail } from '../lib/auth/normalize_auth_email';
import { getPublicHttpApiUrl } from '../lib/helpers/public_storage_url';
import { extractPathParts, parseIntParam } from '../lib/rest/helpers';
import { serviceProviderConfig, resourceTypes, schemas } from './discovery';
import { hashScimToken } from './helpers/crypto';
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
  SCIM_CORS_HEADERS,
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
}

type ScimAuthResult =
  | { ok: true; organizationId: string; defaultRole: PlatformRole }
  | { ok: false; response: Response };

async function authenticateScim(
  ctx: ActionCtx,
  req: Request,
): Promise<ScimAuthResult> {
  const header = req.headers.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) {
    return {
      ok: false,
      response: scimError(401, 'Missing or invalid Authorization header'),
    };
  }
  const token = header.slice('bearer '.length).trim();
  if (!token) {
    return { ok: false, response: scimError(401, 'Empty bearer token') };
  }
  const tokenHash = await hashScimToken(token);
  const config = await ctx.runQuery(
    internal.scim.internal_queries.getConfigByTokenHash,
    { tokenHash },
  );
  if (!config || !config.enabled) {
    return {
      ok: false,
      response: scimError(401, 'Invalid or revoked SCIM token'),
    };
  }
  await ctx.runMutation(internal.scim.internal_mutations.touchConfigLastUsed, {
    configId: config.configId,
  });
  return {
    ok: true,
    organizationId: config.organizationId,
    defaultRole: config.defaultRole,
  };
}

function withScimAuth(
  handler: (rc: ScimRc, req: Request) => Promise<Response>,
) {
  return httpAction(async (ctx, req) => {
    const auth = await authenticateScim(ctx, req);
    if (!auth.ok) return auth.response;
    try {
      return await handler(
        {
          ctx,
          organizationId: auth.organizationId,
          defaultRole: auth.defaultRole,
        },
        req,
      );
    } catch (error) {
      // A coded AppError from the provisioning layer maps to its SCIM
      // status — a cross-tenant create collision is a 409, not a 500 (#2036).
      if (error instanceof AppError && isRecord(error.data)) {
        const data = error.data;
        if (data.code === 'scim_user_conflict') {
          const detail =
            typeof data.message === 'string'
              ? data.message
              : 'User already exists';
          return scimError(409, detail, 'uniqueness');
        }
      }
      console.error('[scim] handler error', error);
      return scimError(500, 'Internal server error');
    }
  });
}

export const scimOptionsHandler = httpAction(
  async () => new Response(null, { status: 204, headers: SCIM_CORS_HEADERS }),
);

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export const scimServiceProviderConfigHandler = withScimAuth(async () =>
  scimJson(serviceProviderConfig()),
);

export const scimResourceTypesHandler = withScimAuth(async () =>
  scimJson(resourceTypes(scimBaseUrl())),
);

export const scimSchemasHandler = withScimAuth(async () => scimJson(schemas()));

// ---------------------------------------------------------------------------
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
  const all = await rc.ctx.runQuery(
    internal.scim.internal_queries.listUserRecords,
    { organizationId: rc.organizationId },
  );
  all.sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  const page = all.slice(startIndex - 1, startIndex - 1 + count);
  return scimListResponse(
    page.map((r) => toScimUser(r, baseUrl)),
    all.length,
    startIndex,
    page.length,
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

export const scimUsersHandler = withScimAuth(scimUsersImpl);

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

export const scimUserResourceHandler = withScimAuth(scimUserResourceImpl);

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
  const all = await rc.ctx.runQuery(
    internal.scim.internal_queries.listGroupRecords,
    { organizationId: rc.organizationId },
  );
  all.sort((a, b) => (a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0));
  const page = all.slice(startIndex - 1, startIndex - 1 + count);
  return scimListResponse(
    page.map((r) => toScimGroup(r, baseUrl)),
    all.length,
    startIndex,
    page.length,
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

export const scimGroupsHandler = withScimAuth(scimGroupsImpl);

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

export const scimGroupResourceHandler = withScimAuth(scimGroupResourceImpl);
