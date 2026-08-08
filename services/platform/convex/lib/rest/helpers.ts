/**
 * Shared REST API helpers for manual HTTP endpoints.
 *
 * Provides authentication, organization resolution, response builders,
 * URL parsing, and CORS handling used across all /api/v1/* REST routes.
 */

import { ConvexError } from 'convex/values';

import { defineAbilityFor } from '../../../lib/permissions/ability';
import { components, internal } from '../../_generated/api';
import { httpAction } from '../../_generated/server';
import { createAuth } from '../../auth';
import {
  checkIpRateLimit,
  RateLimitExceededError,
} from '../rate_limiter/helpers';
import { getClientIp, loadTrustedProxies } from '../utils/client_ip';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Context type for httpAction handlers. */
export type HttpCtx = Parameters<Parameters<typeof httpAction>[0]>[0];

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

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

export const REST_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export const restOptionsHandler = httpAction(async () => {
  return new Response(null, { status: 204, headers: REST_CORS_HEADERS });
});

// ---------------------------------------------------------------------------
// Response builders
// ---------------------------------------------------------------------------

export function jsonOk(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...REST_CORS_HEADERS },
  });
}

export function jsonCreated(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 201,
    headers: { 'Content-Type': 'application/json', ...REST_CORS_HEADERS },
  });
}

/**
 * The work was accepted but has not finished — a durable automation run, a chat
 * turn. The body carries whatever identity the caller polls with.
 */
export function jsonAccepted(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 202,
    headers: { 'Content-Type': 'application/json', ...REST_CORS_HEADERS },
  });
}

export function jsonNoContent(): Response {
  return new Response(null, { status: 204, headers: REST_CORS_HEADERS });
}

export function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...REST_CORS_HEADERS },
  });
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/**
 * Stamp the API key's `lastRequest` so the Settings → API table can show a
 * real "Last used" instead of "Never used".
 *
 * Better Auth's api-key session hook is supposed to record this itself, but its
 * write goes through the component adapter, which the Convex Better Auth plugin
 * turns into a no-op outside a mutation-capable request — so a plain `getSession`
 * auth on a `/api/v1/*` HTTP action never persists it. We write the field
 * directly on the component row instead (same mechanism as the create-time
 * suffix stamp in `auth.ts`), which is deterministic in the HTTP-action context.
 *
 * Best-effort: a stamp failure must never break an otherwise valid request, so
 * this swallows its own errors — the worst case is the pre-existing behaviour of
 * the row still reading "Never used".
 */
async function recordApiKeyLastUsed(
  ctx: HttpCtx,
  apiKeyId: string,
): Promise<void> {
  try {
    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'apikey',
        where: [{ field: '_id', value: apiKeyId, operator: 'eq' }],
        update: { lastRequest: Date.now() },
      },
      paginationOpts: { cursor: null, numItems: 1 },
    });
  } catch (err) {
    console.warn(
      '[rest-auth] failed to record API key last-used',
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Authenticate a REST request via Bearer token.
 * Extracts the API key from the Authorization header and validates it
 * through BetterAuth, returning the authenticated user info.
 */
export async function authenticateRequest(
  ctx: HttpCtx,
  request: Request,
): Promise<AuthUser> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthError('Missing or invalid Authorization header');
  }

  const apiKey = authHeader.slice('Bearer '.length).trim();
  if (!apiKey) {
    throw new AuthError('Empty API key');
  }

  const syntheticHeaders = new Headers();
  syntheticHeaders.set('x-api-key', apiKey);

  const auth = createAuth(ctx);
  try {
    const session = await auth.api.getSession({
      headers: syntheticHeaders,
    });

    if (!session?.user) {
      throw new AuthError('Invalid API key or session');
    }

    // For an api-key session, Better Auth sets `session.id` to the api-key
    // row's id (see @better-auth/api-key session hook). Stamp last-used so the
    // key stops reading "Never used" after real authenticated calls (#2317).
    const apiKeyId =
      typeof session.session?.id === 'string' ? session.session.id : undefined;
    if (apiKeyId) {
      await recordApiKeyLastUsed(ctx, apiKeyId);
    }

    return {
      userId: session.user.id,
      email: session.user.email ?? '',
      name: session.user.name ?? '',
    };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError('Invalid API key or session');
  }
}

/**
 * Resolve the user's organization automatically.
 * For single-org deployments, this finds the user's sole membership.
 */
export async function resolveOrganization(
  ctx: HttpCtx,
  userId: string,
): Promise<OrgInfo> {
  return await ctx.runQuery(
    internal.organizations.resolve_user_organization.resolveUserOrganization,
    { userId },
  );
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
  const role = await rc.ctx.runQuery(
    internal.members.internal_queries.getMemberRole,
    { userId: rc.user.userId, organizationId: rc.org.organizationId },
  );
  if (role === null || role === 'disabled') {
    throw new ConvexError({
      code: 'ORG_FORBIDDEN',
      message: `Not a member of organization "${rc.org.orgSlug}".`,
    });
  }
  return role;
}

/**
 * Whether the key holder may administer the organization's shared
 * configuration — the `orgSettings` write capability, which is what lets an
 * admin curate an org-visible agent or skill they do not own. The same flag
 * the session-authenticated actions hand to the config file layer.
 */
export async function restCallerIsOrgAdmin(rc: RestContext): Promise<boolean> {
  const role = await resolveRestOrgRole(rc);
  return defineAbilityFor(role).can('write', 'orgSettings');
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
    throw new ConvexError({
      code: 'FORBIDDEN_DEVELOPER_SETTINGS',
      message: `Role "${role}" lacks the developer-settings capability required to perform this action.`,
    });
  }
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * Apply IP-based rate limiting. Returns an error response if exceeded,
 * or null if the request is allowed.
 */
export async function applyRateLimit(
  ctx: HttpCtx,
  key: string,
  request: Request,
): Promise<Response | null> {
  const trusted = await loadTrustedProxies(ctx);
  const ip = getClientIp(request.headers, trusted);
  try {
    await checkIpRateLimit(ctx, key, ip);
    return null;
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return jsonError('Rate limit exceeded', 429);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

/**
 * Extract path segments after a prefix.
 *
 * Example: extractPathParts('/api/v1/documents/abc123/retry-indexing', '/api/v1/documents/')
 *   → { id: 'abc123', subPath: 'retry-indexing' }
 *
 * Example: extractPathParts('/api/v1/documents/abc123', '/api/v1/documents/')
 *   → { id: 'abc123', subPath: null }
 */
export function extractPathParts(
  url: URL,
  prefix: string,
): { id: string; subPath: string | null } {
  const rest = url.pathname.slice(prefix.length);
  const parts = rest.split('/').filter(Boolean);
  return {
    id: parts[0] ?? '',
    subPath: parts.length > 1 ? parts.slice(1).join('/') : null,
  };
}

/**
 * Parse query string parameters from a URL.
 * Returns string values for specified keys, or undefined if not present.
 */
export function parseQueryParams(
  url: URL,
  keys: string[],
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const key of keys) {
    result[key] = url.searchParams.get(key) ?? undefined;
  }
  return result;
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

/**
 * A page size a client asked for, clamped into what the backing read will
 * serve. An absent, unparseable, or out-of-range `limit` resolves to something
 * usable rather than refusing the request — the bound is the server's, not the
 * client's, and a listing has no security dependency on it.
 */
export function parsePageLimit(
  url: URL,
  defaultValue: number,
  maxValue: number,
): number {
  const parsed = parseIntParam(url, 'limit', defaultValue);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(Math.max(1, Math.trunc(parsed)), maxValue);
}

// ---------------------------------------------------------------------------
// Request-body validation
// ---------------------------------------------------------------------------

/**
 * A malformed request body or query. Thrown by the readers below and mapped to
 * 400 by {@link withRestAuth}, so a handler validates by reading rather than by
 * branching — every unchecked field is a boundary an attacker chooses.
 */
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The request body as a JSON object. A non-JSON body, a JSON array, and a bare
 * scalar are all refused: every write endpoint here takes an object, so
 * anything else is a client mistake worth reporting rather than a `{}` to
 * silently apply.
 */
export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new BadRequestError('Request body must be valid JSON');
  }
  if (!isPlainObject(raw)) {
    throw new BadRequestError('Request body must be a JSON object');
  }
  return raw;
}

/**
 * Like {@link readJsonObject}, but an EMPTY body reads as `{}`. For endpoints
 * whose body is entirely optional (starting a run with no input), where
 * demanding `{}` on the wire would be pedantry; a present-but-malformed body is
 * still refused.
 */
export async function readJsonObjectOrEmpty(
  request: Request,
): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.trim().length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestError('Request body must be valid JSON');
  }
  if (!isPlainObject(parsed)) {
    throw new BadRequestError('Request body must be a JSON object');
  }
  return parsed;
}

/** A required, non-empty string field. */
export function requiredString(
  body: Record<string, unknown>,
  key: string,
  maxLength = 100_000,
): string {
  const value = body[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestError(`"${key}" must be a non-empty string`);
  }
  if (value.length > maxLength) {
    throw new BadRequestError(
      `"${key}" must be at most ${maxLength} characters`,
    );
  }
  return value;
}

/** An optional string field — absent and `null` both read as "not given". */
export function optionalString(
  body: Record<string, unknown>,
  key: string,
  maxLength = 100_000,
): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new BadRequestError(`"${key}" must be a string`);
  }
  if (value.length > maxLength) {
    throw new BadRequestError(
      `"${key}" must be at most ${maxLength} characters`,
    );
  }
  return value;
}

/** An optional boolean field. */
export function optionalBoolean(
  body: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') {
    throw new BadRequestError(`"${key}" must be a boolean`);
  }
  return value;
}

/** An optional finite number field, bounded to `[min, max]`. */
export function optionalNumber(
  body: Record<string, unknown>,
  key: string,
  bounds: { min: number; max: number },
): number | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BadRequestError(`"${key}" must be a number`);
  }
  if (value < bounds.min || value > bounds.max) {
    throw new BadRequestError(
      `"${key}" must be between ${bounds.min} and ${bounds.max}`,
    );
  }
  return value;
}

/** An optional array-of-strings field. */
export function optionalStringArray(
  body: Record<string, unknown>,
  key: string,
  maxItems = 200,
): string[] | undefined {
  const value = optionalStringArrayOrNull(body, key, maxItems);
  return value === null ? undefined : value;
}

/**
 * An optional array-of-strings field where `null` is a VALUE, not an absence.
 * The agent binding lists mean three different things — absent keeps the
 * current narrowing, `[]` narrows to nothing, `null` removes the narrowing —
 * and collapsing null into absent would make a widening inexpressible.
 */
export function optionalStringArrayOrNull(
  body: Record<string, unknown>,
  key: string,
  maxItems = 200,
): string[] | null | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new BadRequestError(`"${key}" must be an array of strings, or null`);
  }
  if (value.length > maxItems) {
    throw new BadRequestError(`"${key}" must have at most ${maxItems} items`);
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every element was just checked to be a string
  return value as string[];
}

/** One of a closed set of literals. */
export function optionalEnum<T extends string>(
  body: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  // Find the allowed literal EQUAL to the value, rather than asserting the
  // value into the literal type — the match is the proof.
  const match =
    typeof value === 'string'
      ? allowed.find((candidate) => candidate === value)
      : undefined;
  if (match === undefined) {
    throw new BadRequestError(`"${key}" must be one of: ${allowed.join(', ')}`);
  }
  return match;
}

// ---------------------------------------------------------------------------
// High-level handler wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap an httpAction handler with authentication, org resolution,
 * rate limiting, and error handling.
 *
 * Usage:
 * ```ts
 * export const listDocuments = withRestAuth('rest:documents', async (rc, request) => {
 *   const docs = await rc.ctx.runQuery(internal.documents.internal_queries.queryDocuments, {
 *     organizationId: rc.org.organizationId,
 *   });
 *   return jsonOk(docs);
 * });
 * ```
 */
export function withRestAuth(
  rateLimitKey: string,
  handler: (rc: RestContext, request: Request) => Promise<Response>,
) {
  return httpAction(async (ctx, request) => {
    // Rate limit
    const rateLimited = await applyRateLimit(ctx, rateLimitKey, request);
    if (rateLimited) return rateLimited;

    // Auth
    let user: AuthUser;
    try {
      user = await authenticateRequest(ctx, request);
    } catch (error) {
      if (error instanceof AuthError) {
        return jsonError(error.message, 401);
      }
      throw error;
    }

    // Org resolution
    let org: OrgInfo;
    try {
      org = await resolveOrganization(ctx, user.userId);
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : 'Failed to resolve organization';
      return jsonError(msg, 400);
    }

    // Delegate to handler
    try {
      return await handler({ ctx, user, org }, request);
    } catch (error) {
      // A body/query the handler refused to read is the client's mistake.
      if (error instanceof BadRequestError) {
        return jsonError(error.message, 400);
      }
      // Map structured ConvexError codes to proper HTTP statuses so
      // typed errors thrown by mutations (e.g. cross-tenant rejections,
      // legal-hold blocks) surface to REST clients as actionable
      // 4xx responses rather than opaque 500s.
      if (error instanceof ConvexError) {
        const data = error.data;
        const code =
          typeof data === 'object' &&
          data !== null &&
          'code' in data &&
          typeof data.code === 'string'
            ? data.code
            : undefined;
        const dataMessage =
          typeof data === 'object' &&
          data !== null &&
          'message' in data &&
          typeof data.message === 'string'
            ? data.message
            : undefined;
        const message = dataMessage ?? error.message;
        const status = httpStatusForConvexCode(code);
        if (status >= 400 && status < 500) {
          return jsonError(message, status);
        }
      }
      console.error(`[REST ${rateLimitKey}]`, error);
      const msg =
        error instanceof Error ? error.message : 'Internal server error';
      return jsonError(msg, 500);
    }
  });
}

export function httpStatusForConvexCode(code: string | undefined): number {
  switch (code) {
    case 'unauthenticated':
    case 'UNAUTHENTICATED':
      return 401;
    case 'forbidden':
    case 'FORBIDDEN':
    // The caller is a member but their role lacks the capability the write
    // needs (`requireOrgAdminOrDeveloper`, and the same capability check the
    // automation run path applies to an API key).
    case 'FORBIDDEN_DEVELOPER_SETTINGS':
    case 'ORG_FORBIDDEN':
    case 'PROJECT_FORBIDDEN':
    // Config-file ownership: the caller may see the agent/skill but is not the
    // owner and is not an org admin, so they may not change it.
    case 'AGENT_FORBIDDEN':
    case 'SKILL_FORBIDDEN':
      return 403;
    case 'not_found':
    case 'ORG_NOT_FOUND':
    case 'PROJECT_NOT_FOUND':
    case 'WEBSITE_NOT_FOUND':
    case 'CRAWLER_WEBSITE_NOT_FOUND':
    case 'DOCUMENT_NOT_FOUND':
    case 'FOLDER_NOT_FOUND':
    case 'CONTACT_NOT_FOUND':
    case 'AUTOMATION_RUN_NOT_FOUND':
    case 'KNOWLEDGE_ENTRY_NOT_FOUND':
      return 404;
    case 'validation':
    case 'MISSING_FILTER':
    case 'too_long':
    case 'invalid_locale':
    case 'INVALID_SCAN_INTERVAL':
    // The automation store refused the document itself (an unknown project
    // owner, a name that is not a slug) — a bad request, not a conflict.
    case 'AUTOMATION_SAVE_REJECTED':
    case 'AUTOMATION_TRIGGER_REJECTED':
    // The config-file domains reject a malformed slug or document before they
    // touch the filesystem.
    case 'INVALID_AGENT':
    case 'INVALID_AGENT_SLUG':
    case 'INVALID_SKILL':
    case 'INVALID_SKILL_SLUG':
    // Knowledge-entry field validation (`validateTopicAndContent`).
    case 'KNOWLEDGE_ENTRY_TOPIC_REQUIRED':
    case 'KNOWLEDGE_ENTRY_TOPIC_TOO_LONG':
    case 'KNOWLEDGE_ENTRY_CONTENT_REQUIRED':
    case 'KNOWLEDGE_ENTRY_CONTENT_TOO_LONG':
      return 400;
    // Duplicate-add rejections: a conflicting row already exists. Map to 409
    // so REST clients get an actionable conflict instead of an opaque 500.
    case 'WEBSITE_DUPLICATE_DOMAIN':
    case 'DUPLICATE_EMAIL':
    case 'DUPLICATE_EXTERNAL_ID':
    case 'DUPLICATE_DOMAIN':
    case 'CONTACT_DUPLICATE_EMAIL':
    case 'CONTACT_DUPLICATE_EXTERNAL_ID':
    case 'DUPLICATE_PRODUCT_NAME':
    case 'KNOWLEDGE_ENTRY_DUPLICATE':
    // State conflicts: the resource exists but is not in a state that can
    // serve the request. Nothing the caller can fix by changing the body.
    case 'AUTOMATION_NOT_DEPLOYED':
    case 'AUTOMATION_DEPLOY_REJECTED':
    case 'KNOWLEDGE_ENTRY_NOT_ACTIVE':
    case 'KNOWLEDGE_EMBEDDING_NOT_CONFIGURED':
    // Controlled records: the document exists but its record state refuses
    // the write — frozen content (in_review/approved) or a protected delete.
    // Resolve the review / open a revision first.
    case 'DOCUMENT_RECORD_FROZEN':
    case 'DOCUMENT_RECORD_PROTECTED':
      return 409;
    default:
      // Codes we don't recognize fall through to the 500 path so the
      // outer console.error still logs them; no silent swallow.
      return 500;
  }
}
