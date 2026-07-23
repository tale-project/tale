/**
 * Shared REST API helpers for manual HTTP endpoints.
 *
 * Provides authentication, organization resolution, response builders,
 * URL parsing, and CORS handling used across all /api/v1/* REST routes.
 */

import { ConvexError } from 'convex/values';

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
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
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
      return 403;
    case 'not_found':
    case 'VENDOR_NOT_FOUND':
    case 'CUSTOMER_NOT_FOUND':
    case 'WEBSITE_NOT_FOUND':
    case 'DOCUMENT_NOT_FOUND':
    case 'FOLDER_NOT_FOUND':
      return 404;
    case 'validation':
    case 'EMAIL_REQUIRED':
    case 'MISSING_FILTER':
    case 'too_long':
      return 400;
    // Duplicate-add rejections: a conflicting row already exists. Map to 409
    // so REST clients get an actionable conflict instead of an opaque 500.
    case 'CUSTOMER_DUPLICATE_EMAIL':
    case 'CUSTOMER_DUPLICATE_EXTERNAL_ID':
    case 'VENDOR_DUPLICATE_EMAIL':
    case 'VENDOR_DUPLICATE_EXTERNAL_ID':
    case 'WEBSITE_DUPLICATE_DOMAIN':
    case 'DUPLICATE_EMAIL':
    case 'DUPLICATE_EXTERNAL_ID':
    case 'DUPLICATE_DOMAIN':
      return 409;
    default:
      // Codes we don't recognize fall through to the 500 path so the
      // outer console.error still logs them; no silent swallow.
      return 500;
  }
}
