import { anyApi } from 'convex/server';

import { convexErrorCode } from '../errors';
import { checkResourceLockOnParents } from '../locks';
import type {
  AuthContext,
  ParsedPath,
  WebDAVCtx,
  WebDAVRequest,
  WebDAVResponse,
} from '../types';

export async function handleMkcol(
  req: WebDAVRequest,
  ctx: WebDAVCtx,
  auth: AuthContext,
  parsed: ParsedPath,
): Promise<WebDAVResponse> {
  if (parsed.namespace === '.trash') {
    return { status: 403, headers: {}, body: 'Trash is read-only' };
  }
  if (parsed.segments.length === 0) {
    return {
      status: 405,
      headers: { Allow: 'OPTIONS, PROPFIND' },
      body: 'Cannot MKCOL on root',
    };
  }

  // RFC 4918 §9.3.1: 415 for *any* non-empty body — extended MKCOL
  // (RFC 5689) isn't implemented in v1, and silently accepting a body
  // that we ignore would mislead clients into thinking their custom
  // properties were stored. We don't gate on Content-Type because a
  // misconfigured client may omit it; the body itself is the signal.
  const body = await req.readText();
  if (body.length > 0) {
    return { status: 415, headers: {}, body: 'MKCOL body not supported' };
  }

  // RFC §9.10.4 / §7.4: a depth=infinity lock on an ancestor must
  // forbid creating new children inside the locked tree without the
  // lock token in the If: header.
  const parentLock = await checkResourceLockOnParents(req, ctx, auth, parsed);
  if (!parentLock.ok) {
    return {
      status: parentLock.status,
      headers: parentLock.headers,
      body: parentLock.body,
    };
  }

  const parentSegments = parsed.segments.slice(0, -1);
  const name = parsed.segments[parsed.segments.length - 1];

  try {
    await ctx.convex.mutation(anyApi.webdav.tree_mutations.mkcol, {
      organizationId: auth.organizationId,
      parentSegments,
      name,
      userId: auth.userId,
    });
  } catch (err) {
    const code = convexErrorCode(err);
    if (code === 'CONFLICT') {
      return { status: 409, headers: {}, body: 'Parent does not exist' };
    }
    if (code === 'METHOD_NOT_ALLOWED') {
      return {
        status: 405,
        headers: { Allow: 'OPTIONS, PROPFIND, DELETE' },
        body: 'Already exists',
      };
    }
    console.error('[webdav] MKCOL failed', err);
    return { status: 500, headers: {}, body: 'Internal error' };
  }
  return { status: 201, headers: {}, body: null };
}
