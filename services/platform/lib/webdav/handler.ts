import { anyRefs } from '../shared/handlers/function-refs';
import { buildUnauthorizedResponse, verifyBasicAuthForDav } from './auth';
import { WEBDAV_HMAC_KEY_MIN_LENGTH } from './hmac-key';
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
import { WEBDAV_METHODS, WebDAVBodyTooLarge } from './types';

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
  // Match the create-path / boot rule exactly (>= 64 hex chars): the key the
  // create mutation HASHES with and the key we VERIFY with must be the same
  // shape, and hmacHash → hexToBytes requires valid hex. A 32-char or non-hex
  // key would pass here but fail at hash time — reject it up front.
  if (
    !raw ||
    raw.length < WEBDAV_HMAC_KEY_MIN_LENGTH ||
    !/^[0-9a-f]+$/i.test(raw)
  ) {
    throw new Error(
      `WEBDAV_APP_PASSWORD_HMAC_KEY is unset, too short (need >= ${WEBDAV_HMAC_KEY_MIN_LENGTH} hex chars), or non-hex. Set via 'convex env set WEBDAV_APP_PASSWORD_HMAC_KEY=$(openssl rand -hex 32)' and mirror to platform env via docker-entrypoint.`,
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
        anyRefs.webdav.org_queries.resolveOrgAndCheckMembership,
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

  // Await each handler inside the try so a WebDAVBodyTooLarge thrown
  // while reading an XML/PUT body (the adapters throw it past the per-
  // method caps) is caught here and mapped to 413, regardless of which
  // method raised it. Anything else re-throws to the adapter's 500 path.
  try {
    switch (method) {
      case 'PROPFIND':
        return await handlePropfind(req, ctx, auth, parsed);
      case 'PROPPATCH':
        return await handleProppatch(req, ctx, auth, parsed);
      case 'GET':
        return await handleGet(ctx, auth, parsed, false, req);
      case 'HEAD':
        return await handleGet(ctx, auth, parsed, true, req);
      case 'PUT':
        return await handlePut(req, ctx, auth, parsed);
      case 'DELETE':
        return await handleDelete(req, ctx, auth, parsed);
      case 'MKCOL':
        return await handleMkcol(req, ctx, auth, parsed);
      case 'MOVE':
        return await handleMove(req, ctx, auth, parsed);
      case 'COPY':
        return await handleCopy(req, ctx, auth, parsed);
      case 'LOCK':
        return await handleLock(req, ctx, auth, parsed);
      case 'UNLOCK':
        return await handleUnlock(req, ctx, auth);
      default:
        return {
          status: 405,
          headers: { Allow: WEBDAV_METHODS.join(', ') },
          body: 'Method not allowed',
        };
    }
  } catch (err) {
    if (err instanceof WebDAVBodyTooLarge) {
      return { status: 413, headers: {}, body: 'Request body too large' };
    }
    throw err;
  }
}
