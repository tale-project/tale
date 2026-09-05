/**
 * Helpers of the two 0.4-era HTTP doors that still parse raw requests: the
 * SCIM door (`core/scim/http_actions.ts` — `extractPathParts`,
 * `parseIntParam`) and the MCP protocol layer
 * (`core/automations_builder/mcp_http.ts` — `jsonError`,
 * `requireRestDeveloper`, `RestContext`). The `/api/v1` REST families do NOT
 * come through here: `backend/rest/` authenticates, rate limits, validates
 * and maps errors on its own (`rest/shared.ts`).
 */

import { defineAbilityFor } from '../../../../lib/permissions/ability';
import { AppError } from '../../../../lib/shared/errors/app-error';
import { internal } from '../handler_names';
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What a REST handler reads off its context: the shim's dispatch, nothing
 *  more. The 0.4 `httpAction` wrapper that used to supply it retired with the
 *  runtime — the backend's own door (`backend/rest/`) authenticates, rate
 *  limits, and calls these handlers directly. */
export interface HttpCtx {
  runQuery: (reference: unknown, args?: unknown) => Promise<unknown>;
  runMutation: (reference: unknown, args?: unknown) => Promise<unknown>;
  runAction: (reference: unknown, args?: unknown) => Promise<unknown>;
}

export interface AuthUser {
  userId: string;
  email: string;
  name: string;
}

export interface OrgInfo {
  organizationId: string;
  orgSlug: string;
}

export interface RestContext {
  ctx: HttpCtx;
  user: AuthUser;
  org: OrgInfo;
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

const REST_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Organization-Slug',
  'Access-Control-Max-Age': '86400',
};

// ---------------------------------------------------------------------------
// Response builders
// ---------------------------------------------------------------------------

export function jsonError(
  message: string,
  status: number,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...REST_CORS_HEADERS,
      ...headers,
    },
  });
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

/**
 * The key holder's role in the resolved organization.
 *
 * Resolved LAZILY rather than on every request: most REST handlers only need
 * membership, which org resolution already proved, and the role costs another
 * Better Auth read. A handler that gates on a capability asks for it here.
 *
 * A missing or `disabled` member row is refused as `ORG_FORBIDDEN` — the same
 * answer `requireOrgMembershipById` gives a session caller, so an API key is
 * never a way around a revoked membership.
 */
export async function resolveRestOrgRole(rc: RestContext): Promise<string> {
  // The shim answers whatever its handler returns; a role is a string or
  // absent, and anything else is a broken handler, not a role.
  const role: unknown = await rc.ctx.runQuery(
    internal.members.internal_queries.getMemberRole,
    { userId: rc.user.userId, organizationId: rc.org.organizationId },
  );
  if (typeof role !== 'string' || role === 'disabled') {
    throw new AppError({
      code: 'ORG_FORBIDDEN',
      message: `Not a member of organization "${rc.org.orgSlug}".`,
    });
  }
  return role;
}

/**
 * Assert the `developerSettings` capability — the gate on authoring and on
 * starting a LIVE automation run. Throws `FORBIDDEN_DEVELOPER_SETTINGS`, the
 * same coded error `requireOrgAdminOrDeveloper` raises for a session caller,
 * so both surfaces answer a wrong role identically (→ 403).
 */
export async function requireRestDeveloper(rc: RestContext): Promise<void> {
  const role = await resolveRestOrgRole(rc);
  if (defineAbilityFor(role).cannot('read', 'developerSettings')) {
    throw new AppError({
      code: 'FORBIDDEN_DEVELOPER_SETTINGS',
      message: `Role "${role}" lacks the developer-settings capability required to perform this action.`,
    });
  }
}

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

/**
 * Extract path segments after a prefix.
 *
 * The prefix is LOCATED in the pathname rather than assumed at position 0:
 * some doors are mounted on more than one path (the SCIM routes serve
 * `/scim/v2/...` and the 0.4 proxy-era alias `/http_api/scim/v2/...` — the
 * one the admin UI advertises as the tenant URL), and the handlers parse the
 * RAW request URL, which carries whichever mount the caller used. Every
 * prefix starts with `/`, so a match always sits on a segment boundary. A
 * pathname that does not contain the prefix yields an empty id — the caller
 * answers 400/404 — instead of mis-slicing unrelated segments into an id
 * (the bug that broke per-resource SCIM ops on the advertised alias, where
 * `/http_api/scim/` is exactly as long as `/scim/v2/Users/`).
 *
 * Example: extractPathParts('/api/v1/documents/abc123/retry-indexing', '/api/v1/documents/')
 *   → { id: 'abc123', subPath: 'retry-indexing' }
 *
 * Example: extractPathParts('/http_api/scim/v2/Users/u1', '/scim/v2/Users/')
 *   → { id: 'u1', subPath: null }
 */
export function extractPathParts(
  url: URL,
  prefix: string,
): { id: string; subPath: string | null } {
  const at = url.pathname.indexOf(prefix);
  if (at === -1) {
    return { id: '', subPath: null };
  }
  const rest = url.pathname.slice(at + prefix.length);
  const parts = rest.split('/').filter(Boolean);
  return {
    id: parts[0] ?? '',
    subPath: parts.length > 1 ? parts.slice(1).join('/') : null,
  };
}

/**
 * Parse numeric query parameter with a default value.
 */
export function parseIntParam(
  url: URL,
  key: string,
  defaultValue: number,
): number {
  const val = url.searchParams.get(key);
  if (!val) return defaultValue;
  const parsed = parseInt(val, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}
