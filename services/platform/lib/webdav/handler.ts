import { anyApi } from 'convex/server';

import { buildUnauthorizedResponse, verifyBasicAuthForDav } from './auth';
import { handleDelete } from './methods/delete';
import { handleGet } from './methods/get';
import { handleLock } from './methods/lock';
import { handleMkcol } from './methods/mkcol';
import { handleCopy, handleMove } from './methods/move';
import { handleOptions } from './methods/options';
import { handlePropfind } from './methods/propfind';
import { handleProppatch } from './methods/proppatch';
import { handlePut } from './methods/put';
import { handleUnlock } from './methods/unlock';
import { parseDavPath } from './paths';
import type {
  WebDAVCtx,
  WebDAVMethod,
  WebDAVRequest,
  WebDAVResponse,
} from './types';
import { WEBDAV_METHODS } from './types';

function isWebdavMethod(s: string): s is WebDAVMethod {
  return (WEBDAV_METHODS as readonly string[]).includes(s);
}

// Per-process HMAC secret. Read once at first dispatch — the platform
// Hono server crashes if the env isn't set, surfacing the misconfig
// fast rather than silently 401-ing every request.
let cachedHmacSecret: string | null = null;
function getHmacSecret(): string {
  if (cachedHmacSecret) return cachedHmacSecret;
  const raw = process.env.WEBDAV_APP_PASSWORD_HMAC_KEY;
  if (!raw || raw.length < 32) {
    throw new Error(
      "WEBDAV_APP_PASSWORD_HMAC_KEY is unset or too short. Set via 'convex env set WEBDAV_APP_PASSWORD_HMAC_KEY=$(openssl rand -hex 32)' and mirror to platform env via docker-entrypoint.",
    );
  }
  cachedHmacSecret = raw;
  return raw;
}

export async function dispatch(
  req: WebDAVRequest,
  ctx: WebDAVCtx,
): Promise<WebDAVResponse> {
  const method = req.method.toUpperCase();
  if (!isWebdavMethod(method)) {
    return {
      status: 405,
      headers: { Allow: WEBDAV_METHODS.join(', ') },
      body: 'Method not allowed',
    };
  }

  // OPTIONS short-circuit (RFC 4918 §10.1 / HTTP §9.3.7): some clients
  // (KDE, Office, Finder) probe with `OPTIONS /dav`, `OPTIONS /dav/`,
  // or even `OPTIONS *` before they have org context. Returning
  // capability headers regardless of path validity lets them detect
  // DAV support and proceed to authenticate. Done BEFORE parseDavPath
  // so a malformed-but-OPTIONS request still gets a 200 instead of 404.
  if (method === 'OPTIONS') {
    return handleOptions();
  }

  const parsed = parseDavPath(req.pathname);
  if (!parsed) {
    return { status: 404, headers: {}, body: 'Not found' };
  }

  let hmacSecret: string;
  try {
    hmacSecret = getHmacSecret();
  } catch (err) {
    console.error('[webdav] HMAC secret missing', err);
    return { status: 500, headers: {}, body: 'Server misconfigured' };
  }

  const authResult = await verifyBasicAuthForDav(req, ctx, parsed.orgSlug, {
    hmacSecret,
    resolveOrgAndMembership: async (orgSlug, userId) => {
      const r = await ctx.convex.query(
        anyApi.webdav.org_queries.resolveOrgAndCheckMembership,
        { orgSlug, userId },
      );
      return r;
    },
  });
  if (!authResult.ok) {
    if (authResult.status === 401) return buildUnauthorizedResponse();
    return { status: 403, headers: {}, body: authResult.reason };
  }
  const auth = authResult.auth;

  switch (method) {
    case 'PROPFIND':
      return handlePropfind(req, ctx, auth, parsed);
    case 'PROPPATCH':
      return handleProppatch(req, ctx, auth, parsed);
    case 'GET':
      return handleGet(ctx, auth, parsed, false, req);
    case 'HEAD':
      return handleGet(ctx, auth, parsed, true, req);
    case 'PUT':
      return handlePut(req, ctx, auth, parsed);
    case 'DELETE':
      return handleDelete(req, ctx, auth, parsed);
    case 'MKCOL':
      return handleMkcol(req, ctx, auth, parsed);
    case 'MOVE':
      return handleMove(req, ctx, auth, parsed);
    case 'COPY':
      return handleCopy(req, ctx, auth, parsed);
    case 'LOCK':
      return handleLock(req, ctx, auth, parsed);
    case 'UNLOCK':
      return handleUnlock(req, ctx, auth);
    default:
      return {
        status: 405,
        headers: { Allow: WEBDAV_METHODS.join(', ') },
        body: 'Method not allowed',
      };
  }
}
