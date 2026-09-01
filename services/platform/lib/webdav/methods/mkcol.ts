import { anyRefs } from '../../shared/handlers/function-refs';
import { backendErrorCode } from '../errors';
import { checkResourceLock } from '../locks';
import {
  WEBDAV_MAX_XML_BODY,
  type AuthContext,
  type ParsedPath,
  type WebDAVCtx,
  type WebDAVRequest,
  type WebDAVResponse,
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
  const body = await req.readText(WEBDAV_MAX_XML_BODY);
  if (body.length > 0) {
    return { status: 415, headers: {}, body: 'MKCOL body not supported' };
  }

  // Lock enforcement (RFC 4918 §7.4 / §9.10.4): a depth=infinity lock on an
  // ancestor forbids creating children inside the locked tree, AND an
  // exact-path lock on this unmapped URL (a lock-null name reservation, §7.3)
  // forbids another principal from MKCOL-ing it without the token.
  // checkResourceLock covers BOTH (leaf at any depth + ancestors at infinity);
  // an ancestor-only check would skip the leaf and miss the reservation.
  const lockResult = await checkResourceLock(req, ctx, auth, parsed, {
    // MKCOL adds a new member to the parent collection — a depth-0 lock on the
    // direct parent must block it too (RFC 4918 §9.10.4).
    directParentDepth0: true,
  });
  if (!lockResult.ok) {
    return {
      status: lockResult.status,
      headers: lockResult.headers,
      body: lockResult.body,
    };
  }

  const parentSegments = parsed.segments.slice(0, -1);
  const name = parsed.segments[parsed.segments.length - 1];

  try {
    await ctx.backend.mutation(anyRefs.webdav.tree_mutations.mkcol, {
      organizationId: auth.organizationId,
      parentSegments,
      name,
      userId: auth.userId,
    });
  } catch (err) {
    const code = backendErrorCode(err);
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
