import { anyApi } from 'convex/server';

import { backendErrorCode } from '../errors';
import { buildDavPath, lockKeyFromParsed } from '../paths';
import {
  WEBDAV_MAX_XML_BODY,
  type AuthContext,
  type ParsedPath,
  type WebDAVCtx,
  type WebDAVRequest,
  type WebDAVResponse,
} from '../types';
import { buildDavError, DAV_ERROR_HEADERS } from '../xml/error-body';
import {
  isOwnerExtractError,
  parseIfHeaderTokens,
  parseLockBody,
  parseTimeoutHeader,
} from '../xml/lock-request';
import { buildLockResponse } from '../xml/lock-response';

const DEFAULT_TIMEOUT_SEC = 600; // 10 min if client doesn't specify
const MAX_TIMEOUT_SEC = 60 * 60; // 1h cap

export async function handleLock(
  req: WebDAVRequest,
  ctx: WebDAVCtx,
  auth: AuthContext,
  parsed: ParsedPath,
): Promise<WebDAVResponse> {
  if (parsed.namespace === '.trash') {
    return { status: 403, headers: {}, body: 'Trash is read-only' };
  }
  if (parsed.segments.length === 0) {
    return { status: 403, headers: {}, body: 'Cannot lock root' };
  }

  // Depth header validation (RFC 4918 §9.10.3). Only "0", "infinity",
  // or absent are valid for LOCK. Other values are a client bug.
  const depthHeaderRaw = req.headers.get('depth');
  let requestedDepth: '0' | 'infinity' | null = null;
  if (depthHeaderRaw !== null) {
    const lower = depthHeaderRaw.toLowerCase();
    if (lower === '0') requestedDepth = '0';
    else if (lower === 'infinity') requestedDepth = 'infinity';
    else {
      return {
        status: 400,
        headers: {},
        body: 'Invalid Depth header for LOCK (must be 0 or infinity)',
      };
    }
  }

  const body = await req.readText(WEBDAV_MAX_XML_BODY);
  const lockBodyResult = parseLockBody(body);
  if (isOwnerExtractError(lockBodyResult)) {
    return {
      status: 400,
      headers: {},
      body: `Hostile XML in <owner>: ${lockBodyResult.kind} declarations are forbidden`,
    };
  }
  const lockInfo = lockBodyResult;
  const timeoutSec = clampTimeout(
    parseTimeoutHeader(req.headers.get('timeout')),
  );

  // Refresh path: LOCK with If: header + empty body.
  if (!lockInfo) {
    const tokens = parseIfHeaderTokens(req.headers.get('if'));
    if (tokens.length === 0) {
      return {
        status: 400,
        headers: {},
        body: 'Missing If: header for refresh',
      };
    }
    try {
      for (const token of tokens) {
        const existing = await ctx.convex.query(
          anyApi.webdav.lock_queries.findLockByToken,
          { token },
        );
        if (!existing || existing.organizationId !== auth.organizationId) {
          continue;
        }
        // RFC 4918 §6.4: only the lock owner may refresh. §9.10.2: the token
        // must apply to the Request-URI. Without these checks any same-org user
        // who learns a token could refresh another user's lock, and a token
        // could be refreshed against an unrelated path. Non-matching tokens
        // fall through to the 412 below.
        if (
          existing.ownerUserId !== auth.userId ||
          existing.resourcePath !== lockKeyFromParsed(parsed)
        ) {
          continue;
        }
        const refreshed = await ctx.convex.mutation(
          anyApi.webdav.lock_mutations.refreshLock,
          {
            lockToken: token,
            ownerUserId: auth.userId,
            timeoutMs: timeoutSec * 1000,
          },
        );
        // RFC §9.10.5: echo the stored ownerXml / scope / depth from
        // the original LOCK request, not whatever the refresh client
        // happened to send (which is allowed to be empty body).
        return buildLockOkResponse({
          lockToken: token,
          ownerXml: refreshed.ownerXml,
          scope: refreshed.scope,
          depth: refreshed.depth,
          parsed,
          auth,
          timeoutSec: Math.round((refreshed.expiresAt - Date.now()) / 1000),
          created: false,
        });
      }
    } catch (err) {
      console.error('[webdav] LOCK refresh failed', err);
      return { status: 500, headers: {}, body: 'Refresh failed' };
    }
    return {
      status: 412,
      headers: DAV_ERROR_HEADERS,
      body: buildDavError({ precondition: 'lock-token-matches-request-uri' }),
    };
  }

  // Fresh LOCK
  // Resolve the path to detect lock-null (resource doesn't exist yet).
  // RFC §9.10.4 + §7.3: LOCK on a non-existent URI creates an empty
  // resource bound to the lock — clients use this to reserve a name
  // before a PUT. Status code must be 201 Created in that case.
  const resolved = await ctx.convex.query(
    anyApi.webdav.tree_queries.resolvePath,
    {
      organizationId: auth.organizationId,
      namespace: parsed.namespace,
      segments: parsed.segments,
    },
  );
  const isLockNull = !resolved.exists;

  // Default Depth per RFC: collections default to infinity, leaves to 0.
  // The trailing-slash URL signals "this is a collection" — clients
  // (Office, Cyberduck) sometimes lock a collection with no Depth
  // header expecting infinity propagation. We honor that.
  const effectiveDepth: '0' | 'infinity' =
    requestedDepth ?? (parsed.isCollection ? 'infinity' : '0');

  const lockToken = randomUuid();
  const lockKey = lockKeyFromParsed(parsed);

  try {
    await ctx.convex.mutation(anyApi.webdav.lock_mutations.createLock, {
      organizationId: auth.organizationId,
      resourcePath: lockKey,
      lockToken,
      ownerXml: lockInfo.ownerXml,
      depth: effectiveDepth,
      scope: lockInfo.scope,
      ownerUserId: auth.userId,
      appPasswordId: auth.appPasswordId,
      timeoutMs: timeoutSec * 1000,
    });
  } catch (err) {
    const code = backendErrorCode(err);
    if (code === 'LOCKED') {
      return {
        status: 423,
        headers: DAV_ERROR_HEADERS,
        body: buildDavError({ precondition: 'no-conflicting-lock' }),
      };
    }
    if (code === 'RATE_LIMITED') {
      return {
        status: 503,
        headers: { 'Retry-After': '60' },
        body: 'Too many locks held by this app-password',
      };
    }
    console.error('[webdav] LOCK create failed', err);
    return { status: 500, headers: {}, body: 'Internal error' };
  }

  return buildLockOkResponse({
    lockToken,
    ownerXml: lockInfo.ownerXml,
    scope: lockInfo.scope,
    depth: effectiveDepth,
    parsed,
    auth,
    timeoutSec,
    created: isLockNull,
  });
}

interface BuildLockOkResponseArgs {
  lockToken: string;
  ownerXml: string;
  scope: 'exclusive' | 'shared';
  depth: '0' | 'infinity';
  parsed: ParsedPath;
  auth: AuthContext;
  timeoutSec: number;
  // RFC §9.10.4: lock-null (lock on non-existent resource) returns
  // 201 Created; refresh and lock-on-existing return 200 OK.
  created: boolean;
}

function buildLockOkResponse(args: BuildLockOkResponseArgs): WebDAVResponse {
  const href = buildDavPath({
    orgSlug: args.auth.orgSlug,
    namespace: args.parsed.namespace,
    segments: args.parsed.segments,
    isCollection: args.parsed.isCollection,
  });
  return {
    status: args.created ? 201 : 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Lock-Token': `<opaquelocktoken:${args.lockToken}>`,
    },
    body: buildLockResponse({
      scope: args.scope,
      ownerXml: args.ownerXml,
      depth: args.depth,
      timeoutSeconds: args.timeoutSec,
      lockToken: args.lockToken,
      href,
    }),
  };
}

function clampTimeout(raw: number | null): number {
  if (raw === null) return DEFAULT_TIMEOUT_SEC;
  if (raw < 1) return DEFAULT_TIMEOUT_SEC;
  return Math.min(raw, MAX_TIMEOUT_SEC);
}

function randomUuid(): string {
  // Web Crypto is available in both Node (>=19) and Vite dev runtime.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Fallback for older runtimes — shouldn't be reached given Node 19+.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
